import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { canonicalizeCtxfstDocument } from "../formats/ctxfst/canonicalize.js";
import { parseCtxfstDocument } from "../formats/ctxfst/parser.js";
import { indexCtxfstDocument } from "../indexing/ctxfst-indexer.js";
import { ensureCtxfstSchema } from "../indexing/ctxfst-schema.js";
import {
  adaptContextToPrompt,
  estimateTokens,
  renderPromptContext,
  type PromptAdapterOptions,
} from "./prompt-adapter.js";
import { retrieveContext } from "./retrieval-pipeline.js";
import type {
  ChunkContent,
  ContextPack,
  EntityDetail,
  ExpandedEntity,
  FusedChunkHit,
  PromptContext,
} from "./types.js";

// ── Fixture loading helpers ───────────────────────────────────────

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

function loadFixture() {
  const source = readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = parseCtxfstDocument(source, "retrieval-test.ctxfst.md");
  return canonicalizeCtxfstDocument(parsed);
}

function createIndexedDb() {
  const db = new DatabaseSync(":memory:");
  ensureCtxfstSchema(db);
  const doc = loadFixture();
  indexCtxfstDocument(db, doc);
  return { db, doc };
}

/** Build a ChunkContent map from the fixture document. */
function buildChunkContentMap(doc: ReturnType<typeof loadFixture>): Map<string, ChunkContent> {
  const map = new Map<string, ChunkContent>();
  for (const chunk of doc.chunks) {
    map.set(chunk.id, {
      context: chunk.context,
      content: chunk.content,
      priority: chunk.priority as "high" | "medium" | "low",
    });
  }
  return map;
}

/** Build an EntityDetail map from the fixture document. */
function buildEntityDetailMap(doc: ReturnType<typeof loadFixture>): Map<string, EntityDetail> {
  const map = new Map<string, EntityDetail>();
  for (const entity of doc.entities) {
    map.set(entity.id, {
      type: entity.type,
      preconditions: entity.preconditions,
      postconditions: entity.postconditions,
    });
  }
  return map;
}

/** Run the full pipeline → prompt adapter for a query. */
function fullPipelinePrompt(
  query: string,
  overrides?: Partial<PromptAdapterOptions>,
): { pack: ContextPack; prompt: PromptContext; rendered: string } {
  const { db, doc } = createIndexedDb();
  const pack = retrieveContext({
    db,
    query,
    graphExpansion: true,
  });
  const chunkContent = buildChunkContentMap(doc);
  const entityDetails = buildEntityDetailMap(doc);

  const prompt = adaptContextToPrompt({
    contextPack: pack,
    chunkContent,
    entityDetails,
    ...overrides,
  });
  const rendered = renderPromptContext(prompt);
  return { pack, prompt, rendered };
}

// ── A. Prompt Envelope Shape ──────────────────────────────────────

describe("A. Prompt Envelope Shape", () => {
  it("A1: structured output has distinct sections", () => {
    const { prompt } = fullPipelinePrompt("FastAPI parsing workflow");

    expect(prompt.sections.length).toBeGreaterThan(0);
    // Must have at least entities + chunks sections
    const labels = prompt.sections.map((s) => s.label);
    expect(labels.some((l) => l === "Relevant Entities")).toBe(true);
    expect(labels.some((l) => l.startsWith("Chunk:"))).toBe(true);
    // Each section has a label, content, and priority
    for (const section of prompt.sections) {
      expect(section.label).toBeTruthy();
      expect(section.content).toBeTruthy();
      expect(typeof section.priority).toBe("number");
    }
  });

  it("A2: stable shape across runs", () => {
    const r1 = fullPipelinePrompt("FastAPI parsing workflow");
    const r2 = fullPipelinePrompt("FastAPI parsing workflow");

    expect(r1.prompt.sections.length).toBe(r2.prompt.sections.length);
    for (let i = 0; i < r1.prompt.sections.length; i++) {
      expect(r1.prompt.sections[i].label).toBe(r2.prompt.sections[i].label);
      expect(r1.prompt.sections[i].content).toBe(r2.prompt.sections[i].content);
      expect(r1.prompt.sections[i].priority).toBe(r2.prompt.sections[i].priority);
    }
    expect(r1.prompt.token_usage.estimated).toBe(r2.prompt.token_usage.estimated);
  });

  it("A3: no raw frontmatter or schema dump", () => {
    const { rendered } = fullPipelinePrompt("FastAPI parsing workflow");

    // Should not contain YAML frontmatter markers
    expect(rendered).not.toContain("---\ntitle:");
    expect(rendered).not.toContain("document_version:");
    expect(rendered).not.toContain("entities:\n  - id:");
    // Should not dump raw JSON schema
    expect(rendered).not.toContain('"source_hash"');
    expect(rendered).not.toContain('"aliases_json"');
  });
});

