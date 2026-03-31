// Shared types for the retrieval pipeline (Phase 3+4+5).

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

// ── Phase 5: Prompt Adapter types ──────────────────────────────────

/** Chunk metadata needed by the prompt adapter to render content. */
export interface ChunkContent {
  context: string;
  content: string;
  priority: "high" | "medium" | "low";
}

/** Entity metadata needed by the prompt adapter beyond what EntityMatch provides. */
export interface EntityDetail {
  type: string;
  preconditions: string[];
  postconditions: string[];
}

/** A labelled section in the assembled prompt. */
export interface PromptSection {
  /** Section heading (e.g. "Relevant Entities", "Supporting Chunks"). */
  label: string;
  /** Rendered text content for this section. */
  content: string;
  /** Priority tier for token-budget trimming (higher = harder to trim). */
  priority: number;
}

/** Token usage accounting. */
export interface TokenUsage {
  /** Estimated token count of the rendered prompt. */
  estimated: number;
  /** Configured hard token limit. */
  limit: number;
}

/** The structured prompt context output from the prompt adapter (Phase 5). */
export interface PromptContext {
  query: string;
  sections: PromptSection[];
  token_usage: TokenUsage;
}
