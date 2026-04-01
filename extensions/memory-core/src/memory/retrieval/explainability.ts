/**
 * Phase 7 Task 7.4 — Explainability Hooks
 *
 * Provides structured, human-readable explanations for each stage of the
 * retrieval + planner pipeline:
 *
 * 1. **Entity match** — why a specific entity was included in results
 * 2. **Chunk expansion** — why a chunk was included (entity ref, graph, vector, keyword)
 * 3. **Action recommendation** — why a next step was suggested (from planner)
 *
 * These hooks compose into an `ExplainabilityTrace` that covers the full
 * pipeline provenance, satisfying Phase 7 validation checklist E1–E3:
 *
 * - E1: explanation names the goal
 * - E2: explanation references relation semantics (REQUIRES, LEADS_TO, precondition status)
 * - E3: explanation is stable, readable, not just raw score dumps
 */

import type { EntityMatch } from "../formats/ctxfst/types.js";
import type {
  ActionExplanation,
  BlockedAction,
  PlannerOutput,
  RankedAction,
  ScoringSignals,
} from "./planner-types.js";
import type { ContextPack, ExpandedEntity, FusedChunkHit, RetrievalSource } from "./types.js";

// ── Types ────────────────────────────────────────────────────────

/** Explanation of why an entity was matched by the retrieval pipeline. */
export interface EntityMatchExplanation {
  entity_id: string;
  name: string;
  match_type: "direct_query" | "graph_expansion";
  /** Human-readable reason for inclusion. */
  reason: string;
  /** Present only for graph-expanded entities. */
  expansion_detail?: {
    seed_entity: string;
    relation: string;
    weighted_score: number;
  };
}

/** Explanation of why a chunk was included in the context. */
export interface ChunkInclusionExplanation {
  chunk_id: string;
  /** Each source path that contributed this chunk. */
  sources: string[];
  /** Single-line human-readable summary. */
  reason: string;
}

/** Explanation of why a specific action was recommended, blocked, or completed. */
export interface ActionRecommendationExplanation {
  entity_id: string;
  name: string;
  status: "recommended" | "blocked" | "completed";
  /** Present for recommended actions (from planner scoring). */
  signals?: ScoringSignals;
  /** Present for recommended actions. */
  explanation?: ActionExplanation;
  /** Present for blocked actions. */
  missing_preconditions?: string[];
  /** Human-readable summary. */
  reason: string;
}

/** Full explainability trace across all pipeline stages. */
export interface ExplainabilityTrace {
  query: string;
  goal: string | null;
  /** Why each entity was included. */
  entity_explanations: EntityMatchExplanation[];
  /** Why each chunk was included. */
  chunk_explanations: ChunkInclusionExplanation[];
  /** Why each action was recommended / blocked / completed. */
  action_explanations: ActionRecommendationExplanation[];
  /** Top-level human-readable narrative. */
  summary: string;
}

// ── Entity Match Explanations ────────────────────────────────────

/** Format match type as human-readable text. */
function formatMatchType(matchType: string): string {
  return matchType === "exact" ? "exact name match" : "alias match";
}

/**
 * Explain why each entity was included in the context pack.
 *
 * Direct matches: matched by name/alias against the query.
 * Expanded entities: discovered via graph traversal from a seed entity.
 */
export function explainEntityMatches(contextPack: ContextPack): EntityMatchExplanation[] {
  const explanations: EntityMatchExplanation[] = [];
  const seen = new Set<string>();

  // Direct matches from entity matcher
  for (const entity of contextPack.matched_entities) {
    if (seen.has(entity.entity_id)) continue;
    seen.add(entity.entity_id);

    const matchDesc = formatMatchType(entity.match_type);
    explanations.push({
      entity_id: entity.entity_id,
      name: entity.name,
      match_type: "direct_query",
      reason: `Matched query via ${matchDesc}`,
    });
  }

  // Graph-expanded entities
  for (const expanded of contextPack.expanded_entities) {
    if (seen.has(expanded.entity_id)) continue;
    seen.add(expanded.entity_id);

    const seedEntity = findSeedForExpanded(contextPack.matched_entities, expanded);
    const seedName = seedEntity?.name ?? "a matched entity";

    explanations.push({
      entity_id: expanded.entity_id,
      name: expanded.name,
      match_type: "graph_expansion",
      reason: `Discovered via ${expanded.relation} edge from ${seedName}`,
      expansion_detail: {
        seed_entity: seedName,
        relation: expanded.relation,
        weighted_score: expanded.score,
      },
    });
  }

  return explanations;
}

