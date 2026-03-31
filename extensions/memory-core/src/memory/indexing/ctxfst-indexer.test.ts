/**
 * Phase 2 Validation Tests — Entity-Aware Indexing
 *
 * Covers all items from docs/openclaw-upgrade-specs/22-phase-2-validation-checklist.md:
 *
 * A. Entity Persistence
 *   [A1] entities persisted with correct count and fields
 *   [A2] chunk_entities mapping matches fixture
 *   [A3] source hash and document version persisted
 *   [A4] auto-inferred REQUIRES / LEADS_TO edges from preconditions / postconditions
 *
 * B. Reindex
 *   [B1] reindex idempotence (no duplicates)
 *   [B2] update cleanup (orphaned data removed)
 *   [B3] source hash change detection works
 *
 * C. Entity Lookup
 *   [C1] exact entity name lookup
 *   [C2] alias lookup
 *   [C3] case-insensitive lookup
 *   [C4] unknown entity query returns empty
 *
 * D. Entity-to-Chunk Reverse Lookup
 *   [D1] framework entity → chunks
 *   [D2] tool entity → chunks
 *   [D3] multi-chunk entity
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalizeCtxfstDocument } from "../formats/ctxfst/canonicalize.js";
import { parseCtxfstDocument } from "../formats/ctxfst/parser.js";
import { validateCtxfstDocument } from "../formats/ctxfst/validator.js";
import { indexCtxfstDocument } from "./ctxfst-indexer.js";
import { entityLookup, findEntitiesByQuery, getChunksForEntity } from "./entity-index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

function loadFixture(): string {
  return fs.readFileSync(FIXTURE_PATH, "utf8");
}

function makeDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

function indexFixture(db: DatabaseSync, source?: string) {
  const src = source ?? loadFixture();
  const raw = parseCtxfstDocument(src, FIXTURE_PATH);
  const doc = canonicalizeCtxfstDocument(raw);
  const validation = validateCtxfstDocument(doc);
  expect(validation.ok, `fixture validation failed: ${JSON.stringify(validation.issues)}`).toBe(
    true,
  );
  return { doc, result: indexCtxfstDocument(db, doc) };
}

// ---------------------------------------------------------------------------
// A. Entity Persistence
// ---------------------------------------------------------------------------

describe("A1: entities persisted with correct count and fields", () => {
  it("writes 10 entities with correct ids, names, types", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const rows = db
      .prepare("SELECT id, name, type FROM ctxfst_entities WHERE document_id = ? ORDER BY id")
      .all(doc.id) as Array<{ id: string; name: string; type: string }>;

    expect(rows).toHaveLength(10);

    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(
      [
        "entity:analyze-resume",
        "entity:fastapi",
        "entity:generate-report",
        "entity:pdf-parser",
        "entity:postgresql",
        "entity:resume-template",
        "entity:vector-search",
        "state:analysis-complete",
        "state:resume-parsed",
        "state:resume-uploaded",
      ].sort(),
    );
  });

  it("persists aliases, preconditions, postconditions as JSON", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const row = db
      .prepare(
        "SELECT aliases_json, preconditions_json, postconditions_json FROM ctxfst_entities WHERE id = ? AND document_id = ?",
      )
      .get("entity:fastapi", doc.id) as
      | { aliases_json: string; preconditions_json: string; postconditions_json: string }
      | undefined;

    expect(row).toBeDefined();
    expect(JSON.parse(row!.aliases_json)).toContain("fast-api");
    expect(JSON.parse(row!.aliases_json)).toContain("fastapi-framework");
    expect(JSON.parse(row!.preconditions_json)).toHaveLength(0);
    expect(JSON.parse(row!.postconditions_json)).toHaveLength(0);
  });

  it("no duplicate entity rows", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const rows = db
      .prepare(
        "SELECT id, COUNT(*) as cnt FROM ctxfst_entities WHERE document_id = ? GROUP BY id HAVING cnt > 1",
      )
      .all(doc.id) as Array<{ id: string; cnt: number }>;

    expect(rows).toHaveLength(0);
  });
});

describe("A2: chunk-entity mapping matches fixture", () => {
  const expectedMappings: Record<string, string[]> = {
    "chunk:fastapi-service": ["entity:fastapi", "entity:postgresql"],
    "chunk:resume-workflow": ["entity:analyze-resume", "entity:pdf-parser"],
    "chunk:vector-indexing": ["entity:vector-search", "entity:postgresql"],
    "chunk:pdf-extraction": ["entity:pdf-parser"],
    "chunk:api-endpoints": ["entity:fastapi"],
    "chunk:search-ranking": ["entity:vector-search"],
    "chunk:report-generation": ["entity:generate-report"],
    "chunk:resume-template-guide": ["entity:resume-template"],
  };

  it("every chunk has correct entity mappings", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    for (const [chunkId, expectedEntities] of Object.entries(expectedMappings)) {
      const rows = db
        .prepare(
          "SELECT entity_id FROM ctxfst_chunk_entities WHERE chunk_id = ? AND document_id = ? ORDER BY entity_id",
        )
        .all(chunkId, doc.id) as Array<{ entity_id: string }>;

      const actual = rows.map((r) => r.entity_id).sort();
      const expected = [...expectedEntities].sort();
      expect(actual, `chunk ${chunkId} mappings`).toEqual(expected);
    }
  });

  it("total mapping count is 11", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM ctxfst_chunk_entities WHERE document_id = ?")
      .get(doc.id) as { cnt: number };

    expect(row.cnt).toBe(11);
  });
});

describe("A3: source hash and document version persisted", () => {
  it("document row exists with source_hash and document_version", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const row = db
      .prepare("SELECT source_hash, document_version FROM ctxfst_documents WHERE id = ?")
      .get(doc.id) as { source_hash: string; document_version: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.source_hash).toBeTruthy();
    expect(row!.source_hash).toHaveLength(64); // sha256 hex
    expect(row!.document_version).toBe("1.0");
  });
});

describe("A4: auto-inferred edges from preconditions / postconditions", () => {
  it("creates REQUIRES edges from preconditions", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const rows = db
      .prepare(
        "SELECT source_id, target_id FROM ctxfst_entity_edges WHERE document_id = ? AND relation = 'REQUIRES' ORDER BY source_id, target_id",
      )
      .all(doc.id) as Array<{ source_id: string; target_id: string }>;

    const pairs = rows.map((r) => `${r.source_id} --> ${r.target_id}`);
    expect(pairs).toContain("entity:analyze-resume --> state:resume-uploaded");
    expect(pairs).toContain("entity:pdf-parser --> state:resume-uploaded");
    expect(pairs).toContain("entity:generate-report --> state:resume-parsed");
  });

  it("creates LEADS_TO edges from postconditions", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const rows = db
      .prepare(
        "SELECT source_id, target_id FROM ctxfst_entity_edges WHERE document_id = ? AND relation = 'LEADS_TO' ORDER BY source_id, target_id",
      )
      .all(doc.id) as Array<{ source_id: string; target_id: string }>;

    const pairs = rows.map((r) => `${r.source_id} --> ${r.target_id}`);
    expect(pairs).toContain("entity:analyze-resume --> state:resume-parsed");
    expect(pairs).toContain("entity:pdf-parser --> state:resume-parsed");
    expect(pairs).toContain("entity:generate-report --> state:analysis-complete");
  });

  it("at least 6 auto-inferred static edges", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    const row = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM ctxfst_entity_edges WHERE document_id = ? AND (relation = 'REQUIRES' OR relation = 'LEADS_TO')",
      )
      .get(doc.id) as { cnt: number };

    expect(row.cnt).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// B. Reindex
// ---------------------------------------------------------------------------

describe("B1: reindex idempotence", () => {
  it("second index of same source produces no duplicates", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    // Re-index the same source
    indexFixture(db);

    const entityCount = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM ctxfst_entities WHERE document_id = ?")
        .get(doc.id) as { cnt: number }
    ).cnt;
    const mappingCount = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM ctxfst_chunk_entities WHERE document_id = ?")
        .get(doc.id) as { cnt: number }
    ).cnt;

    expect(entityCount).toBe(10);
    expect(mappingCount).toBe(11);
  });

  it("second index of same source is skipped (same hash)", () => {
    const db = makeDb();
    indexFixture(db);
    const { result } = indexFixture(db);
    expect(result.skipped).toBe(true);
  });
});

describe("B2: update cleanup removes orphaned data", () => {
  it("removing entities from source clears old records", () => {
    const db = makeDb();
    const { doc } = indexFixture(db);

    // Modify the source to remove entity:resume-template and its chunk
    const original = loadFixture();
    const modified = original
      .replace(/  - id: entity:resume-template[\s\S]*?(?=  - id:|\nchunks:)/, "")
      .replace(/  - id: chunk:resume-template-guide[\s\S]*?(?=  - id:|\n---)/, "")
      .replace(/<Chunk id="chunk:resume-template-guide">[\s\S]*?<\/Chunk>\s*/g, "");

    // Re-index with modified source
    const rawModified = parseCtxfstDocument(modified, FIXTURE_PATH);
    // Give it a different hash by tweaking the id
    const docModified = canonicalizeCtxfstDocument(rawModified);
    indexCtxfstDocument(db, docModified);

    // Old entity should be gone
    const row = db
      .prepare("SELECT id FROM ctxfst_entities WHERE id = ? AND document_id = ?")
      .get("entity:resume-template", doc.id);
    expect(row).toBeUndefined();

    // Old mapping should be gone
    const mappingRow = db
      .prepare("SELECT chunk_id FROM ctxfst_chunk_entities WHERE chunk_id = ? AND document_id = ?")
      .get("chunk:resume-template-guide", doc.id);
    expect(mappingRow).toBeUndefined();
  });
});