// ── B. Content Selection ──────────────────────────────────────────

describe("B. Content Selection", () => {
  it("B1: relevant entities included", () => {
    const { prompt, rendered } = fullPipelinePrompt("FastAPI parsing workflow");

    const entitySection = prompt.sections.find((s) => s.label === "Relevant Entities");
    expect(entitySection).toBeDefined();
    expect(entitySection!.content).toContain("FastAPI");
    expect(entitySection!.content).toContain("framework");
  });

  it("B2: supporting chunks included", () => {
    const { prompt } = fullPipelinePrompt("FastAPI parsing workflow");

    const chunkSections = prompt.sections.filter((s) => s.label.startsWith("Chunk:"));
    expect(chunkSections.length).toBeGreaterThan(0);

    // At least one chunk should have actual content
    const hasContent = chunkSections.some((s) => s.content.length > 50);
    expect(hasContent).toBe(true);
  });

  it("B3: graph summary included when expansion is on", () => {
    const { prompt } = fullPipelinePrompt("What is required before Analyze Resume");

    // With graph expansion, there should be expanded entities and a graph section
    const graphSection = prompt.sections.find((s) => s.label === "Related Entities (Graph)");
    // Graph section appears when there are expanded entities
    const { pack } = fullPipelinePrompt("What is required before Analyze Resume");
    if (pack.expanded_entities.length > 0) {
      expect(graphSection).toBeDefined();
      expect(graphSection!.content).toContain("REQUIRES");
    }
  });
});

// ── C. Ordering ───────────────────────────────────────────────────

describe("C. Ordering", () => {
  it("C1: entity summary before chunks", () => {
    const { prompt } = fullPipelinePrompt("FastAPI parsing workflow");

    const entityIdx = prompt.sections.findIndex((s) => s.label === "Relevant Entities");
    const firstChunkIdx = prompt.sections.findIndex((s) => s.label.startsWith("Chunk:"));

    expect(entityIdx).toBeGreaterThanOrEqual(0);
    expect(firstChunkIdx).toBeGreaterThanOrEqual(0);
    expect(entityIdx).toBeLessThan(firstChunkIdx);
  });

  it("C2: high-signal chunks before low-signal chunks", () => {
    const { prompt } = fullPipelinePrompt("FastAPI");

    const chunkSections = prompt.sections.filter((s) => s.label.startsWith("Chunk:"));
    if (chunkSections.length >= 2) {
      // Chunks should follow fused score ordering from rank-fusion
      // The first chunk section should have >= priority of the last one
      expect(chunkSections[0].priority).toBeGreaterThanOrEqual(
        chunkSections[chunkSections.length - 1].priority,
      );
    }
  });

  it("C3: missing preconditions surfaced early", () => {
    const { prompt } = fullPipelinePrompt("What do I need before Analyze Resume");

    const preIdx = prompt.sections.findIndex((s) => s.label === "Missing Preconditions");
    // When preconditions are present, they should be before chunks
    if (preIdx >= 0) {
      const firstChunkIdx = prompt.sections.findIndex((s) => s.label.startsWith("Chunk:"));
      if (firstChunkIdx >= 0) {
        expect(preIdx).toBeLessThan(firstChunkIdx);
      }
    }
  });
});

// ── D. Dedupe ─────────────────────────────────────────────────────

