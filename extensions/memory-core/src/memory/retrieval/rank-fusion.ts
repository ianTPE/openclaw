import type { ChunkHit, FusedChunkHit, RetrievalSource } from "./types.js";

export interface FusionInput {
  entityChunks: ChunkHit[];
  vectorChunks: ChunkHit[];
  keywordChunks: ChunkHit[];
  /** Maximum number of chunks in the fused output. Defaults to 20. */
  limit?: number;
}

/**
 * Merge chunk hits from entity, vector, and keyword retrieval paths.
 *
 * Fusion strategy:
 * - When the same chunk appears in multiple paths, the final score is the
 *   maximum individual score plus a small multi-source bonus (0.05 per
 *   additional source, capped at 0.15).
 * - Entity-derived hits are not penalized relative to vector/keyword hits.
 * - Results are sorted by fused score descending then by chunk_id for
 *   determinism.
 */
export function fuseRetrievalResults(input: FusionInput): FusedChunkHit[] {
  const { entityChunks, vectorChunks, keywordChunks, limit = 20 } = input;

  // key = `${document_id}:${chunk_id}`
  const map = new Map<
    string,
    { chunk_id: string; document_id: string; bestScore: number; sources: Set<RetrievalSource> }
  >();

  function merge(hits: ChunkHit[]) {
    for (const hit of hits) {
      const key = `${hit.document_id}:${hit.chunk_id}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          chunk_id: hit.chunk_id,
          document_id: hit.document_id,
          bestScore: hit.score,
          sources: new Set([hit.source]),
        });
      } else {
        if (hit.score > existing.bestScore) {
          existing.bestScore = hit.score;
        }
        existing.sources.add(hit.source);
      }
    }
  }

  merge(entityChunks);
  merge(vectorChunks);
  merge(keywordChunks);

  const results: FusedChunkHit[] = [];
  for (const entry of map.values()) {
    const bonus = Math.min((entry.sources.size - 1) * 0.05, 0.15);
    results.push({
      chunk_id: entry.chunk_id,
      document_id: entry.document_id,
      score: Math.min(entry.bestScore + bonus, 1.0),
      sources: Array.from(entry.sources),
    });
  }

  // Sort: score descending, then chunk_id ascending for determinism
  results.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-9) {
      return diff;
    }
    return a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0;
  });

  return results.slice(0, limit);
}
