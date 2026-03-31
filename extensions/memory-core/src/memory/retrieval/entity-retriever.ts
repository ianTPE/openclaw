import type { DatabaseSync } from "node:sqlite";
import { getChunksForEntity } from "../indexing/entity-index.js";
import type { EntityMatchWithScore } from "./entity-matcher.js";
import type { ChunkHit } from "./types.js";

/**
 * Expand entity matches into entity-derived chunk hits.
 *
 * Each matched entity's supporting chunks inherit the entity's score.
 * If the same chunk is reachable via multiple entities, the highest entity
 * score wins (dedup is handled later in rank-fusion, but here we emit one
 * hit per (chunk, entity) pair so fusion can merge them correctly).
 */
export function retrieveByEntities(db: DatabaseSync, matches: EntityMatchWithScore[]): ChunkHit[] {
  // Use a map keyed by chunk_id to keep the best entity score per chunk.
  const best = new Map<string, ChunkHit>();

  for (const match of matches) {
    const chunkIds = getChunksForEntity(db, match.entity_id);
    for (const chunkId of chunkIds) {
      const existing = best.get(chunkId);
      if (!existing || match.score > existing.score) {
        best.set(chunkId, {
          chunk_id: chunkId,
          document_id: match.document_id,
          score: match.score,
          source: "entity",
        });
      }
    }
  }

  return Array.from(best.values());
}