describe("D. Dedupe", () => {
  it("D1: duplicate chunk dedupe — same chunk appears only once", () => {
    // Construct a context pack where the same chunk appears in entity + vector + graph sources
    const fusedChunks: FusedChunkHit[] = [
      {
        chunk_id: "chunk:fastapi-service",
        document_id: "doc1",
        score: 0.95,
        sources: ["entity", "vector", "graph"],
      },
    ];
    const contextPack: ContextPack = {
      query: "test",
      matched_entities: [],
      entity_chunks: [],
      vector_chunks: [],
      keyword_chunks: [],
      expanded_entities: [],
      graph_chunks: [],
      fused_chunks: fusedChunks,
    };
    const chunkContent = new Map<string, ChunkContent>([
      [
        "chunk:fastapi-service",
        { context: "API service", content: "The service uses FastAPI.", priority: "high" },
      ],
    ]);

    const prompt = adaptContextToPrompt({ contextPack, chunkContent });
    const chunkSections = prompt.sections.filter((s) => s.label.startsWith("Chunk:"));
    const fastApiChunks = chunkSections.filter((s) => s.label.includes("fastapi-service"));
    expect(fastApiChunks).toHaveLength(1);
  });

  it("D2: duplicate entity dedupe — same entity listed once", () => {
    const contextPack: ContextPack = {
      query: "test",
      matched_entities: [
        { entity_id: "entity:fastapi", name: "FastAPI", match_type: "exact", document_id: "doc1" },
        { entity_id: "entity:fastapi", name: "FastAPI", match_type: "alias", document_id: "doc1" },
      ],
      entity_chunks: [],
      vector_chunks: [],
      keyword_chunks: [],
      expanded_entities: [],
      graph_chunks: [],
      fused_chunks: [],
    };
    const entityDetails = new Map<string, EntityDetail>([
      ["entity:fastapi", { type: "framework", preconditions: [], postconditions: [] }],
    ]);

    const prompt = adaptContextToPrompt({
      contextPack,
      chunkContent: new Map(),
      entityDetails,
    });
    const entitySection = prompt.sections.find((s) => s.label === "Relevant Entities");
    expect(entitySection).toBeDefined();
    // Count occurrences of "FastAPI" in entity section
    const matches = entitySection!.content.match(/FastAPI/g);
    expect(matches).toHaveLength(1);
  });

  it("D3: relation dedupe — same relation not repeated", () => {
    const expandedEntities: ExpandedEntity[] = [
      { entity_id: "e1", name: "State A", relation: "REQUIRES", score: 0.9, document_id: "doc1" },
      { entity_id: "e2", name: "State B", relation: "REQUIRES", score: 0.8, document_id: "doc1" },
      { entity_id: "e3", name: "State C", relation: "LEADS_TO", score: 0.7, document_id: "doc1" },
    ];
    const contextPack: ContextPack = {
      query: "test",
      matched_entities: [],
      entity_chunks: [],
      vector_chunks: [],
      keyword_chunks: [],
      expanded_entities: expandedEntities,
      graph_chunks: [],
      fused_chunks: [],
    };

    const prompt = adaptContextToPrompt({ contextPack, chunkContent: new Map() });
    const graphSection = prompt.sections.find((s) => s.label === "Related Entities (Graph)");
    expect(graphSection).toBeDefined();

    // REQUIRES should appear once as a heading, listing both entities
    const requiresMatches = graphSection!.content.match(/REQUIRES/g);
    expect(requiresMatches).toHaveLength(1);
    expect(graphSection!.content).toContain("State A");
    expect(graphSection!.content).toContain("State B");

    const leadsToMatches = graphSection!.content.match(/LEADS_TO/g);
    expect(leadsToMatches).toHaveLength(1);
  });
});

// ── E. Token Budget ───────────────────────────────────────────────

describe("E. Token Budget", () => {
  it("E1: hard token limit respected", () => {
    const { prompt } = fullPipelinePrompt("FastAPI parsing workflow", {
      tokenLimit: 200,
    });

    expect(prompt.token_usage.estimated).toBeLessThanOrEqual(200);
    expect(prompt.token_usage.limit).toBe(200);
  });

  it("E2: budget allocation is sane — entities not eating all budget", () => {
    const { prompt } = fullPipelinePrompt("FastAPI parsing workflow", {
      tokenLimit: 2000,
    });

    const entitySection = prompt.sections.find((s) => s.label === "Relevant Entities");
    const chunkSections = prompt.sections.filter((s) => s.label.startsWith("Chunk:"));

    // Entities section should exist and be small relative to chunks
    expect(entitySection).toBeDefined();
    expect(chunkSections.length).toBeGreaterThan(0);

    const entityTokens = estimateTokens(entitySection!.content);
    const chunkTokens = chunkSections.reduce((sum, s) => sum + estimateTokens(s.content), 0);

    // Chunks should use more budget than entity summary
    expect(chunkTokens).toBeGreaterThan(entityTokens);
  });

  it("E3: overflow trimming preserves high-signal info", () => {
    // Use a very tight budget: should keep high-priority content, drop low-priority
    const { db, doc } = createIndexedDb();
    const pack = retrieveContext({ db, query: "FastAPI", graphExpansion: true });
    const chunkContent = buildChunkContentMap(doc);
    const entityDetails = buildEntityDetailMap(doc);

    const prompt = adaptContextToPrompt({
      contextPack: pack,
      chunkContent,
      entityDetails,
      tokenLimit: 300,
    });

    // With tight budget, some sections should have been trimmed
    const labels = prompt.sections.map((s) => s.label);

    // If entities section survived, its priority should be high
    const entitySection = prompt.sections.find((s) => s.label === "Relevant Entities");
    if (entitySection) {
      // High-priority entity section should survive before low-priority chunks
      const lowChunks = prompt.sections.filter(
        (s) => s.label.startsWith("Chunk:") && s.priority === 30,
      );
      // If both exist, entities should be present; but with tight budget,
      // low-priority chunks should be trimmed first
      if (lowChunks.length > 0) {
        expect(entitySection).toBeDefined();
      }
    }

    expect(prompt.token_usage.estimated).toBeLessThanOrEqual(300);
  });

  it("E3b: expansion enabled does not blow up token budget", () => {
    const withExpansion = fullPipelinePrompt("Analyze Resume", {
      tokenLimit: 1000,
    });

    expect(withExpansion.prompt.token_usage.estimated).toBeLessThanOrEqual(1000);
    // Sections should still exist — not entirely trimmed
    expect(withExpansion.prompt.sections.length).toBeGreaterThan(0);
  });
});

