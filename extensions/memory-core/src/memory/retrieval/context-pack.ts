import type { EntityMatch } from "../formats/ctxfst/types.js";
import type { EntityMatchWithScore } from "./entity-matcher.js";
import type { fuseRetrievalResults } from "./rank-fusion.js";
import type { ChunkHit, ContextPack, ExpandedEntity } from "./types.js";

export interface ContextPackInput {
  query: string;
  matchedEntities: EntityMatchWithScore[];
  entityChunks: ChunkHit[];
  vectorChunks: ChunkHit[];
  keywordChunks: ChunkHit[];
  expandedEntities?: ExpandedEntity[];
  graphChunks?: ChunkHit[];
  fusedChunks: ReturnType<typeof fuseRetrievalResults>;
}

/**
 * Assemble the final ContextPack from pre-computed retrieval results.
 * The pack is the canonical output handed off to the prompt adapter (Phase 5).
 */
export function buildContextPack(input: ContextPackInput): ContextPack {
  // Strip the score field from matched entities for the public shape
  // (EntityMatch doesn't carry score; EntityMatchWithScore does)
  const matched_entities: EntityMatch[] = input.matchedEntities.map(
    ({ entity_id, name, match_type, document_id }) => ({
      entity_id,
      name,
      match_type,
      document_id,
    }),
  );

  return {
    query: input.query,
    matched_entities,
    entity_chunks: input.entityChunks,
    vector_chunks: input.vectorChunks,
    keyword_chunks: input.keywordChunks,
    expanded_entities: input.expandedEntities ?? [],
    graph_chunks: input.graphChunks ?? [],
    fused_chunks: input.fusedChunks,
  };
}
