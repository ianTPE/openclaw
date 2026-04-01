/**
 * Phase 7 Task 7.3 — Goal-Aware Planner / Suggested Next Actions
 *
 * Implements planNextActions(), which takes a PlannerInput (world state +
 * candidate entities + goal) and produces a PlannerOutput with:
 *
 * - ranked_actions: candidates scored and sorted, with explanations
 * - blocked_actions: candidates whose preconditions are not met
 * - completed_actions: entities already done in this session
 *
 * The planner does not re-run retrieval — it operates on whatever candidates
 * the Phase 3/4 pipeline already found. Integration with the prompt adapter
 * is via buildPlannerPromptSections(), which replaces the simpler
 * buildNextActionsSection() when planner output is available.
 */

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RELATION_WEIGHTS } from "./graph-expander.js";
import { computeNovelty, computeStateReadiness, scoreCandidate } from "./planner-scorer.js";
import {
  DEFAULT_PLANNER_WEIGHTS,
  type ActionExplanation,
  type BlockedAction,
  type CandidateEntity,
  type PlannerInput,
  type PlannerOutput,
  type PlannerWeights,
  type RankedAction,
} from "./planner-types.js";
import type { PromptSection } from "./types.js";

// ── Planner Options ───────────────────────────────────────────────

export interface PlannerOptions {
  /** Override scoring signal weights. Defaults to DEFAULT_PLANNER_WEIGHTS. */
  weights?: PlannerWeights;
  /** Override relation weights used for goal proximity. */
  relationWeights?: Record<string, number>;
  /** Maximum ranked_actions in output. Defaults to 5. */
  maxRankedActions?: number;
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Produce a goal-aware plan from retrieval candidates and session world state.
 *
 * Scoring: composite = retrieval×w.retrieval + goalProximity×w.goalProximity
 *                     + stateReadiness×w.stateReadiness + novelty×w.novelty
 *
 * Output:
 * - ranked_actions: candidates with composite score > 0, sorted descending,
 *   limited to maxRankedActions. Completed and blocked actions are excluded.
 * - blocked_actions: candidates with any missing preconditions.
 * - completed_actions: entity IDs already completed in this session.
 */
export function planNextActions(
  db: DatabaseSync,
  input: PlannerInput,
  options: PlannerOptions = {},
): PlannerOutput {
  const {
    weights = DEFAULT_PLANNER_WEIGHTS,
    relationWeights = DEFAULT_RELATION_WEIGHTS,
    maxRankedActions = 5,
  } = options;

  const { worldState, goal: goalOverride, candidateEntities } = input;
  const goal = goalOverride ?? worldState.goal_entity_id;

  const completedIds = new Set(worldState.completed_skills.map((r) => r.entityId));
  const blockedIds = new Set(worldState.blocked_by);
  const activeStates = worldState.active_states;

  const ranked: RankedAction[] = [];
  const blocked: BlockedAction[] = [];

  for (const candidate of candidateEntities) {
    // Identify missing preconditions
    const activeSet = new Set(activeStates);
    const missing = candidate.preconditions.filter((p) => !activeSet.has(p));

    // Track blocked separately (but still score — they may move to unblocked)
    if (missing.length > 0) {
      blocked.push({
        entity_id: candidate.entity_id,
        name: candidate.name,
        missing_preconditions: missing,
      });
      // Don't add to ranked — blocked entities go in their own bucket
      continue;
    }

    // Skip completed (they appear in completed_actions list only)
    if (completedIds.has(candidate.entity_id)) {
      continue;
    }

    const scored = scoreCandidate(db, candidate, worldState, goal, weights, relationWeights);
    const explanation = buildExplanation(candidate, scored.signals, goal, worldState);

    ranked.push({
      entity_id: candidate.entity_id,
      name: candidate.name,
      type: candidate.type,
      score: scored.composite,
      explanation,
      signals: scored.signals,
    });
  }

  // Sort ranked by composite score descending, then name for determinism
  ranked.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-9) return diff;
    return a.name < b.name ? -1 : 1;
  });

  return {
    goal,
    ranked_actions: ranked.slice(0, maxRankedActions),
    blocked_actions: blocked,
    completed_actions: Array.from(completedIds),
  };
}

