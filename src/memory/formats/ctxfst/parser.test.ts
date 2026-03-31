import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeId, canonicalizeCtxfstDocument } from "./canonicalize.js";
import { isCtxfstPath, looksLikeCtxfstDocument } from "./detector.js";
import { ingestCtxfstSource } from "./index.js";
import {
  extractChunkBodies,
  FatalParseError,
  parseCtxfstDocument,
  splitFrontmatterAndBody,
} from "./parser.js";
import type { CtxfstDocument } from "./types.js";
import { validateCtxfstDocument, validateChunkBodyMapping } from "./validator.js";

// --- Fixture helpers ---

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../../../docs/openclaw-upgrade-specs/examples",
);

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), "utf-8");
}

// --- A. Format Detection ---

describe("detector", () => {
  it("detects .ctxfst.md by path", () => {
    expect(isCtxfstPath("docs/knowledge.ctxfst.md")).toBe(true);
    expect(isCtxfstPath("knowledge.ctxfst.md")).toBe(true);
  });

  it("rejects non-.ctxfst.md paths", () => {
    expect(isCtxfstPath("docs/readme.md")).toBe(false);
    expect(isCtxfstPath("docs/knowledge.md")).toBe(false);
    expect(isCtxfstPath("ctxfst.md")).toBe(false);
  });

  it("detects CtxFST by source content", () => {
    const source = readFixture("minimal.ctxfst.md");
    expect(looksLikeCtxfstDocument(source)).toBe(true);
  });

  it("rejects plain markdown source", () => {
    const plain = "# Hello\n\nThis is plain markdown.";
    expect(looksLikeCtxfstDocument(plain)).toBe(false);
  });
});

// --- B. Parser: Frontmatter + Chunk Body ---