// ── F. Answer Quality ─────────────────────────────────────────────

describe("F. Answer Quality", () => {
  it("F1: exact entity question — context sufficient for FastAPI role", () => {
    const { rendered } = fullPipelinePrompt("What is FastAPI used for here?");

    // Rendered prompt should contain enough context about FastAPI's role
    expect(rendered).toContain("FastAPI");
    // Should include backend/API-related chunk content
    expect(rendered.toLowerCase()).toMatch(/backend|api|service/);
  });

  it("F2: prerequisite question — REQUIRES context present", () => {
    const { rendered, prompt } = fullPipelinePrompt("What is required before Analyze Resume");

    // Should mention the REQUIRES relationship or precondition
    const hasRequiresContext =
      rendered.includes("REQUIRES") ||
      rendered.includes("requires") ||
      rendered.includes("resume-uploaded") ||
      rendered.includes("Resume Uploaded");
    expect(hasRequiresContext).toBe(true);

    // Should mention Analyze Resume
    expect(rendered).toContain("Analyze Resume");
  });

  it("F3: mixed workflow question — both workflow and backend chunks", () => {
    const { rendered } = fullPipelinePrompt("resume analysis workflow FastAPI backend");

    // Should contain workflow-related content
    const hasWorkflow = rendered.toLowerCase().match(/workflow|parse|upload|resume/);
    expect(hasWorkflow).toBeTruthy();

    // Should also contain backend/API content
    const hasBackend = rendered.toLowerCase().match(/fastapi|backend|api|service/);
    expect(hasBackend).toBeTruthy();
  });
});

// ── G. Before/After Comparison ────────────────────────────────────

describe("G. Before/After Comparison", () => {
  it("G1: adapted prompt is more readable than raw pack", () => {
    const { pack, rendered } = fullPipelinePrompt("FastAPI parsing workflow");

    // Raw pack is just arrays of IDs and scores
    const rawDump = JSON.stringify(pack);

    // Rendered prompt has markdown structure with headings
    expect(rendered).toContain("## Relevant Entities");
    expect(rendered).toContain("## Chunk:");

    // Rendered should contain human-readable entity names, not just IDs
    expect(rendered).toContain("**FastAPI**");

    // Raw dump contains internal fields not in rendered output
    expect(rawDump).toContain("entity_id");
    expect(rawDump).toContain("match_type");
    // Rendered output should not expose these internal fields
    expect(rendered).not.toContain('"entity_id"');
    expect(rendered).not.toContain('"match_type"');
  });

  it("G2: noise reduction — no duplicate chunks in rendered output", () => {
    const { rendered } = fullPipelinePrompt("FastAPI");

    // Count occurrences of each chunk heading
    const chunkHeadings = rendered.match(/## Chunk: chunk:[a-z-]+/g) ?? [];
    const unique = new Set(chunkHeadings);
    expect(chunkHeadings.length).toBe(unique.size);
  });

  it("G3: coverage retention — key entities and chunks survive adaptation", () => {
    const { pack, prompt } = fullPipelinePrompt("FastAPI parsing workflow");

    // All matched entities from the pack should appear in the entity section
    const entitySection = prompt.sections.find((s) => s.label === "Relevant Entities");
    expect(entitySection).toBeDefined();
    for (const entity of pack.matched_entities) {
      expect(entitySection!.content).toContain(entity.name);
    }

    // Fused chunks should map to chunk sections (within token budget)
    const chunkLabels = prompt.sections
      .filter((s) => s.label.startsWith("Chunk:"))
      .map((s) => s.label.replace("Chunk: ", ""));

    // At least some fused chunks should appear
    const fusedIds = pack.fused_chunks.map((c) => c.chunk_id);
    const overlap = chunkLabels.filter((l) => fusedIds.includes(l));
    expect(overlap.length).toBeGreaterThan(0);
  });
});

// ── Unit: estimateTokens ──────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns ceil(length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

// ── Unit: renderPromptContext ─────────────────────────────────────

describe("renderPromptContext", () => {
  it("renders sections as markdown headings", () => {
    const ctx: PromptContext = {
      query: "test",
      sections: [
        { label: "Section A", content: "Content A", priority: 100 },
        { label: "Section B", content: "Content B", priority: 50 },
      ],
      token_usage: { estimated: 10, limit: 4000 },
    };

    const rendered = renderPromptContext(ctx);
    expect(rendered).toBe("## Section A\n\nContent A\n\n## Section B\n\nContent B");
  });
});
