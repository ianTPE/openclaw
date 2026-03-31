// Shared types for Phase 3 retrieval pipeline.

import type { EntityMatch } from "../formats/ctxfst/types.js";

export type RetrievalSource = "entity" | "vector" | "keyword";

/** A single retrieved chunk with its origin and relevance score. */
export interface ChunkHit {
  chunk_id: string;
  document_id: string;
  score: number;
  source: RetrievalSource;
}

/** A chunk that appeared in multiple retrieval paths; score is the best across sources. */
export interface FusedChunkHit {
  chunk_id: string;
  document_id: string;
  score: number;
  sources: RetrievalSource[];
}

/** The fully assembled context pack for a single query. */
export interface ContextPack {
  query: string;
  matched_entities: EntityMatch[];
  entity_chunks: ChunkHit[];
  vector_chunks: ChunkHit[];
  keyword_chunks: ChunkHit[];
  /** Deduplicated and ranked final list. */
  fused_chunks: FusedChunkHit[];
}