describe("parser", () => {
  describe("splitFrontmatterAndBody", () => {
    it("splits correctly", () => {
      const source = "---\ntitle: Test\n---\n\nBody content";
      const { frontmatterYaml, body } = splitFrontmatterAndBody(source);
      expect(frontmatterYaml).toBe("title: Test");
      expect(body).toBe("Body content");
    });

    it("throws on missing frontmatter", () => {
      expect(() => splitFrontmatterAndBody("No frontmatter here")).toThrow(FatalParseError);
    });

    it("throws on unclosed frontmatter", () => {
      expect(() => splitFrontmatterAndBody("---\ntitle: Test\nNo closing fence")).toThrow(
        FatalParseError,
      );
    });
  });

  describe("extractChunkBodies", () => {
    it("extracts single chunk", () => {
      const body = '<Chunk id="chunk:a">\nHello world\n</Chunk>';
      const bodies = extractChunkBodies(body);
      expect(bodies.get("chunk:a")).toBe("Hello world");
    });

    it("extracts multiple chunks", () => {
      const body =
        '<Chunk id="chunk:a">\nFirst\n</Chunk>\n\n<Chunk id="chunk:b">\nSecond\n</Chunk>';
      const bodies = extractChunkBodies(body);
      expect(bodies.size).toBe(2);
      expect(bodies.get("chunk:a")).toBe("First");
      expect(bodies.get("chunk:b")).toBe("Second");
    });

    it("throws on unclosed chunk tag", () => {
      const body = '<Chunk id="chunk:a">\nNo closing tag';
      expect(() => extractChunkBodies(body)).toThrow(FatalParseError);
      expect(() => extractChunkBodies(body)).toThrow(/Unclosed/);
    });

    it("throws on nested chunk tags", () => {
      const body = '<Chunk id="chunk:outer">\n<Chunk id="chunk:inner">\nNested\n</Chunk>\n</Chunk>';
      expect(() => extractChunkBodies(body)).toThrow(FatalParseError);
      expect(() => extractChunkBodies(body)).toThrow(/Nested/);
    });

    it("returns empty map for empty body", () => {
      expect(extractChunkBodies("").size).toBe(0);
    });
  });

  describe("parseCtxfstDocument", () => {
    it("parses minimal fixture", async () => {
      const source = readFixture("minimal.ctxfst.md");
      const { document: doc } = await parseCtxfstDocument(source, "minimal.ctxfst.md");
      expect(doc.entities).toHaveLength(1);
      expect(doc.chunks).toHaveLength(1);
      expect(doc.entities[0].id).toBe("entity:python");
      expect(doc.chunks[0].id).toBe("chunk:python-intro");
      expect(doc.chunks[0].content).toContain("Python is a popular");
    });

    it("parses full fixture", async () => {
      const source = readFixture("full.ctxfst.md");
      const { document: doc } = await parseCtxfstDocument(source, "full.ctxfst.md");
      expect(doc.entities).toHaveLength(4);
      expect(doc.chunks).toHaveLength(2);
      expect(doc.document.title).toBe("Full Feature Example");
      expect(doc.document.documentVersion).toBe("1.0");
    });

    it("computes source hash", async () => {
      const source = readFixture("minimal.ctxfst.md");
      const { document: doc } = await parseCtxfstDocument(source, "minimal.ctxfst.md");
      expect(doc.document.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("tracks unknown top-level keys", async () => {
      const source = "---\ntitle: Test\ncustom_field: true\nentities: []\nchunks: []\n---\n";
      const { unknownKeys } = await parseCtxfstDocument(source, "test.ctxfst.md");
      expect(unknownKeys).toContain("custom_field");
    });

    // Case B7: Malformed YAML frontmatter
    it("throws FatalParseError on malformed YAML frontmatter", async () => {
      // Invalid YAML: inconsistent indentation / tab character
      const source = "---\ntitle: Test\n  bad:\tindent: here\n---\n";
      await expect(parseCtxfstDocument(source, "bad.ctxfst.md")).rejects.toThrow(FatalParseError);
    });

    it("does not error when document_version is absent (it is optional)", async () => {
      const source = "---\ntitle: No Version\nentities: []\nchunks: []\n---\n";
      const { document: doc } = await parseCtxfstDocument(source, "no-version.ctxfst.md");
      // Default should be injected; no throw
      expect(doc.document.documentVersion).toBeTruthy();
    });
  });
});

// --- C. Validator ---

describe("validator", () => {
  function makeDoc(
    overrides: Partial<{
      entities: CtxfstDocument["entities"];
      chunks: CtxfstDocument["chunks"];
    }> = {},
  ): CtxfstDocument {
    return {
      document: {
        id: "doc:test",
        title: "Test",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc123",
        documentVersion: "1.0",
        metadata: {},
      },
      entities: overrides.entities ?? [
        {
          id: "entity:a",
          name: "A",
          type: "skill",
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: overrides.chunks ?? [
        {
          id: "chunk:a",
          context: "Test chunk",
          content: "Some content",
          tags: [],
          entities: ["entity:a"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    };
  }

  it("validates a correct document", () => {
    const result = validateCtxfstDocument(makeDoc());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches duplicate entity IDs", () => {
    const doc = makeDoc({
      entities: [
        {
          id: "entity:dup",
          name: "Dup1",
          type: "skill",
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
        {
          id: "entity:dup",
          name: "Dup2",
          type: "tool",
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [
        {
          id: "chunk:a",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:dup"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_ENTITY_ID")).toBe(true);
  });

  it("catches duplicate chunk IDs", () => {
    const doc = makeDoc({
      chunks: [
        {
          id: "chunk:dup",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:a"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
        {
          id: "chunk:dup",
          context: "",
          content: "y",
          tags: [],
          entities: ["entity:a"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_CHUNK_ID")).toBe(true);
  });

  it("catches missing entity reference", () => {
    const doc = makeDoc({
      chunks: [
        {
          id: "chunk:a",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:nonexistent"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_ENTITY_REFERENCE")).toBe(true);
  });

  it("catches missing chunk body", () => {
    const doc = makeDoc({
      chunks: [
        {
          id: "chunk:nobody",
          context: "",
          content: "", // empty = no body matched
          tags: [],
          entities: ["entity:a"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_CHUNK_BODY")).toBe(true);
  });

  it("catches invalid entity type", () => {
    const doc = makeDoc({
      entities: [
        {
          id: "entity:bad",
          name: "Bad",
          type: "invalid_type" as unknown as EntityType,
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [
        {
          id: "chunk:a",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:bad"],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_ENTITY_TYPE")).toBe(true);
  });

  it("catches invalid priority", () => {
    const doc = makeDoc({
      chunks: [
        {
          id: "chunk:a",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:a"],
          stateRefs: [],
          priority: "super-high" as unknown as Priority,
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_PRIORITY")).toBe(true);
  });

  it("warns on state_ref pointing to non-state entity", () => {
    const doc = makeDoc({
      entities: [
        {
          id: "entity:a",
          name: "A",
          type: "skill",
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [
        {
          id: "chunk:a",
          context: "",
          content: "x",
          tags: [],
          entities: ["entity:a"],
          stateRefs: ["entity:a"],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    });
    const result = validateCtxfstDocument(doc);
    expect(result.ok).toBe(true); // warnings don't fail
    expect(result.warnings.some((w) => w.code === "STATE_REF_NOT_STATE_TYPE")).toBe(true);
  });

  it("validates body/frontmatter chunk mapping mismatch", () => {
    const fm = new Set(["chunk:a", "chunk:b"]);
    const body = new Set(["chunk:a", "chunk:c"]);
    const errors = validateChunkBodyMapping(fm, body);
    expect(errors.some((e) => e.code === "UNDECLARED_BODY_CHUNK")).toBe(true);
    expect(errors.some((e) => e.message.includes("chunk:c"))).toBe(true);
  });
});

// --- D. Canonicalization ---

describe("canonicalize", () => {
  describe("normalizeId", () => {
    it("converts to lowercase kebab-case", () => {
      expect(normalizeId("entity:OpenClaw")).toBe("entity:openclaw");
      expect(normalizeId("entity:open_claw")).toBe("entity:open-claw");
      expect(normalizeId("ENTITY:FAST_API")).toBe("entity:fast-api");
    });

    it("trims whitespace", () => {
      expect(normalizeId("  entity:fastapi  ")).toBe("entity:fastapi");
    });

    it("collapses multiple hyphens", () => {
      expect(normalizeId("entity:foo--bar")).toBe("entity:foo-bar");
    });
  });

  it("deduplicates aliases", () => {
    const doc: CtxfstDocument = {
      document: {
        id: "doc:test",
        title: "Test",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc",
        documentVersion: "1.0",
        metadata: {},
      },
      entities: [
        {
          id: "entity:a",
          name: "A",
          type: "skill",
          aliases: ["alias1", "alias1", "alias2"],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [],
    };
    const result = canonicalizeCtxfstDocument(doc);
    expect(result.entities[0].aliases).toEqual(["alias1", "alias2"]);
  });

  it("deduplicates tags", () => {
    const doc: CtxfstDocument = {
      document: {
        id: "doc:test",
        title: "Test",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc",
        documentVersion: "1.0",
        metadata: {},
      },
      entities: [],
      chunks: [
        {
          id: "chunk:a",
          context: "ctx",
          content: "body",
          tags: ["spec", "spec", "intro"],
          entities: [],
          stateRefs: [],
          priority: "medium",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    };
    const result = canonicalizeCtxfstDocument(doc);
    expect(result.chunks[0].tags).toEqual(["spec", "intro"]);
  });

  it("injects default document version", () => {
    const doc: CtxfstDocument = {
      document: {
        id: "doc:test",
        title: "Test",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc",
        documentVersion: "",
        metadata: {},
      },
      entities: [],
      chunks: [],
    };
    const result = canonicalizeCtxfstDocument(doc);
    expect(result.document.documentVersion).toBe("1.0");
  });

  it("normalizes entity IDs throughout document", () => {
    const doc: CtxfstDocument = {
      document: {
        id: "doc:test",
        title: "Test",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc",
        documentVersion: "1.0",
        metadata: {},
      },
      entities: [
        {
          id: "entity:OpenClaw",
          name: "OpenClaw",
          type: "framework",
          aliases: [],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [
        {
          id: "chunk:Intro_To_Spec",
          context: "intro",
          content: "body",
          tags: [],
          entities: ["entity:OpenClaw"],
          stateRefs: [],
          priority: "HIGH",
          version: 1,
          dependencies: [],
          metadata: {},
        },
      ],
    };
    const result = canonicalizeCtxfstDocument(doc);
    expect(result.entities[0].id).toBe("entity:openclaw");
    expect(result.chunks[0].id).toBe("chunk:intro-to-spec");
    expect(result.chunks[0].entities).toEqual(["entity:openclaw"]);
    expect(result.chunks[0].priority).toBe("high");
  });

  it("cleans whitespace from IDs and arrays", () => {
    const doc: CtxfstDocument = {
      document: {
        id: "doc:test",
        title: "  Test  ",
        sourcePath: "test.ctxfst.md",
        format: "ctxfst",
        sourceHash: "abc",
        documentVersion: "1.0",
        metadata: {},
      },
      entities: [
        {
          id: " entity:fastapi ",
          name: "  FastAPI  ",
          type: "framework",
          aliases: ["  fast-api  ", ""],
          preconditions: [],
          postconditions: [],
          relatedSkills: [],
          metadata: {},
        },
      ],
      chunks: [],
    };
    const result = canonicalizeCtxfstDocument(doc);
    expect(result.document.title).toBe("Test");
    expect(result.entities[0].id).toBe("entity:fastapi");
    expect(result.entities[0].name).toBe("FastAPI");
    expect(result.entities[0].aliases).toEqual(["fast-api"]);
  });
});

// --- E. Full Pipeline (ingestCtxfstSource) ---

describe("ingestCtxfstSource", () => {
  it("ingests minimal fixture successfully", async () => {
    const source = readFixture("minimal.ctxfst.md");
    const result = await ingestCtxfstSource(source, "minimal.ctxfst.md");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.document.entities).toHaveLength(1);
    expect(result.document.chunks).toHaveLength(1);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("ingests full fixture successfully", async () => {
    const source = readFixture("full.ctxfst.md");
    const result = await ingestCtxfstSource(source, "full.ctxfst.md");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.document.entities).toHaveLength(4);
    expect(result.document.chunks).toHaveLength(2);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("fails on duplicate entity IDs", async () => {
    const source = `---
title: Dup Test
entities:
  - id: entity:dup
    name: Dup1
    type: skill
  - id: entity:dup
    name: Dup2
    type: tool
chunks:
  - id: chunk:a
    entities: [entity:dup]
    context: test
---

<Chunk id="chunk:a">
Content here
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "dup.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "DUPLICATE_ENTITY_ID")).toBe(true);
  });

  it("fails on duplicate chunk IDs", async () => {
    const source = `---
title: Dup Chunk Test
entities:
  - id: entity:a
    name: A
    type: skill
chunks:
  - id: chunk:dup
    entities: [entity:a]
    context: first
  - id: chunk:dup
    entities: [entity:a]
    context: second
---

<Chunk id="chunk:dup">
Content
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "dup-chunk.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "DUPLICATE_CHUNK_ID")).toBe(true);
  });

  it("fails on missing entity reference", async () => {
    const source = `---
title: Missing Ref
entities:
  - id: entity:a
    name: A
    type: skill
chunks:
  - id: chunk:a
    entities: [entity:nonexistent]
    context: test
---

<Chunk id="chunk:a">
Content
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "missing-ref.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "MISSING_ENTITY_REFERENCE")).toBe(true);
  });

  it("fails on body/frontmatter chunk mismatch — body has undeclared chunk", async () => {
    const source = `---
title: Mismatch
entities:
  - id: entity:a
    name: A
    type: skill
chunks:
  - id: chunk:a
    entities: [entity:a]
    context: test
---

<Chunk id="chunk:a">
Declared chunk
</Chunk>

<Chunk id="chunk:extra">
This chunk is not declared in frontmatter
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "mismatch.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "UNDECLARED_BODY_CHUNK")).toBe(true);
  });

  it("fails on body/frontmatter chunk mismatch — frontmatter has no body", async () => {
    const source = `---
title: No Body
entities:
  - id: entity:a
    name: A
    type: skill
chunks:
  - id: chunk:a
    entities: [entity:a]
    context: test
  - id: chunk:b
    entities: [entity:a]
    context: missing body
---

<Chunk id="chunk:a">
Only this chunk has a body
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "no-body.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "MISSING_CHUNK_BODY")).toBe(true);
  });

  it("fails on unclosed <Chunk> tag", async () => {
    const source = `---
title: Unclosed
entities: []
chunks:
  - id: chunk:a
    entities: []
    context: test
---

<Chunk id="chunk:a">
No closing tag here
`;
    const result = await ingestCtxfstSource(source, "unclosed.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "FATAL_PARSE_ERROR")).toBe(true);
    expect(result.errors.some((e) => e.message.includes("Unclosed"))).toBe(true);
  });

  it("fails on nested <Chunk> tag", async () => {
    const source = `---
title: Nested
entities: []
chunks:
  - id: chunk:outer
    entities: []
    context: outer
  - id: chunk:inner
    entities: []
    context: inner
---

<Chunk id="chunk:outer">
<Chunk id="chunk:inner">
Nested content
</Chunk>
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "nested.ctxfst.md");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((e) => e.code === "FATAL_PARSE_ERROR")).toBe(true);
    expect(result.errors.some((e) => e.message.includes("Nested"))).toBe(true);
  });

  it("canonicalizes output consistently", async () => {
    const source = readFixture("full.ctxfst.md");
    const r1 = await ingestCtxfstSource(source, "full.ctxfst.md");
    const r2 = await ingestCtxfstSource(source, "full.ctxfst.md");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) {
      return;
    }
    // Same input always produces same canonical output
    expect(r1.document.entities).toEqual(r2.document.entities);
    expect(r1.document.chunks).toEqual(r2.document.chunks);
  });

  it("reports unknown top-level keys as warnings", async () => {
    const source = `---
title: Extras
custom_key: hello
entities:
  - id: entity:a
    name: A
    type: skill
chunks:
  - id: chunk:a
    entities: [entity:a]
    context: test
---

<Chunk id="chunk:a">
Content
</Chunk>
`;
    const result = await ingestCtxfstSource(source, "extras.ctxfst.md");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.validation.warnings.some((w) => w.code === "UNKNOWN_TOP_LEVEL_KEY")).toBe(true);
  });

  it("handles full fixture with state_refs and preconditions", async () => {
    const source = readFixture("full.ctxfst.md");
    const result = await ingestCtxfstSource(source, "full.ctxfst.md");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { entities, chunks } = result.document;

    // Verify state entities exist
    const stateEntities = entities.filter((e) => e.type === "state");
    expect(stateEntities.length).toBeGreaterThan(0);

    // Verify preconditions/postconditions are preserved
    const ctxfstEntity = entities.find((e) => e.name === "CtxFST");
    expect(ctxfstEntity).toBeDefined();
    expect(ctxfstEntity!.preconditions.length).toBeGreaterThan(0);
    expect(ctxfstEntity!.postconditions.length).toBeGreaterThan(0);

    // Verify state_refs on chunks
    const introChunk = chunks.find((c) => c.id.includes("intro"));
    expect(introChunk).toBeDefined();
    expect(introChunk!.stateRefs.length).toBeGreaterThan(0);
  });
});
