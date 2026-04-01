/**
 * Phase 7 Task 7.2 — Relation-Aware Scoring for the Goal-Aware Planner
 *
 * Computes the four ScoringSignals for each candidate entity:
 *
 * 1. retrieval_score  — passed through from Phase 3/4 retrieval
 * 2. goal_proximity   — relation-aware BFS toward the goal state (LEADS_TO > SIMILAR)
 * 3. state_readiness  — fraction of preconditions satisfied in active session states
 * 4. novelty          — 1.0 never tried / 0.5 previously blocked / 0.0 completed
 *
 * ## Relation-Aware Goal Proximity
 *
 * The central guarantee of Task 7.2: paths through REQUIRES/LEADS_TO edges
 * score significantly higher than paths through SIMILAR edges:
 *
 *   Direct (postcondition = goal):           LEADS_TO weight  ≈ 0.92
 *   1-hop via LEADS_TO + REQUIRES chain:     (0.92 × 0.95)/2  ≈ 0.44
 *   1-hop via SIMILAR neighbor:              (0.60 × 0.92)/2  ≈ 0.28
 *
 * This prevents the "similarity trap" (spec Phase 7 Case A3 / Scenario 4):
 * `entity:resume-template` is semantically close to resume analysis but has
 * no operational path toward `state:analysis-complete`, so it receives
 * goal_proximity = 0 (or at most a small SIMILAR-discounted value) while
 * `entity:generate-report` receives goal_proximity ≈ 0.92.
 */

import type { DatabaseSync } from "node:sqlite";
import type { WorldState } from "../runtime/world-state.js";
import { DEFAULT_RELATION_WEIGHTS } from "./graph-expander.js";
import type { CandidateEntity, ScoringSignals } from "./planner-types.js";

// ── DB row shapes ────────────────────────────────────────────────

interface EntityFieldRow {
  preconditions_json: string;
  postconditions_json: string;
}

// ── Goal Proximity (Task 7.2 core) ───────────────────────────────

/**
 * Compute goal_proximity for a candidate entity given a target goal state.
 *
 * Strategy (max 2 hops):
 *
 *   Hop 0 — direct: candidate's postconditions contain the goal state.
 *     score = LEADS_TO weight (0.92)
 *
 *   Hop 1 — operational chain: candidate produces intermediate state X,
 *     and there is an entity Y that requires X and produces the goal.
 *     score = (LEADS_TO × REQUIRES) / 2 ≈ 0.44
 *     (REQUIRES and LEADS_TO path weights combined, halved for extra hop)
 *
 *   Hop 1 — similarity path: candidate has a SIMILAR neighbor N whose
 *     postconditions directly reach the goal.
 *     score = (SIMILAR × LEADS_TO) / 2 ≈ 0.28
 *     Substantially lower than the operational chain, implementing the
 *     REQUIRES/LEADS_TO > SIMILAR guarantee.
 *
 * Returns 0 if no path found or goalState is null.
 */