/**
 * Find the most likely seed entity that led to an expanded entity.
 * Since graph expansion doesn't track provenance per-entity, we use
 * the best available heuristic: the seed with the highest score.
 */
function findSeedForExpanded(
  seeds: EntityMatch[],
  _expanded: ExpandedEntity,
): EntityMatch | undefined {
  // Expansion comes from seed entities; return the first (highest-scored) one
  return seeds[0];
}

// ── Chunk Expansion Explanations ─────────────────────────────────

/** Human-readable label for a retrieval source. */
function sourceLabel(source: RetrievalSource): string {
  switch (source) {
    case "entity":
      return "entity reference";
    case "graph":
      return "graph expansion";
    case "vector":
      return "vector similarity";
    case "keyword":
      return "keyword match";
    default:
      return source;
  }
}

/**
 * Explain why each chunk was included in the fused results.
 *
 * Each chunk may have multiple sources (entity ref, graph expansion,
 * vector similarity, keyword match). The explanation lists all contributing
 * paths and produces a single-line summary.
 */
export function explainChunkInclusions(contextPack: ContextPack): ChunkInclusionExplanation[] {
  const explanations: ChunkInclusionExplanation[] = [];

  for (const fused of contextPack.fused_chunks) {
    const sources = fused.sources.map((s) => sourceLabel(s));
    const uniqueSources = [...new Set(sources)];

    const reason =
      uniqueSources.length === 1
        ? `Included via ${uniqueSources[0]}`
        : `Included via multiple paths: ${uniqueSources.join(", ")}`;

    explanations.push({
      chunk_id: fused.chunk_id,
      sources: uniqueSources,
      reason,
    });
  }

  return explanations;
}

// ── Action Recommendation Explanations ───────────────────────────

/**
 * Explain why each action was recommended, blocked, or marked completed.
 *
 * Delegates to the planner's existing ActionExplanation for recommended
 * actions, and adds structured explanations for blocked and completed ones.
 */
export function explainActionRecommendations(
  plannerOutput: PlannerOutput,
): ActionRecommendationExplanation[] {
  const explanations: ActionRecommendationExplanation[] = [];

  // Recommended actions
  for (const action of plannerOutput.ranked_actions) {
    explanations.push({
      entity_id: action.entity_id,
      name: action.name,
      status: "recommended",
      signals: action.signals,
      explanation: action.explanation,
      reason: action.explanation.summary,
    });
  }

  // Blocked actions
  for (const blocked of plannerOutput.blocked_actions) {
    const missing = blocked.missing_preconditions.join(", ");
    explanations.push({
      entity_id: blocked.entity_id,
      name: blocked.name,
      status: "blocked",
      missing_preconditions: blocked.missing_preconditions,
      reason: `Blocked: missing precondition(s) ${missing}`,
    });
  }

  // Completed actions
  for (const entityId of plannerOutput.completed_actions) {
    explanations.push({
      entity_id: entityId,
      name: entityId, // completed_actions only has IDs
      status: "completed",
      reason: "Already completed in this session",
    });
  }

  return explanations;
}

// ── Full Trace Builder ───────────────────────────────────────────

export interface BuildTraceOptions {
  contextPack: ContextPack;
  plannerOutput: PlannerOutput;
}

/**
 * Build a full explainability trace covering the entire retrieval + planner
 * pipeline.
 *
 * The trace answers three questions:
 * 1. Why were these entities matched? (retrieval stage)
 * 2. Why were these chunks included? (expansion + fusion stage)
 * 3. Why are these actions recommended? (planner stage)
 *
 * The top-level summary names the goal and provides a narrative overview,
 * satisfying validation checklist E1 (names the goal) and E3 (readable).
 */
