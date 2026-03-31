import type { DatabaseSync } from "node:sqlite";
import { buildContextPack } from "./context-pack.js";
import { matchEntitiesForQuery } from "./entity-matcher.js";
import { retrieveByEntities } from "./entity-retriever.js";
import { expandEntityNeighborhood, type GraphExpansionOptions } from "./graph-expander.js";
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
  /**
   * Enable one-hop graph expansion (Phase 4).
   * When true (or an options object), matched entities are expanded along
   * their graph edges before fusion.
   */
  graphExpansion?: boolean | GraphExpansionOptions;
}

/**
 * Main retrieval pipeline (Phase 3 + Phase 4).
 *
 * Order of operations:
 * 1. Entity matching — find entities by name or alias
 * 2. Entity-derived chunk retrieval — expand matched entities to chunks
 * 3. Graph expansion (Phase 4) — one-hop neighbor traversal with budget
 * 4. Accept injected vector + keyword hits (caller's responsibility)
 * 5. Rank fusion — merge and deduplicate all sources
 * 6. Context pack assembly — return structured output
 */
export function retrieveContext(options: RetrievalPipelineOptions): ContextPack {
  const { db, query, vectorHits = [], keywordHits = [], limit = 20 } = options;

  // 1. Entity matching
  const matchedEntities = matchEntitiesForQuery(db, query);

  // 2. Entity-derived chunks
  const entityChunks = retrieveByEntities(db, matchedEntities);

  // 3. Graph expansion (Phase 4)
  const expansionOpts: GraphExpansionOptions | null =
    options.graphExpansion === true
      ? {}
      : options.graphExpansion && typeof options.graphExpansion === "object"
        ? options.graphExpansion
        : null;

  const { expandedEntities, graphChunks } = expansionOpts
    ? expandEntityNeighborhood(db, matchedEntities, expansionOpts)
    : { expandedEntities: [], graphChunks: [] };

  // 4. Fusion — include graph-derived chunks alongside entity/vector/keyword
  const fusedChunks = fuseRetrievalResults({
    entityChunks: [...entityChunks, ...graphChunks],
    vectorChunks: vectorHits,
    keywordChunks: keywordHits,
    limit,
  });

  // 5. Context pack
  return buildContextPack({
    query,
    matchedEntities,
    entityChunks,
    vectorChunks: vectorHits,
    keywordChunks: keywordHits,
    expandedEntities,
    graphChunks,
    fusedChunks,
  });
}
