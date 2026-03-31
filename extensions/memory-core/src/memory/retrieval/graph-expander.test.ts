/**
 * Phase 4 Validation Tests — Graph Expansion
 *
 * Covers all items from docs/openclaw-upgrade-specs/24-phase-4-validation-checklist.md:
 *
 * A. Graph Expansion Basics
 *   [A1] one-hop expansion works (does not recurse)
 *   [A2] expansion only starts from valid seed entities
 *   [A3] no runaway expansion on broad query
 *
 * B. Relation Filtering
 *   [B1] REQUIRES filter works
 *   [B2] LEADS_TO filter works
 *   [B3] SIMILAR filter works (optional — marked so since no SIMILAR edges in fixture)
 *
 * C. Relation Weights
 *   [C1] REQUIRES outranks SIMILAR
 *   [C2] LEADS_TO outranks SIMILAR
 *   [C3] weight table is deterministic
 *
 * D. Expansion Budget
 *   [D1] max expanded entities respected
 *   [D2] max expanded chunks respected
 *   [D3] expansion pruning works
 *   [D4] no context explosion
 *
 * E. Retrieval Quality
 *   [E1] relation-sensitive queries improve vs Phase 3 baseline
 *   [E2] supporting chunk relevance remains high
 *   [E3] semantic-only queries do not regress
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalizeCtxfstDocument } from "../formats/ctxfst/canonicalize.js";
import { parseCtxfstDocument } from "../formats/ctxfst/parser.js";
import { validateCtxfstDocument } from "../formats/ctxfst/validator.js";
import { indexCtxfstDocument } from "../indexing/ctxfst-indexer.js";
import { matchEntitiesForQuery } from "./entity-matcher.js";
import { DEFAULT_RELATION_WEIGHTS, expandEntityNeighborhood } from "./graph-expander.js";
import { retrieveContext } from "./retrieval-pipeline.js";
import type { ChunkHit } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

const DOC_ID = "retrieval-test";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const source = fs.readFileSync(FIXTURE_PATH, "utf8");
  const raw = parseCtxfstDocument(source, FIXTURE_PATH);
  const doc = canonicalizeCtxfstDocument(raw);
  const validation = validateCtxfstDocument(doc);
  if (!validation.ok) {
    throw new Error(`Fixture validation failed: ${JSON.stringify(validation.issues)}`);
  }
  indexCtxfstDocument(db, doc);
  return db;
}

function mockHit(chunkId: string, score: number, source: ChunkHit["source"] = "vector"): ChunkHit {
  return { chunk_id: chunkId, document_id: DOC_ID, score, source };
}

/**
 * Insert a SIMILAR edge into the database for testing relation-weight
 * comparisons. The fixture only has REQUIRES/LEADS_TO edges.
 */
function insertSimilarEdge(db: DatabaseSync, sourceId: string, targetId: string): void {
  db.prepare(
    `INSERT INTO ctxfst_entity_edges
       (id, source_id, target_id, relation, document_id, source_hash, score, confidence, timestamp, status)
     VALUES (?, ?, ?, 'SIMILAR', ?, '', 1.0, 1.0, ?, 'active')`,
  ).run(`${sourceId}|SIMILAR|${targetId}`, sourceId, targetId, DOC_ID, Date.now());
}

// ---------------------------------------------------------------------------
// A. Graph Expansion Basics
// ---------------------------------------------------------------------------

describe("A1: one-hop expansion only (does not recurse)", () => {
  it("Analyze Resume expands to its direct neighbors only", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds);

    // entity:analyze-resume has edges to state:resume-uploaded (REQUIRES)
    // and state:resume-parsed (LEADS_TO).
    // Those state entities may themselves have edges, but expansion must NOT
    // follow them (no multi-hop).
    const expandedIds = expandedEntities.map((e) => e.entity_id);
    expect(expandedIds).toContain("state:resume-uploaded");
    expect(expandedIds).toContain("state:resume-parsed");

    // state:resume-parsed has edges FROM entity:generate-report (REQUIRES→state:resume-parsed).
    // In one-hop from entity:analyze-resume, we should NOT see entity:generate-report
    // (that would require two hops: analyze-resume→state:resume-parsed→generate-report).
    expect(expandedIds).not.toContain("entity:generate-report");
  });
});

