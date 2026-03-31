// Shared types for the retrieval pipeline (Phase 3+4).

import type { EntityMatch } from "../formats/ctxfst/types.js";

export type RetrievalSource = "entity" | "vector" | "keyword" | "graph";

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

/** An entity discovered via graph expansion (Phase 4). */
export interface ExpandedEntity {
  entity_id: string;
  name: string;
  relation: string;
  /** Weighted score: baseEntityScore × relationWeight. */
  score: number;
  document_id: string;
}

/** The fully assembled context pack for a single query. */
export interface ContextPack {
  query: string;
  matched_entities: EntityMatch[];
  entity_chunks: ChunkHit[];
  vector_chunks: ChunkHit[];
  keyword_chunks: ChunkHit[];
  /** Entities discovered via one-hop graph expansion. */
  expanded_entities: ExpandedEntity[];
  /** Chunks derived from graph-expanded entities. */
  graph_chunks: ChunkHit[];
  /** Deduplicated and ranked final list. */
  fused_chunks: FusedChunkHit[];
}
