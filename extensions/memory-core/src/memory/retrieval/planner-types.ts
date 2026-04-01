/**
 * Phase 7 — Goal-Aware Planner Types (Task 7.1)
 *
 * Defines the inputs, outputs, and scoring model for the goal-aware
 * planner/router that sits on top of the retrieval pipeline (Phase 3-4)
 * and the session runtime state (Phase 6).
 *
 * ## Design Decisions
 *
 * 1. **Goal is a state entity, not an action entity.**
 *    The goal represents a *desired world state* (e.g. `state:analysis-complete`),
 *    not an action to perform. The planner's job is to find the sequence of
 *    actions that transitions the world from current active_states toward the
 *    goal state, following REQUIRES/LEADS_TO edges.
 *
 * 2. **Scoring is additive, not multiplicative.**
 *    Each entity receives independent score adjustments from four signal
 *    sources (goal proximity, relation weight, state readiness, novelty).
 *    Signals are weighted and summed rather than multiplied so that a zero
 *    in one signal does not kill the others — this avoids harsh cliffs
 *    when e.g. an entity has no direct goal-path but is still state-ready.
 *
 * 3. **Blocked ≠ invisible.**
 *    Blocked entities are penalized but not removed from results. The prompt
 *    adapter already surfaces them in the "Missing Preconditions" section,
 *    and the explainability layer references them. Hiding them entirely
 *    would prevent the user from understanding why a step is not available.
 *
 * 4. **Completed = heavily penalized, not removed.**
 *    Completed skills still appear in explainability traces (so users can
 *    see what was already done) but receive a steep score penalty so they
 *    naturally sink below actionable candidates in the ranking.
 *
 * 5. **SIMILAR edges are not suppressed, just outranked.**
 *    The spec says REQUIRES/LEADS_TO > SIMILAR. We achieve this by weighting
 *    rather than filtering — SIMILAR edges still contribute, but operationally
 *    meaningful edges score substantially higher.
 */

import type { WorldState } from "../runtime/world-state.js";
import type { ExpandedEntity } from "./types.js";

// ── Planner Input ─────────────────────────────────────────────────

/** All inputs the planner needs to produce goal-aware ranked actions. */
export interface PlannerInput {
  /** Database handle for entity/edge queries. */
  // (intentionally not part of this type — passed separately to the planner fn)

  /** The session world state snapshot at planning time. */
  worldState: WorldState;

  /**
   * The desired end state.
   *
   * Must be a state entity ID (e.g. `state:analysis-complete`).
   * The planner traces LEADS_TO edges backward from this goal to
   * identify which actions are on the critical path.
   *
   * When null, the planner falls back to `worldState.goal_entity_id`.
   * When both are null, goal-proximity scoring is disabled and the
   * planner degrades to state-aware ranking without goal bias.
   */
  goal: string | null;

  /**
   * Entities matched by the retrieval pipeline for the current query.
   * These are the *candidates* to be ranked. Graph-expanded entities
   * are included.
   *
   * The planner does not re-run retrieval; it ranks what the pipeline
   * already found.
   */
  candidateEntities: CandidateEntity[];
}

/** An entity candidate entering the planner (from retrieval + graph expansion). */
export interface CandidateEntity {
  entity_id: string;
  name: string;
  type: string;
  /** Base relevance score from retrieval/graph expansion (0–1). */
  retrieval_score: number;
  document_id: string;
  preconditions: string[];
  postconditions: string[];
}

// ── Planner Output ────────────────────────────────────────────────

/** Fully scored and explained action recommendation. */
export interface RankedAction {
  entity_id: string;
  name: string;
  type: string;
  /** Final composite score after all planner adjustments (0–1). */
  score: number;
  /** Why this entity received its score — human-readable, stable. */
  explanation: ActionExplanation;
  /** Breakdown of individual scoring signals for debugging/testing. */
  signals: ScoringSignals;
}