describe("B3: source hash change detection", () => {
  it("unchanged source is skipped", () => {
    const db = makeDb();
    indexFixture(db);
    const { result } = indexFixture(db);
    expect(result.skipped).toBe(true);
  });

  it("changed source triggers full reindex (not skipped)", () => {
    const db = makeDb();
    indexFixture(db);

    const original = loadFixture();
    const modified = original.replace("Resume Analysis Workflow", "Resume Analysis Workflow v2");

    const rawModified = parseCtxfstDocument(modified, FIXTURE_PATH);
    const docModified = canonicalizeCtxfstDocument(rawModified);
    const result = indexCtxfstDocument(db, docModified);

    expect(result.skipped).toBe(false);

    // Source hash should be updated
    const row = db
      .prepare("SELECT source_hash FROM ctxfst_documents WHERE id = ?")
      .get(docModified.id) as { source_hash: string };
    expect(row.source_hash).toBe(docModified.source_hash);
  });
});

// ---------------------------------------------------------------------------
// C. Entity Lookup
// ---------------------------------------------------------------------------

describe("C1: exact entity name lookup", () => {
  it.each([
    ["FastAPI", "entity:fastapi"],
    ["Analyze Resume", "entity:analyze-resume"],
    ["PostgreSQL", "entity:postgresql"],
  ])('query "%s" matches entity %s', (query, expectedId) => {
    const db = makeDb();
    indexFixture(db);

    const matches = findEntitiesByQuery(db, query);
    expect(matches).toHaveLength(1);
    expect(matches[0].entity_id).toBe(expectedId);
    expect(matches[0].match_type).toBe("exact");
  });
});