// ── Explanation builder ───────────────────────────────────────────

function buildExplanation(
  candidate: CandidateEntity,
  signals: import("./planner-types.js").ScoringSignals,
  goal: string | null,
  worldState: import("../runtime/world-state.js").WorldState,
): ActionExplanation {
  // Goal reason
  let goal_reason: string | null = null;
  if (goal && signals.goal_proximity > 0) {
    if (signals.goal_proximity >= 0.9) {
      goal_reason = `Directly produces ${goal}`;
    } else if (signals.goal_proximity >= 0.35) {
      goal_reason = `On the operational path toward ${goal} via LEADS_TO/REQUIRES chain`;
    } else {
      goal_reason = `Indirectly related to ${goal} via similarity`;
    }
  }

  // State readiness reason
  let state_reason: string;
  const totalPre = candidate.preconditions.length;
  if (totalPre === 0) {
    state_reason = "No preconditions required";
  } else if (signals.state_readiness === 1.0) {
    state_reason = `All ${totalPre} precondition(s) satisfied`;
  } else {
    const met = Math.round(signals.state_readiness * totalPre);
    state_reason = `${met} of ${totalPre} precondition(s) satisfied`;
  }

  // Novelty reason
  let novelty_reason: string;
  if (signals.novelty === 0.0) {
    novelty_reason = "Already completed in this session";
  } else if (signals.novelty === 0.5) {
    novelty_reason = "Previously blocked — retrying after state change";
  } else {
    novelty_reason = "Not yet attempted in this session";
  }

  // Summary — combine the meaningful parts
  const parts: string[] = [];
  if (goal_reason) parts.push(goal_reason);
  parts.push(state_reason);
  if (signals.novelty < 1.0) parts.push(novelty_reason);
  const summary = parts.join("; ") + ".";

  return { goal_reason, state_reason, novelty_reason, summary };
}

// ── Prompt section builder (Task 7.3 prompt integration) ─────────

const PRIORITY_PLANNER_ACTIONS = 85; // between entities (80) and missing preconditions (100)
const PRIORITY_PLANNER_BLOCKED = 45; // between next-actions (40) and graph (60)

/**
 * Build PromptSection[] from a PlannerOutput for injection into the prompt adapter.
 *
 * Produces up to two sections:
 * 1. "Next Actions" — ranked actionable suggestions with scores and reasons
 * 2. "Blocked Actions" — actions that cannot proceed yet, with missing states
 *
 * Returns [] when the planner has no useful output.
 */
export function buildPlannerPromptSections(output: PlannerOutput): PromptSection[] {
  const sections: PromptSection[] = [];

  // Ranked next actions
  if (output.ranked_actions.length > 0) {
    const lines = output.ranked_actions.map((action) => {
      const scorePct = Math.round(action.score * 100);
      const reasonParts: string[] = [];
      if (action.explanation.goal_reason) reasonParts.push(action.explanation.goal_reason);
      reasonParts.push(action.explanation.state_reason);
      const reason = reasonParts.join(". ");
      return `- **${action.name}** (score: ${scorePct}%) — ${reason}`;
    });

    sections.push({
      label: "Next Actions",
      content: lines.join("\n"),
      priority: PRIORITY_PLANNER_ACTIONS,
    });
  }

  // Blocked actions
  if (output.blocked_actions.length > 0) {
    const lines = output.blocked_actions.map((ba) => {
      const missing = ba.missing_preconditions.join(", ");
      return `- **${ba.name}** — blocked, missing: ${missing}`;
    });

    sections.push({
      label: "Blocked Actions",
      content: lines.join("\n"),
      priority: PRIORITY_PLANNER_BLOCKED,
    });
  }

  return sections;
}
