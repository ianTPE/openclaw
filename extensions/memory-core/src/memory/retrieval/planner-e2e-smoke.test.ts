/**
 * Phase 7 Product-Level Smoke Test
 *
 * Same query ("What should I do next?"), same session, three different states.
 * Validates that the planner produces different recommendations as the session
 * world state evolves.
 *
 * Stage 1: Empty session
 *   → Upload-related actions appear; Analyze Resume is blocked
 *
 * Stage 2: After upload (state:resume-uploaded active)
 *   → Analyze Resume becomes actionable; upload is no longer suggested
 *
 * Stage 3: After analyze (state:resume-parsed active, entity:analyze-resume completed)
 *   → Generate Report is recommended; Analyze Resume is NOT repeated
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
import { matchEntitiesForQuery } from "./entity-matcher.js";
import type { CandidateEntity } from "./planner-types.js";
import { buildPlannerPromptSections, planNextActions } from "./planner.js";
import { adaptContextToPrompt, renderPromptContext } from "./prompt-adapter.js";
import { retrieveContext } from "./retrieval-pipeline.js";
import type { ChunkContent, EntityDetail } from "./types.js";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);
const SESSION_ID = "smoke-e2e";
const GOAL = "state:analysis-complete";
const QUERY = "What should I do next?";

function setup() {
  const src = readFileSync(FIXTURE_PATH, "utf-8");
  const doc = canonicalizeCtxfstDocument(parseCtxfstDocument(src, "retrieval-test.ctxfst.md"));
  const db = new DatabaseSync(":memory:");
  ensureCtxfstSchema(db);
  indexCtxfstDocument(db, doc);
  return { db, doc };
}

function getCandidates(db: DatabaseSync, doc: ReturnType<typeof setup>["doc"]): CandidateEntity[] {
  // Use a broad query to get all actionable entities
  const queries = ["Analyze Resume Generate Report FastAPI PDF Parser Vector Search"];
  const entityMap = new Map(doc.entities.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const candidates: CandidateEntity[] = [];

  for (const q of queries) {
    for (const m of matchEntitiesForQuery(db, q)) {
      if (seen.has(m.entity_id)) continue;
      seen.add(m.entity_id);
      const entity = entityMap.get(m.entity_id);
      candidates.push({
        entity_id: m.entity_id,
        name: m.name,
        type: entity?.type ?? "unknown",
        retrieval_score: m.score,
        document_id: m.document_id,
        preconditions: entity?.preconditions ?? [],
        postconditions: entity?.postconditions ?? [],
      });
    }
  }
  return candidates;
}

function getRenderedPrompt(
  db: DatabaseSync,
  doc: ReturnType<typeof setup>["doc"],
  candidates: CandidateEntity[],
) {
  const worldState = getOrCreateWorldState(db, SESSION_ID);
  const plannerOutput = planNextActions(db, {
    worldState,
    goal: GOAL,
    candidateEntities: candidates,
  });

  const contextPack = retrieveContext({ db, query: QUERY, graphExpansion: true });

  const chunkContent = new Map<string, ChunkContent>();
  const entityDetails = new Map<string, EntityDetail>();
  for (const chunk of doc.chunks) {
    chunkContent.set(chunk.id, {
      context: chunk.context,
      content: chunk.content,
      priority: chunk.priority as "high" | "medium" | "low",
    });
  }
  for (const entity of doc.entities) {
    entityDetails.set(entity.id, {
      type: entity.type,
      preconditions: entity.preconditions,
      postconditions: entity.postconditions,
    });
  }

  const prompt = adaptContextToPrompt({
    contextPack,
    chunkContent,
    entityDetails,
    activeStates: worldState.active_states,
    completedSkills: worldState.completed_skills.map((r) => r.entityId),
    plannerOutput,
  });

  return {
    rendered: renderPromptContext(prompt),
    plannerOutput,
    worldState,
  };
}

describe("Phase 7 E2E smoke: same query, different state, different answer", () => {
  it("three-stage session produces three different planner outputs", () => {
    const { db, doc } = setup();
    const candidates = getCandidates(db, doc);

    // ── Stage 1: Empty session ──────────────────────────────────────
    getOrCreateWorldState(db, SESSION_ID);
    const stage1 = getRenderedPrompt(db, doc, candidates);

    // Analyze Resume should be BLOCKED (missing state:resume-uploaded)
    const stage1Blocked = stage1.plannerOutput.blocked_actions.map((b) => b.entity_id);
    expect(stage1Blocked).toContain("entity:analyze-resume");

    // Analyze Resume should NOT be in ranked actions
    const stage1Ranked = stage1.plannerOutput.ranked_actions.map((a) => a.entity_id);
    expect(stage1Ranked).not.toContain("entity:analyze-resume");

    // ── Stage 2: After upload ───────────────────────────────────────
    const state2 = getOrCreateWorldState(db, SESSION_ID);
    state2.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state2);
    const stage2 = getRenderedPrompt(db, doc, candidates);

    // Analyze Resume should now be RANKED (precondition met)
    const stage2Ranked = stage2.plannerOutput.ranked_actions.map((a) => a.entity_id);
    expect(stage2Ranked).toContain("entity:analyze-resume");

    // It should NOT be blocked anymore
    const stage2Blocked = stage2.plannerOutput.blocked_actions.map((b) => b.entity_id);
    expect(stage2Blocked).not.toContain("entity:analyze-resume");

    // ── Stage 3: After analyze completed ────────────────────────────
    applySuccessWriteback(db, SESSION_ID, "entity:analyze-resume");
    const stage3 = getRenderedPrompt(db, doc, candidates);

    // Analyze Resume should be in COMPLETED, not ranked
    expect(stage3.plannerOutput.completed_actions).toContain("entity:analyze-resume");
    const stage3Ranked = stage3.plannerOutput.ranked_actions.map((a) => a.entity_id);
    expect(stage3Ranked).not.toContain("entity:analyze-resume");

    // Generate Report should now be ranked (state:resume-parsed is now active
    // from analyze-resume's postconditions)
    const hasGenerateReport = stage3Ranked.includes("entity:generate-report");
    expect(hasGenerateReport).toBe(true);

    // ── Cross-stage validation ──────────────────────────────────────

    // Rendered outputs should all be different
    expect(stage1.rendered).not.toBe(stage2.rendered);
    expect(stage2.rendered).not.toBe(stage3.rendered);
    expect(stage1.rendered).not.toBe(stage3.rendered);
  });

  it("rendered prompt reflects state changes visually", () => {
    const { db, doc } = setup();
    const candidates = getCandidates(db, doc);

    // Stage 1: empty → should show "Blocked Actions"
    getOrCreateWorldState(db, SESSION_ID + "-visual");
    const r1 = getRenderedPrompt(db, doc, candidates).rendered;

    // Stage 2: with upload → "Analyze Resume" should appear in Next Actions
    const s2 = getOrCreateWorldState(db, SESSION_ID + "-visual");
    s2.active_states = ["state:resume-uploaded"];
    saveWorldState(db, s2);
    const r2 = getRenderedPrompt(db, doc, candidates).rendered;

    // Stage 3: after analyze → "Generate Report" in Next Actions
    applySuccessWriteback(db, SESSION_ID + "-visual", "entity:analyze-resume");
    const r3 = getRenderedPrompt(db, doc, candidates).rendered;

    // Stage 1 should mention blocked
    expect(r1).toContain("Blocked");

    // Stage 2 should show Analyze Resume as actionable
    expect(r2).toContain("Analyze Resume");
    expect(r2).toContain("Next Actions");

    // Stage 3 should show Generate Report
    expect(r3).toContain("Generate Report");
    expect(r3).toContain("Next Actions");
  });
});