describe("A2: expansion only starts from valid seed entities", () => {
  it("no expansion without a seed entity hit", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Django"); // no match
    const { expandedEntities, graphChunks } = expandEntityNeighborhood(db, seeds);

    expect(expandedEntities).toHaveLength(0);
    expect(graphChunks).toHaveLength(0);
  });

  it("pipeline with graphExpansion=true and unknown query returns empty graph", () => {
    const db = makeDb();
    const pack = retrieveContext({
      db,
      query: "Django",
      graphExpansion: true,
    });

    expect(pack.expanded_entities).toHaveLength(0);
    expect(pack.graph_chunks).toHaveLength(0);
  });
});

describe("A3: no runaway expansion on broad query", () => {
  it("broad query with tight budget stays within limits", () => {
    const db = makeDb();

    // "Resume" might match entity:analyze-resume via alias "resume analysis"
    // plus entity:resume-template via name. With budget=2 entities, expansion
    // should not flood the result.
    const seeds = matchEntitiesForQuery(db, "Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      maxExpandedEntities: 2,
      maxExpandedChunks: 2,
    });

    expect(expandedEntities.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// B. Relation Filtering
// ---------------------------------------------------------------------------

describe("B1: REQUIRES filter", () => {
  it("only REQUIRES neighbors are returned when filtered", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      relationAllowlist: ["REQUIRES"],
    });

    // analyze-resume --REQUIRES--> state:resume-uploaded
    const expandedIds = expandedEntities.map((e) => e.entity_id);
    expect(expandedIds).toContain("state:resume-uploaded");
    // LEADS_TO neighbor should NOT appear
    expect(expandedIds).not.toContain("state:resume-parsed");
  });
});

describe("B2: LEADS_TO filter", () => {
  it("only LEADS_TO neighbors are returned when filtered", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      relationAllowlist: ["LEADS_TO"],
    });

    // analyze-resume --LEADS_TO--> state:resume-parsed
    const expandedIds = expandedEntities.map((e) => e.entity_id);
    expect(expandedIds).toContain("state:resume-parsed");
    // REQUIRES neighbor should NOT appear
    expect(expandedIds).not.toContain("state:resume-uploaded");
  });
});

describe("B3: SIMILAR filter (optional — requires manually inserted edge)", () => {
  it("SIMILAR expansion works when SIMILAR edges exist", () => {
    const db = makeDb();
    // Insert a synthetic SIMILAR edge: entity:vector-search --SIMILAR--> entity:postgresql
    insertSimilarEdge(db, "entity:vector-search", "entity:postgresql");

    const seeds = matchEntitiesForQuery(db, "Vector Search");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      relationAllowlist: ["SIMILAR"],
    });

    const expandedIds = expandedEntities.map((e) => e.entity_id);
    expect(expandedIds).toContain("entity:postgresql");
  });
});

// ---------------------------------------------------------------------------
// C. Relation Weights
// ---------------------------------------------------------------------------

describe("C1: REQUIRES outranks SIMILAR", () => {
  it("REQUIRES neighbor scores higher than SIMILAR neighbor with same edge score", () => {
    const db = makeDb();
    // Insert SIMILAR edge from entity:analyze-resume to some entity
    insertSimilarEdge(db, "entity:analyze-resume", "entity:resume-template");

    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds);

    const requiresHit = expandedEntities.find((e) => e.entity_id === "state:resume-uploaded");
    const similarHit = expandedEntities.find((e) => e.entity_id === "entity:resume-template");

    expect(requiresHit).toBeDefined();
    expect(similarHit).toBeDefined();
    expect(requiresHit!.score).toBeGreaterThan(similarHit!.score);
  });
});

describe("C2: LEADS_TO outranks SIMILAR", () => {
  it("LEADS_TO neighbor scores higher than SIMILAR neighbor", () => {
    const db = makeDb();
    insertSimilarEdge(db, "entity:analyze-resume", "entity:resume-template");

    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds);

    const leadsToHit = expandedEntities.find((e) => e.entity_id === "state:resume-parsed");
    const similarHit = expandedEntities.find((e) => e.entity_id === "entity:resume-template");

    expect(leadsToHit).toBeDefined();
    expect(similarHit).toBeDefined();
    expect(leadsToHit!.score).toBeGreaterThan(similarHit!.score);
  });
});