export function buildExplainabilityTrace(options: BuildTraceOptions): ExplainabilityTrace {
  const { contextPack, plannerOutput } = options;

  const entityExplanations = explainEntityMatches(contextPack);
  const chunkExplanations = explainChunkInclusions(contextPack);
  const actionExplanations = explainActionRecommendations(plannerOutput);

  const summary = buildTraceSummary(
    contextPack.query,
    plannerOutput.goal,
    entityExplanations,
    chunkExplanations,
    actionExplanations,
  );

  return {
    query: contextPack.query,
    goal: plannerOutput.goal,
    entity_explanations: entityExplanations,
    chunk_explanations: chunkExplanations,
    action_explanations: actionExplanations,
    summary,
  };
}

/**
 * Build the top-level narrative summary for the trace.
 *
 * E1: names the goal explicitly.
 * E2: references relation semantics when graph expansion was used.
 * E3: human-readable paragraph, not a score dump.
 */
function buildTraceSummary(
  query: string,
  goal: string | null,
  entityExplanations: EntityMatchExplanation[],
  chunkExplanations: ChunkInclusionExplanation[],
  actionExplanations: ActionRecommendationExplanation[],
): string {
  const parts: string[] = [];

  // Query context
  parts.push(`For query "${query}"`);

  // Goal context (E1: names the goal)
  if (goal) {
    parts.push(`toward goal ${goal}`);
  }

  // Entity summary
  const directCount = entityExplanations.filter((e) => e.match_type === "direct_query").length;
  const expandedCount = entityExplanations.filter((e) => e.match_type === "graph_expansion").length;

  const entityParts: string[] = [];
  if (directCount > 0) {
    entityParts.push(`${directCount} matched directly`);
  }
  if (expandedCount > 0) {
    // E2: references relation semantics
    const relations = entityExplanations
      .filter((e) => e.expansion_detail)
      .map((e) => e.expansion_detail!.relation);
    const uniqueRelations = [...new Set(relations)];
    entityParts.push(
      `${expandedCount} discovered via graph expansion (${uniqueRelations.join(", ")})`,
    );
  }
  if (entityParts.length > 0) {
    parts.push(`found ${entityExplanations.length} entities: ${entityParts.join(", ")}`);
  }

  // Chunk summary
  if (chunkExplanations.length > 0) {
    parts.push(`${chunkExplanations.length} supporting chunks included`);
  }

  // Action summary
  const recommended = actionExplanations.filter((a) => a.status === "recommended").length;
  const blocked = actionExplanations.filter((a) => a.status === "blocked").length;
  const completed = actionExplanations.filter((a) => a.status === "completed").length;

  const actionParts: string[] = [];
  if (recommended > 0) actionParts.push(`${recommended} recommended`);
  if (blocked > 0) actionParts.push(`${blocked} blocked`);
  if (completed > 0) actionParts.push(`${completed} already completed`);
  if (actionParts.length > 0) {
    parts.push(`${actionParts.join(", ")} actions`);
  }

  return parts.join("; ") + ".";
}

// ── Render helpers ───────────────────────────────────────────────

/**
 * Render an ExplainabilityTrace as a human-readable markdown string.
 *
 * Useful for CLI output, prompt injection, or debugging.
 */
export function renderExplainabilityTrace(trace: ExplainabilityTrace): string {
  const lines: string[] = [];

  lines.push(`## Explainability Trace`);
  lines.push("");
  lines.push(trace.summary);
  lines.push("");

  // Entity section
  if (trace.entity_explanations.length > 0) {
    lines.push(`### Matched Entities`);
    lines.push("");
    for (const e of trace.entity_explanations) {
      lines.push(`- **${e.name}**: ${e.reason}`);
    }
    lines.push("");
  }

  // Chunk section
  if (trace.chunk_explanations.length > 0) {
    lines.push(`### Included Chunks`);
    lines.push("");
    for (const c of trace.chunk_explanations) {
      lines.push(`- ${c.chunk_id}: ${c.reason}`);
    }
    lines.push("");
  }

  // Action section
  if (trace.action_explanations.length > 0) {
    lines.push(`### Action Recommendations`);
    lines.push("");
    for (const a of trace.action_explanations) {
      const statusLabel =
        a.status === "recommended"
          ? "[Recommended]"
          : a.status === "blocked"
            ? "[Blocked]"
            : "[Completed]";
      lines.push(`- ${statusLabel} **${a.name}**: ${a.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
