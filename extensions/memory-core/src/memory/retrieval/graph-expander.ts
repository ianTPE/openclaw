import type { DatabaseSync } from "node:sqlite";
import { getChunksForEntity } from "../indexing/entity-index.js";
import type { EntityMatchWithScore } from "./entity-matcher.js";
import type { ChunkHit, ExpandedEntity } from "./types.js";

/** Default relation weights — operational edges rank higher than semantic. */
export const DEFAULT_RELATION_WEIGHTS: Record<string, number> = {
  REQUIRES: 0.95,
  LEADS_TO: 0.92,
  EVIDENCE: 0.8,
  IMPLIES: 0.75,
  SIMILAR: 0.6,
};

export interface GraphExpansionOptions {
  /** Maximum number of expanded entities. Defaults to 5. */
  maxExpandedEntities?: number;
  /** Maximum number of graph-derived chunks. Defaults to 5. */
  maxExpandedChunks?: number;
  /** Only follow edges with these relation types. Null means all. */
  relationAllowlist?: string[] | null;
  /** Relation → weight map. Falls back to DEFAULT_RELATION_WEIGHTS. */
  relationWeights?: Record<string, number>;
}

interface EdgeRow {
  source_id: string;
  target_id: string;
  relation: string;
  score: number;
}

interface EntityNameRow {
  id: string;
  name: string;
  document_id: string;
}

export interface GraphExpansionResult {
  expandedEntities: ExpandedEntity[];
  graphChunks: ChunkHit[];
}

/**
 * One-hop graph expansion from seed entities.
 *
 * For each seed entity, traverse outgoing edges in `ctxfst_entity_edges`,
 * apply relation weights, enforce budget limits, and collect supporting
 * chunks for the expanded neighbor entities.
 *
 * Does NOT recurse beyond one hop.
 */
export function expandEntityNeighborhood(
  db: DatabaseSync,
  seedEntities: EntityMatchWithScore[],
  options: GraphExpansionOptions = {},
): GraphExpansionResult {
  const {
    maxExpandedEntities = 5,
    maxExpandedChunks = 5,
    relationAllowlist = null,
    relationWeights = DEFAULT_RELATION_WEIGHTS,
  } = options;

  if (seedEntities.length === 0) {
    return { expandedEntities: [], graphChunks: [] };
  }

  // Collect seed ids so we can exclude them from expansion results.
  const seedIds = new Set(seedEntities.map((s) => s.entity_id));

  // Build candidates from outgoing edges of each seed entity.
  const candidates: Array<{
    entity_id: string;
    relation: string;
    weightedScore: number;
    seedScore: number;
    document_id: string;
  }> = [];

  for (const seed of seedEntities) {
    // Fetch outgoing edges (seed is source)
    const edges = db
      .prepare(
        "SELECT source_id, target_id, relation, score FROM ctxfst_entity_edges WHERE source_id = ? AND status = 'active'",
      )
      .all(seed.entity_id) as EdgeRow[];

    // Also fetch incoming edges (seed is target) to capture bidirectional traversal
    const incomingEdges = db
      .prepare(
        "SELECT source_id, target_id, relation, score FROM ctxfst_entity_edges WHERE target_id = ? AND status = 'active'",
      )
      .all(seed.entity_id) as EdgeRow[];

    const allEdges = [
      ...edges.map((e) => ({ neighborId: e.target_id, relation: e.relation, edgeScore: e.score })),
      ...incomingEdges.map((e) => ({
        neighborId: e.source_id,
        relation: e.relation,
        edgeScore: e.score,
      })),
    ];

    for (const { neighborId, relation, edgeScore } of allEdges) {
      // Skip self-loops and seed entities
      if (seedIds.has(neighborId)) {
        continue;
      }

      // Apply relation filter
      if (relationAllowlist && !relationAllowlist.includes(relation)) {
        continue;
      }

      const relWeight = relationWeights[relation] ?? 0.5;
      const weightedScore = seed.score * relWeight * edgeScore;

      candidates.push({
        entity_id: neighborId,
        relation,
        weightedScore,
        seedScore: seed.score,
        document_id: seed.document_id,
      });
    }
  }

  // Deduplicate by entity_id: keep the candidate with the highest weighted score.
  const bestByEntity = new Map<
    string,
    { entity_id: string; relation: string; weightedScore: number; document_id: string }
  >();
  for (const c of candidates) {
    const existing = bestByEntity.get(c.entity_id);
    if (!existing || c.weightedScore > existing.weightedScore) {
      bestByEntity.set(c.entity_id, c);
    }
  }

  // Sort by weighted score descending and apply entity budget.
  const sorted = Array.from(bestByEntity.values()).sort(
    (a, b) => b.weightedScore - a.weightedScore,
  );
  const budgetedEntities = sorted.slice(0, maxExpandedEntities);

  // Resolve entity names for the expanded entities.
  const expandedEntities: ExpandedEntity[] = [];
  for (const entry of budgetedEntities) {
    const nameRow = db
      .prepare("SELECT id, name, document_id FROM ctxfst_entities WHERE id = ? LIMIT 1")
      .get(entry.entity_id) as EntityNameRow | undefined;

    expandedEntities.push({
      entity_id: entry.entity_id,
      name: nameRow?.name ?? entry.entity_id,
      relation: entry.relation,
      score: entry.weightedScore,
      document_id: nameRow?.document_id ?? entry.document_id,
    });
  }

  // Collect chunks for expanded entities, apply chunk budget.
  const chunkScoreMap = new Map<string, ChunkHit>();
  for (const expanded of expandedEntities) {
    const chunkIds = getChunksForEntity(db, expanded.entity_id);
    for (const chunkId of chunkIds) {
      const existing = chunkScoreMap.get(chunkId);
      if (!existing || expanded.score > existing.score) {
        chunkScoreMap.set(chunkId, {
          chunk_id: chunkId,
          document_id: expanded.document_id,
          score: expanded.score,
          source: "graph",
        });
      }
    }
  }

  // Sort by score, then apply chunk budget.
  const graphChunks = Array.from(chunkScoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxExpandedChunks);

  return { expandedEntities, graphChunks };
}