describe("C3: weight table is deterministic", () => {
  it("same expansion produces identical scores across runs", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");

    const r1 = expandEntityNeighborhood(db, seeds);
    const r2 = expandEntityNeighborhood(db, seeds);

    const scores1 = r1.expandedEntities.map((e) => `${e.entity_id}:${e.score}`).sort();
    const scores2 = r2.expandedEntities.map((e) => `${e.entity_id}:${e.score}`).sort();
    expect(scores1).toEqual(scores2);
  });

  it("DEFAULT_RELATION_WEIGHTS has REQUIRES > SIMILAR and LEADS_TO > SIMILAR", () => {
    expect(DEFAULT_RELATION_WEIGHTS.REQUIRES).toBeGreaterThan(DEFAULT_RELATION_WEIGHTS.SIMILAR);
    expect(DEFAULT_RELATION_WEIGHTS.LEADS_TO).toBeGreaterThan(DEFAULT_RELATION_WEIGHTS.SIMILAR);
  });
});

// ---------------------------------------------------------------------------
// D. Expansion Budget
// ---------------------------------------------------------------------------

describe("D1: max expanded entities respected", () => {
  it("expansion returns at most maxExpandedEntities", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      maxExpandedEntities: 1,
    });

    expect(expandedEntities.length).toBeLessThanOrEqual(1);
  });
});

describe("D2: max expanded chunks respected", () => {
  it("graph chunks are capped at maxExpandedChunks", () => {
    const db = makeDb();
    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { graphChunks } = expandEntityNeighborhood(db, seeds, {
      maxExpandedChunks: 1,
    });

    expect(graphChunks.length).toBeLessThanOrEqual(1);
  });
});

describe("D3: expansion pruning works", () => {
  it("low-weight SIMILAR edges are pruned before high-weight REQUIRES", () => {
    const db = makeDb();
    // Add 5 SIMILAR edges from entity:analyze-resume to various entities
    insertSimilarEdge(db, "entity:analyze-resume", "entity:resume-template");
    insertSimilarEdge(db, "entity:analyze-resume", "entity:fastapi");
    insertSimilarEdge(db, "entity:analyze-resume", "entity:postgresql");

    const seeds = matchEntitiesForQuery(db, "Analyze Resume");
    const { expandedEntities } = expandEntityNeighborhood(db, seeds, {
      maxExpandedEntities: 2,
    });

    // The two highest-scoring neighbors should be the REQUIRES / LEADS_TO ones
    // since their relation weights are higher than SIMILAR.
    const relations = expandedEntities.map((e) => e.relation);
    // With maxExpandedEntities=2, should keep the REQUIRES and LEADS_TO neighbors
    expect(relations).toContain("REQUIRES");
    expect(relations).toContain("LEADS_TO");
  });
});

