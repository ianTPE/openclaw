import type { DatabaseSync } from "node:sqlite";
import { buildContextPack } from "./context-pack.js";
import { matchEntitiesForQuery } from "./entity-matcher.js";
import { retrieveByEntities } from "./entity-retriever.js";
import { fuseRetrievalResults } from "./rank-fusion.js";
import type { ChunkHit, ContextPack } from "./types.js";

export interface RetrievalPipelineOptions {
  db: DatabaseSync;
  query: string;
  /**
   * Pre-computed vector hits. In production these come from the embedding
   * search layer; in tests they can be injected directly to exercise fusion
   * without a real embedding model.
   */
  vectorHits?: ChunkHit[];
  /**
   * Pre-computed keyword / FTS hits. Same injection point as vectorHits.
   */
  keywordHits?: ChunkHit[];
  /** Maximum chunks returned in the fused output. Defaults to 20. */
  limit?: number;
}

/**
 * Main Phase 3 retrieval pipeline.
 *
 * Order of operations:
 * 1. Entity matching — find entities by name or alias
 * 2. Entity-derived chunk retrieval — expand matched entities to chunks
 * 3. Accept injected vector + keyword hits (caller's responsibility)
 * 4. Rank fusion — merge and deduplicate all sources
 * 5. Context pack assembly — return structured output
 */
export function retrieveContext(options: RetrievalPipelineOptions): ContextPack {
  const { db, query, vectorHits = [], keywordHits = [], limit = 20 } = options;

  // 1. Entity matching
  const matchedEntities = matchEntitiesForQuery(db, query);

  // 2. Entity-derived chunks
  const entityChunks = retrieveByEntities(db, matchedEntities);

  // 3. Fusion
  const fusedChunks = fuseRetrievalResults({
    entityChunks,
    vectorChunks: vectorHits,
    keywordChunks: keywordHits,
    limit,
  });

  // 4. Context pack
  return buildContextPack({
    query,
    matchedEntities,
    entityChunks,
    vectorChunks: vectorHits,
    keywordChunks: keywordHits,
    fusedChunks,
  });
}