export function computeGoalProximity(
  db: DatabaseSync,
  candidateId: string,
  goalState: string | null,
  relationWeights: Record<string, number> = DEFAULT_RELATION_WEIGHTS,
): number {
  if (!goalState) return 0;

  const leadsToW = relationWeights["LEADS_TO"] ?? 0.92;
  const requiresW = relationWeights["REQUIRES"] ?? 0.95;
  const similarW = relationWeights["SIMILAR"] ?? 0.6;

  // Fetch candidate's preconditions and postconditions once
  const entityRow = db
    .prepare(
      "SELECT preconditions_json, postconditions_json FROM ctxfst_entities WHERE id = ? LIMIT 1",
    )
    .get(candidateId) as EntityFieldRow | undefined;

  if (!entityRow) return 0;

  const postconditions = JSON.parse(entityRow.postconditions_json) as string[];

  // Hop 0: direct — postcondition IS the goal
  if (postconditions.includes(goalState)) {
    return leadsToW; // ≈ 0.92
  }

  // Hop 1 via operational chain (LEADS_TO → REQUIRES → LEADS_TO):
  // For each state X in candidate's postconditions, find entities Y that
  // require X (have X in preconditions) and produce the goal (goalState in postconditions).
  for (const postState of postconditions) {
    const nextEntities = db
      .prepare(
        `SELECT DISTINCT e.id
         FROM ctxfst_entities e, json_each(e.preconditions_json) pre
         WHERE pre.value = ?`,
      )
      .all(postState) as Array<{ id: string }>;

    for (const { id: nextId } of nextEntities) {
      if (nextId === candidateId) continue;
      const nextRow = db
        .prepare("SELECT postconditions_json FROM ctxfst_entities WHERE id = ? LIMIT 1")
        .get(nextId) as { postconditions_json: string } | undefined;
      if (!nextRow) continue;
      const nextPost = JSON.parse(nextRow.postconditions_json) as string[];
      if (nextPost.includes(goalState)) {
        // Operational chain: LEADS_TO → REQUIRES → LEADS_TO
        return (leadsToW * requiresW) / 2; // ≈ 0.44
      }
    }
  }

  // Hop 1 via SIMILAR edge (fallback — scored lower to implement SIMILAR < operational):
  const similarNeighbors = db
    .prepare(
      `SELECT target_id FROM ctxfst_entity_edges
       WHERE source_id = ? AND relation = 'SIMILAR' AND status = 'active'
       UNION
       SELECT source_id as target_id FROM ctxfst_entity_edges
       WHERE target_id = ? AND relation = 'SIMILAR' AND status = 'active'`,
    )
    .all(candidateId, candidateId) as Array<{ target_id: string }>;

  for (const { target_id: neighborId } of similarNeighbors) {
    const neighborRow = db
      .prepare("SELECT postconditions_json FROM ctxfst_entities WHERE id = ? LIMIT 1")
      .get(neighborId) as { postconditions_json: string } | undefined;
    if (!neighborRow) continue;
    const neighborPost = JSON.parse(neighborRow.postconditions_json) as string[];
    if (neighborPost.includes(goalState)) {
      return (similarW * leadsToW) / 2; // ≈ 0.28 — significantly below operational
    }
  }

  return 0;
}

// ── State Readiness ──────────────────────────────────────────────

/**
 * Compute state_readiness: fraction of preconditions satisfied in active states.
 *
 * - No preconditions → 1.0 (always ready)
 * - All met → 1.0
 * - Partial → met/total
 * - None met → 0.0
 */
export function computeStateReadiness(preconditions: string[], activeStates: string[]): number {
  if (preconditions.length === 0) return 1.0;
  const activeSet = new Set(activeStates);
  const met = preconditions.filter((p) => activeSet.has(p)).length;
  return met / preconditions.length;
}

// ── Novelty ──────────────────────────────────────────────────────

/**
 * Compute novelty signal from session history.
 *
 * - Completed in this session → 0.0 (suppress re-recommendation)
 * - Previously blocked → 0.5 (worth retrying if state changed)
 * - Never attempted → 1.0 (fresh recommendation)
 */
export function computeNovelty(entityId: string, worldState: WorldState): number {
  const isCompleted = worldState.completed_skills.some((r) => r.entityId === entityId);
  if (isCompleted) return 0.0;

  const isBlocked = worldState.blocked_by.includes(entityId);
  if (isBlocked) return 0.5;

  return 1.0;
}

// ── Composite scorer ─────────────────────────────────────────────

/** All signals + composite score for a single candidate. */
export interface EntityScore {
  entity_id: string;
  signals: ScoringSignals;
  composite: number;
}

/**
 * Compute all four scoring signals for a candidate entity and combine them
 * into a composite score using the given weights.
 */
export function scoreCandidate(
  db: DatabaseSync,
  candidate: CandidateEntity,
  worldState: WorldState,
  goal: string | null,
  weights: { retrieval: number; goalProximity: number; stateReadiness: number; novelty: number },
  relationWeights: Record<string, number> = DEFAULT_RELATION_WEIGHTS,
): EntityScore {
  const goal_proximity = computeGoalProximity(db, candidate.entity_id, goal, relationWeights);
  const state_readiness = computeStateReadiness(candidate.preconditions, worldState.active_states);
  const novelty = computeNovelty(candidate.entity_id, worldState);
  const retrieval_score = Math.min(1, Math.max(0, candidate.retrieval_score));

  const signals: ScoringSignals = {
    retrieval_score,
    goal_proximity,
    state_readiness,
    novelty,
  };

  const composite = Math.min(
    1,
    Math.max(
      0,
      retrieval_score * weights.retrieval +
        goal_proximity * weights.goalProximity +
        state_readiness * weights.stateReadiness +
        novelty * weights.novelty,
    ),
  );

  return { entity_id: candidate.entity_id, signals, composite };
}