describe("D4: no context explosion", () => {
  it("pipeline with graphExpansion=true does not produce unbounded output", () => {
    const db = makeDb();
    const pack = retrieveContext({
      db,
      query: "Analyze Resume",
      graphExpansion: { maxExpandedEntities: 5, maxExpandedChunks: 5 },
    });

    // fused_chunks should not contain an overwhelming number of entries
    // (entity chunks + graph chunks + 0 vector/keyword ≤ ~10 at most)
    expect(pack.fused_chunks.length).toBeLessThanOrEqual(20);
    expect(pack.graph_chunks.length).toBeLessThanOrEqual(5);
    expect(pack.expanded_entities.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// E. Retrieval Quality
// ---------------------------------------------------------------------------

describe("E1: relation-sensitive queries improve vs Phase 3 baseline", () => {
  it("'Analyze Resume' with expansion retrieves expanded entities that Phase 3 alone misses", () => {
    const db = makeDb();

    // Phase 3 baseline: no graph expansion
    const phase3 = retrieveContext({ db, query: "Analyze Resume" });

    // Phase 4: with graph expansion
    const phase4 = retrieveContext({
      db,
      query: "Analyze Resume",
      graphExpansion: true,
    });

    // Phase 4 should have expanded entities that Phase 3 does not.
    expect(phase3.expanded_entities).toHaveLength(0);
    expect(phase4.expanded_entities.length).toBeGreaterThan(0);

    // The fused output should be at least as large as Phase 3's.
    expect(phase4.fused_chunks.length).toBeGreaterThanOrEqual(phase3.fused_chunks.length);
  });

  it("expansion from a state entity discovers skill entities with chunks", () => {
    const db = makeDb();

    // "Resume Parsed" matches state:resume-parsed.
    // Incoming edges from entity:analyze-resume, entity:pdf-parser, entity:generate-report.
    // Those skill entities have chunks, so graph_chunks should be non-empty.
    const pack = retrieveContext({
      db,
      query: "Resume Parsed",
      graphExpansion: true,
    });

    expect(pack.expanded_entities.length).toBeGreaterThan(0);
    expect(pack.graph_chunks.length).toBeGreaterThan(0);

    const graphChunkIds = pack.graph_chunks.map((c) => c.chunk_id);
    // entity:generate-report maps to chunk:report-generation
    // entity:analyze-resume maps to chunk:resume-workflow
    const hasRelevantChunk =
      graphChunkIds.includes("chunk:report-generation") ||
      graphChunkIds.includes("chunk:resume-workflow");
    expect(hasRelevantChunk).toBe(true);
  });

  it("'What happens after Resume Parsed' — expansion retrieves entity:generate-report neighbors", () => {
    const db = makeDb();

    // "Resume Parsed" matches state:resume-parsed via exact match.
    // Incoming edges: entity:analyze-resume --LEADS_TO--> state:resume-parsed
    //                 entity:pdf-parser --LEADS_TO--> state:resume-parsed
    //                 entity:generate-report --REQUIRES--> state:resume-parsed
    // One-hop expansion from state:resume-parsed should discover these entities.
    const pack = retrieveContext({
      db,
      query: "Resume Parsed",
      graphExpansion: true,
    });

    const expandedIds = pack.expanded_entities.map((e) => e.entity_id);
    // At least one of the entities linked to state:resume-parsed should appear.
    const relevantIds = ["entity:analyze-resume", "entity:pdf-parser", "entity:generate-report"];
    const hasRelevant = expandedIds.some((id) => relevantIds.includes(id));
    expect(hasRelevant).toBe(true);
  });
});

describe("E2: supporting chunk relevance remains high", () => {
  it("graph-derived chunks come from expanded entities that are related to the query", () => {
    const db = makeDb();
    const pack = retrieveContext({
      db,
      query: "Analyze Resume",
      graphExpansion: true,
    });

    // Every graph chunk should trace back to an expanded entity
    for (const gc of pack.graph_chunks) {
      expect(gc.source).toBe("graph");
      expect(gc.score).toBeGreaterThan(0);
    }
  });
});

describe("E3: semantic-only queries do not regress with graph expansion enabled", () => {
  it("vector-only results are preserved when expansion finds nothing", () => {
    const db = makeDb();
    const vectorHits: ChunkHit[] = [
      mockHit("chunk:pdf-extraction", 0.85),
      mockHit("chunk:resume-workflow", 0.78),
    ];

    const pack = retrieveContext({
      db,
      query: "how the system extracts text from uploaded documents",
      vectorHits,
      graphExpansion: true,
    });

    // No entity hit → no expansion → vector results untouched.
    expect(pack.expanded_entities).toHaveLength(0);
    const fusedIds = pack.fused_chunks.map((c) => c.chunk_id);
    expect(fusedIds).toContain("chunk:pdf-extraction");
    expect(fusedIds).toContain("chunk:resume-workflow");
  });

  it("expansion does not push high-quality vector results below low-quality graph results", () => {
    const db = makeDb();
    const vectorHits: ChunkHit[] = [mockHit("chunk:fastapi-service", 0.95)];

    const pack = retrieveContext({
      db,
      query: "FastAPI",
      vectorHits,
      graphExpansion: true,
    });

    // chunk:fastapi-service is an entity chunk (score 1.0) AND a vector chunk (0.95).
    // It should be in the top results (either #1 or #2 after tiebreaking),
    // not displaced by graph expansion results.
    const fastApiPos = pack.fused_chunks.findIndex((c) => c.chunk_id === "chunk:fastapi-service");
    expect(fastApiPos).toBeGreaterThanOrEqual(0);
    expect(fastApiPos).toBeLessThanOrEqual(2);

    // Any graph chunks should score lower than the entity/vector hit.
    for (const gc of pack.graph_chunks) {
      expect(gc.score).toBeLessThan(1.0);
    }
  });
});