/** The planner's output: an ordered list of ranked actions with context. */
export interface PlannerOutput {
  /** The goal used for this plan (may be null if no goal was set). */
  goal: string | null;
  /** Actions ranked by composite score, highest first. */
  ranked_actions: RankedAction[];
  /** Entities that are blocked (preconditions not met). */
  blocked_actions: BlockedAction[];
  /** Entities already completed in this session. */
  completed_actions: string[];
}

/** A blocked action with its missing preconditions. */
export interface BlockedAction {
  entity_id: string;
  name: string;
  missing_preconditions: string[];
}

// ── Scoring Model ─────────────────────────────────────────────────

/**
 * Individual scoring signals that contribute to the final composite score.
 *
 * Final score = clamp(0, 1,
 *   retrieval_score * weights.retrieval
 *   + goal_proximity  * weights.goalProximity
 *   + state_readiness * weights.stateReadiness
 *   + novelty         * weights.novelty
 * )
 *
 * Each signal is in [0, 1]. See PlannerWeights for defaults.
 */
export interface ScoringSignals {
  /** Base retrieval relevance (from entity match / graph expansion). */
  retrieval_score: number;

  /**
   * How close this entity is to reaching the goal state, measured by
   * graph distance along LEADS_TO / REQUIRES edges.
   *
   * 1.0 = entity's postconditions directly produce the goal state.
   * Decays with each hop: 1 / (1 + hopCount).
   * 0.0 = no path to goal found (or no goal set).
   */
  goal_proximity: number;

  /**
   * Whether this entity's preconditions are satisfied in the current
   * session state.
   *
   * 1.0 = all preconditions met (ready to execute).
   * Partial: met / total (e.g. 1 of 2 met = 0.5).
   * 0.0 = no preconditions met.
   *
   * Entities with no preconditions score 1.0 (always ready).
   */
  state_readiness: number;

  /**
   * Novelty / freshness signal based on session history.
   *
   * 1.0 = never attempted in this session.
   * 0.0 = already completed successfully.
   * 0.5 = previously blocked (worth retrying if state changed).
   *
   * This prevents the planner from endlessly re-recommending
   * already-completed skills.
   */
  novelty: number;
}

/**
 * Weight configuration for combining scoring signals.
 * All weights should sum to ~1.0 for interpretable composite scores.
 */
export interface PlannerWeights {
  /** Weight for base retrieval relevance. */
  retrieval: number;
  /** Weight for goal-proximity signal. */
  goalProximity: number;
  /** Weight for state-readiness signal. */
  stateReadiness: number;
  /** Weight for novelty signal. */
  novelty: number;
}

/**
 * Default planner weights.
 *
 * Rationale:
 * - goalProximity (0.35): strongest signal — the whole point of the planner
 *   is to prefer actions that advance toward the goal.
 * - stateReadiness (0.25): second strongest — ready-to-execute actions
 *   should rank above actions with missing preconditions.
 * - retrieval (0.25): respects the query relevance from the retrieval
 *   pipeline, keeping the planner grounded in what the user asked about.
 * - novelty (0.15): tie-breaker that prevents completed actions from
 *   being re-recommended, without being so heavy that it overrides
 *   genuine relevance.
 */
export const DEFAULT_PLANNER_WEIGHTS: PlannerWeights = {
  retrieval: 0.25,
  goalProximity: 0.35,
  stateReadiness: 0.25,
  novelty: 0.15,
};

// ── Explainability ────────────────────────────────────────────────

/**
 * Human-readable explanation of why an action was ranked where it is.
 *
 * Each field is a short sentence fragment suitable for direct inclusion
 * in a prompt or CLI output. Fields are null when the signal does not
 * contribute meaningfully (e.g. goal_reason is null when no goal is set).
 */
export interface ActionExplanation {
  /** Why this entity is relevant to the goal (or null). */
  goal_reason: string | null;
  /** State readiness explanation. */
  state_reason: string;
  /** Whether this is a novel action or a repeat. */
  novelty_reason: string;
  /** The single-line summary combining the above. */
  summary: string;
}