describe("C2: alias lookup", () => {
  it.each([
    ["fast-api", "entity:fastapi"],
    ["resume analysis", "entity:analyze-resume"],
    ["pg", "entity:postgresql"],
    ["semantic search", "entity:vector-search"],
  ])('alias query "%s" matches entity %s', (query, expectedId) => {
    const db = makeDb();
    indexFixture(db);

    const matches = findEntitiesByQuery(db, query);
    expect(matches).toHaveLength(1);
    expect(matches[0].entity_id).toBe(expectedId);
    expect(matches[0].match_type).toBe("alias");
  });
});

describe("C3: case-insensitive lookup", () => {
  it.each(["FASTAPI", "fastapi", "FastAPI", "Fastapi"])(
    'query "%s" matches entity:fastapi',
    (query) => {
      const db = makeDb();
      indexFixture(db);

      const matches = findEntitiesByQuery(db, query);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].entity_id).toBe("entity:fastapi");
    },
  );
});

describe("C4: unknown entity query returns empty", () => {
  it("query for a non-existent entity returns no matches", () => {
    const db = makeDb();
    indexFixture(db);

    const matches = findEntitiesByQuery(db, "Django");
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D. Entity-to-Chunk Reverse Lookup
// ---------------------------------------------------------------------------

describe("D1: framework entity → chunks", () => {
  it("entity:fastapi reverse-looks up chunk:fastapi-service and chunk:api-endpoints", () => {
    const db = makeDb();
    indexFixture(db);

    const chunks = getChunksForEntity(db, "entity:fastapi").sort();
    expect(chunks).toEqual(["chunk:api-endpoints", "chunk:fastapi-service"].sort());
  });
});

describe("D2: tool entity → chunks", () => {
  it("entity:pdf-parser reverse-looks up chunk:resume-workflow and chunk:pdf-extraction", () => {
    const db = makeDb();
    indexFixture(db);

    const chunks = getChunksForEntity(db, "entity:pdf-parser").sort();
    expect(chunks).toEqual(["chunk:pdf-extraction", "chunk:resume-workflow"].sort());
  });
});

describe("D3: multi-chunk entity", () => {
  it("entity:postgresql reverse-looks up chunk:fastapi-service and chunk:vector-indexing", () => {
    const db = makeDb();
    indexFixture(db);

    const chunks = getChunksForEntity(db, "entity:postgresql").sort();
    expect(chunks).toEqual(["chunk:fastapi-service", "chunk:vector-indexing"].sort());
  });
});

// ---------------------------------------------------------------------------
// Integration: entityLookup high-level API
// ---------------------------------------------------------------------------

describe("entityLookup integration", () => {
  it("returns full result with entity id, match type, and reverse chunks", () => {
    const db = makeDb();
    indexFixture(db);

    const result = entityLookup(db, "fast-api");
    expect(result.matched_entity).toBe("entity:fastapi");
    expect(result.match_type).toBe("alias");
    expect(result.reverse_chunks.sort()).toEqual(
      ["chunk:fastapi-service", "chunk:api-endpoints"].sort(),
    );
  });

  it("returns null for unknown query", () => {
    const db = makeDb();
    indexFixture(db);

    const result = entityLookup(db, "Django");
    expect(result.matched_entity).toBeNull();
    expect(result.match_type).toBeNull();
    expect(result.reverse_chunks).toHaveLength(0);
  });
});
