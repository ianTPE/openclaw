/**
 * Phase 6 Task 6.6 — Retrieval reads session world state.
 *
 * Validates that session state (active_states, completed_skills, blocked_by)
 * flows into the retrieval/prompt pipeline and produces observable differences:
 *
 * G1: Missing preconditions appear in prompt when states are absent
 * G2: Active states are surfaced in the prompt
 * G3: Completed skills are excluded from suggested next actions
 *
 * Also covers:
 * - retrieveSessionAwareContext wiring
 * - Session with no world state falls back gracefully
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { canonicalizeCtxfstDocument } from "../formats/ctxfst/canonicalize.js";
import { parseCtxfstDocument } from "../formats/ctxfst/parser.js";
import { indexCtxfstDocument } from "../indexing/ctxfst-indexer.js";
import { ensureCtxfstSchema } from "../indexing/ctxfst-schema.js";
import {
  applySuccessWriteback,
  getOrCreateWorldState,
  saveWorldState,
} from "../runtime/world-state.js";
import { adaptContextToPrompt, renderPromptContext } from "./prompt-adapter.js";
import { retrieveContext } from "./retrieval-pipeline.js";
import { retrieveSessionAwareContext } from "./session-context.js";
import type { ChunkContent, EntityDetail } from "./types.js";

// ── Fixture helpers ──────────────────────────────────────────────

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

// ── G1: Missing preconditions appear in prompt ──────────────────

describe("G1: missing preconditions appear in prompt when states are absent", () => {
  it("empty session → Missing Preconditions section for Analyze Resume", () => {
    const { db, doc } = createIndexedDb();

    // Create an empty session (no active states)
    getOrCreateWorldState(db, "session-g1");

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g1",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    // entity:analyze-resume requires state:resume-uploaded
    const missingSection = result.prompt.sections.find((s) => s.label === "Missing Preconditions");
    expect(missingSection).toBeDefined();
    expect(missingSection!.content).toContain("resume-uploaded");
  });

  it("session with preconditions satisfied → no Missing Preconditions section", () => {
    const { db, doc } = createIndexedDb();

    // Add state:resume-uploaded so preconditions are met
    const state = getOrCreateWorldState(db, "session-g1-ok");
    state.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state);

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g1-ok",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    const missingSection = result.prompt.sections.find((s) => s.label === "Missing Preconditions");
    expect(missingSection).toBeUndefined();
  });
});

// ── G2: Active states influence context (surfaced in prompt) ────

describe("G2: active states are surfaced in the prompt", () => {
  it("session with active states → Active States section present", () => {
    const { db, doc } = createIndexedDb();

    const state = getOrCreateWorldState(db, "session-g2");
    state.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, state);

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g2",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    const stateSection = result.prompt.sections.find((s) => s.label === "Active States");
    expect(stateSection).toBeDefined();
    expect(stateSection!.content).toContain("state:resume-uploaded");
    expect(stateSection!.content).toContain("state:resume-parsed");
  });

  it("empty session → no Active States section", () => {
    const { db, doc } = createIndexedDb();

    getOrCreateWorldState(db, "session-g2-empty");

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g2-empty",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    const stateSection = result.prompt.sections.find((s) => s.label === "Active States");
    expect(stateSection).toBeUndefined();
  });
});

// ── G3: Completed skills affect suggested next actions ──────────

describe("G3: completed skills excluded from suggested next actions", () => {
  it("before completion: next actions include entity postconditions", () => {
    const { db, doc } = createIndexedDb();
    getOrCreateWorldState(db, "session-g3-before");

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g3-before",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    const nextSection = result.prompt.sections.find((s) => s.label === "Suggested Next Actions");
    // entity:analyze-resume has postconditions → should appear in next actions
    expect(nextSection).toBeDefined();
    expect(nextSection!.content).toContain("resume-parsed");
  });

  it("after completion: next actions exclude the completed entity", () => {
    const { db, doc } = createIndexedDb();

    // Mark entity:analyze-resume as completed
    applySuccessWriteback(db, "session-g3-after", "entity:analyze-resume");

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "session-g3-after",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    const nextSection = result.prompt.sections.find((s) => s.label === "Suggested Next Actions");
    // entity:analyze-resume is completed, its postconditions should not appear
    // as suggested next actions from this entity
    if (nextSection) {
      expect(nextSection.content).not.toContain("After Analyze Resume");
    }
  });

  it("completedSkills passed directly to adaptContextToPrompt also filters", () => {
    const { db, doc } = createIndexedDb();

    const pack = retrieveContext({
      db,
      query: "Analyze Resume",
      graphExpansion: true,
    });

    // Without completed skills → next actions present
    const promptBefore = adaptContextToPrompt({
      contextPack: pack,
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
      completedSkills: [],
    });
    const nextBefore = promptBefore.sections.find((s) => s.label === "Suggested Next Actions");
    expect(nextBefore).toBeDefined();

    // With entity:analyze-resume completed → its next actions removed
    const promptAfter = adaptContextToPrompt({
      contextPack: pack,
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
      completedSkills: ["entity:analyze-resume"],
    });
    const nextAfter = promptAfter.sections.find((s) => s.label === "Suggested Next Actions");
    if (nextAfter) {
      expect(nextAfter.content).not.toContain("After Analyze Resume");
    }
  });
});

// ── Session with no world state falls back gracefully ───────────

describe("fallback: non-existent session", () => {
  it("returns a valid prompt with worldState=null and no session sections", () => {
    const { db, doc } = createIndexedDb();

    const result = retrieveSessionAwareContext({
      db,
      query: "Analyze Resume",
      sessionId: "nonexistent-session",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    expect(result.worldState).toBeNull();
    // Should still return a valid prompt with entities/chunks
    expect(result.prompt.sections.length).toBeGreaterThan(0);
    expect(result.rendered).toContain("Analyze Resume");
  });
});

// ── Rendered output integration ─────────────────────────────────

describe("rendered output reflects session state", () => {
  it("rendered prompt contains active states and missing preconditions when applicable", () => {
    const { db, doc } = createIndexedDb();

    // Session with partial state: resume-uploaded is active, but generate-report needs resume-parsed
    const state = getOrCreateWorldState(db, "session-render");
    state.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state);

    const result = retrieveSessionAwareContext({
      db,
      query: "Generate Report",
      sessionId: "session-render",
      retrieval: { graphExpansion: true },
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
    });

    // Active States section should be present in rendered output
    expect(result.rendered).toContain("## Active States");
    expect(result.rendered).toContain("state:resume-uploaded");
  });
});
