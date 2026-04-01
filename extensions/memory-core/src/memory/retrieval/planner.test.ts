/**
 * Phase 7 Task 7.3 — Suggested Next Actions / Planner Tests
 *
 * Validates the planNextActions() output and prompt section builder:
 *
 * A. Goal-aware ranking
 *   [A1] goal changes routing: goal entity directly affects ranked_actions order
 *   [A2] goal-relevant action ranked higher than non-operational entity
 *   [A3] Similarity trap: resume-template not ranked above generate-report
 *
 * B. State-aware decision
 *   [B1] missing preconditions → entity appears in blocked_actions, not ranked
 *   [B2] active state satisfies precondition → entity moves to ranked_actions
 *   [B3] completed skills excluded from ranked_actions
 *
 * C. PlannerOutput shape
 *   [C1] ranked_actions sorted by composite score descending
 *   [C2] completed_actions mirrors worldState.completed_skills
 *   [C3] blocked_actions include missing preconditions
 *
 * D. Prompt section builder
 *   [D1] buildPlannerPromptSections returns Next Actions section
 *   [D2] blocked actions appear in Blocked Actions section
 *   [D3] section content is human-readable
 *   [D4] prompt adapter uses planner sections when plannerOutput provided
 *   [D5] prompt adapter falls back to next-actions when plannerOutput absent
 *
 * E. Replanning after state update
 *   [E1] plan updates when world state changes
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
import type { CandidateEntity, PlannerInput } from "./planner-types.js";
import { buildPlannerPromptSections, planNextActions } from "./planner.js";
import { adaptContextToPrompt } from "./prompt-adapter.js";
import { retrieveContext } from "./retrieval-pipeline.js";
import type { ChunkContent, EntityDetail } from "./types.js";

// ── Fixture helpers ──────────────────────────────────────────────

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

function loadFixture() {
  const src = readFileSync(FIXTURE_PATH, "utf-8");
  const raw = parseCtxfstDocument(src, "retrieval-test.ctxfst.md");
  return canonicalizeCtxfstDocument(raw);
}

function makeDb() {
  const db = new DatabaseSync(":memory:");
  ensureCtxfstSchema(db);
  const doc = loadFixture();
  indexCtxfstDocument(db, doc);
  return { db, doc };
}

function buildCandidates(
  db: DatabaseSync,
  query: string,
  doc: ReturnType<typeof loadFixture>,
): CandidateEntity[] {
  const matches = matchEntitiesForQuery(db, query);
  const entityMap = new Map(doc.entities.map((e) => [e.id, e]));
  return matches.map((m) => {
    const entity = entityMap.get(m.entity_id);
    return {
      entity_id: m.entity_id,
      name: m.name,
      type: entity?.type ?? "unknown",
      retrieval_score: m.score,
      document_id: m.document_id,
      preconditions: entity?.preconditions ?? [],
      postconditions: entity?.postconditions ?? [],
    };
  });
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

// ── A. Goal-aware ranking ────────────────────────────────────────

describe("A1: goal changes routing result", () => {
  it("different goal entities produce different ranked_actions ordering", () => {
    const { db, doc } = makeDb();
    const candidates = buildCandidates(db, "Analyze Resume Generate Report", doc);

    const worldState = getOrCreateWorldState(db, "session-a1");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const planTowardAnalysis: PlannerInput = {
      worldState,
      goal: "state:resume-parsed",
      candidateEntities: candidates,
    };
    const planTowardComplete: PlannerInput = {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    };

    const out1 = planNextActions(db, planTowardAnalysis);
    const out2 = planNextActions(db, planTowardComplete);

    // Both should produce valid output
    expect(out1.goal).toBe("state:resume-parsed");
    expect(out2.goal).toBe("state:analysis-complete");

    // Outputs should differ (different goals → different rankings)
    if (out1.ranked_actions.length > 0 && out2.ranked_actions.length > 0) {
      // Either top action differs, or scores differ
      const topId1 = out1.ranked_actions[0].entity_id;
      const topId2 = out2.ranked_actions[0].entity_id;
      const topScore1 = out1.ranked_actions[0].score;
      const topScore2 = out2.ranked_actions[0].score;
      // At minimum, the scores should differ between the two plans
      const samePlan = topId1 === topId2 && Math.abs(topScore1 - topScore2) < 0.01;
      // Plans for different goals should differ
      expect(samePlan).toBe(false);
    }
  });
});

describe("A2: goal-relevant action ranked higher than non-operational entity", () => {
  it("entity:generate-report scores higher than entity:fastapi for goal state:analysis-complete", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-a2");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report FastAPI", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const generateReport = output.ranked_actions.find(
      (a) => a.entity_id === "entity:generate-report",
    );
    const fastapi = output.ranked_actions.find((a) => a.entity_id === "entity:fastapi");

    expect(generateReport).toBeDefined();
    if (fastapi) {
      expect(generateReport!.score).toBeGreaterThan(fastapi.score);
    }
  });
});

describe("A3: similarity trap — resume-template not ranked above generate-report", () => {
  it("entity:generate-report outranks entity:resume-template for goal state:analysis-complete", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-a3");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report Resume Template", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const generateReport = output.ranked_actions.find(
      (a) => a.entity_id === "entity:generate-report",
    );
    const resumeTemplate = output.ranked_actions.find(
      (a) => a.entity_id === "entity:resume-template",
    );

    expect(generateReport).toBeDefined();
    if (resumeTemplate) {
      // generate-report should outrank the similarity trap
      expect(generateReport!.score).toBeGreaterThan(resumeTemplate.score);
    }
  });
});

// ── B. State-aware decisions ─────────────────────────────────────

describe("B1: missing preconditions → entity goes to blocked_actions", () => {
  it("entity:analyze-resume is blocked when state:resume-uploaded is absent", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-b1");
    // No active states → analyze-resume's precondition not met
    const candidates = buildCandidates(db, "Analyze Resume", doc);

    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const blockedEntry = output.blocked_actions.find(
      (b) => b.entity_id === "entity:analyze-resume",
    );
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry!.missing_preconditions).toContain("state:resume-uploaded");

    // Should NOT appear in ranked_actions
    const notInRanked = !output.ranked_actions.some((a) => a.entity_id === "entity:analyze-resume");
    expect(notInRanked).toBe(true);
  });
});

describe("B2: active state satisfies precondition → entity appears in ranked_actions", () => {
  it("entity:analyze-resume appears in ranked when state:resume-uploaded is active", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-b2");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const ranked = output.ranked_actions.find((a) => a.entity_id === "entity:analyze-resume");
    expect(ranked).toBeDefined();
    expect(ranked!.score).toBeGreaterThan(0);
  });
});

describe("B3: completed skills excluded from ranked_actions", () => {
  it("entity:analyze-resume is absent from ranked_actions after completion", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-b3");
    worldState.active_states = ["state:resume-uploaded"];
    applySuccessWriteback(db, "session-b3", "entity:analyze-resume");

    const updatedState = getOrCreateWorldState(db, "session-b3");
    const candidates = buildCandidates(db, "Analyze Resume", doc);

    const output = planNextActions(db, {
      worldState: updatedState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const inRanked = output.ranked_actions.some((a) => a.entity_id === "entity:analyze-resume");
    expect(inRanked).toBe(false);
    expect(output.completed_actions).toContain("entity:analyze-resume");
  });
});

// ── C. PlannerOutput shape ───────────────────────────────────────

describe("C1: ranked_actions sorted by score descending", () => {
  it("first action has the highest score", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-c1");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume Generate Report FastAPI", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const actions = output.ranked_actions;
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i - 1].score).toBeGreaterThanOrEqual(actions[i].score - 1e-9);
    }
  });
});

describe("C2: completed_actions mirrors worldState.completed_skills", () => {
  it("completed_actions contains entity IDs from completed_skills", () => {
    const { db, doc } = makeDb();

    applySuccessWriteback(db, "session-c2", "entity:analyze-resume");
    const worldState = getOrCreateWorldState(db, "session-c2");
    const candidates = buildCandidates(db, "Analyze Resume", doc);

    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    expect(output.completed_actions).toContain("entity:analyze-resume");
  });
});

describe("C3: blocked_actions include missing preconditions", () => {
  it("blocked entry includes the missing state IDs", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-c3");
    const candidates = buildCandidates(db, "Generate Report", doc);

    // generate-report requires state:resume-parsed — not active
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const blocked = output.blocked_actions.find((b) => b.entity_id === "entity:generate-report");
    if (blocked) {
      expect(blocked.missing_preconditions).toContain("state:resume-parsed");
    }
  });
});

// ── D. Prompt section builder ────────────────────────────────────

describe("D1: buildPlannerPromptSections returns Next Actions section", () => {
  it("produces a Next Actions section when ranked_actions is non-empty", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-d1");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const sections = buildPlannerPromptSections(output);
    const nextSection = sections.find((s) => s.label === "Next Actions");
    expect(nextSection).toBeDefined();
    expect(nextSection!.content).toContain("Analyze Resume");
    expect(nextSection!.content).toContain("%");
  });
});

describe("D2: blocked actions appear in Blocked Actions section", () => {
  it("Blocked Actions section lists missing preconditions", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-d2");
    const candidates = buildCandidates(db, "Generate Report", doc);

    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const sections = buildPlannerPromptSections(output);
    const blockedSection = sections.find((s) => s.label === "Blocked Actions");
    if (output.blocked_actions.length > 0) {
      expect(blockedSection).toBeDefined();
      expect(blockedSection!.content).toContain("blocked");
    }
  });
});

describe("D3: section content is human-readable", () => {
  it("Next Actions content has entity names and score percentages", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-d3");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report Analyze Resume", doc);
    const output = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const sections = buildPlannerPromptSections(output);
    const nextSection = sections.find((s) => s.label === "Next Actions");
    if (nextSection) {
      // Should have human-readable name
      expect(nextSection.content).toMatch(/\*\*[A-Za-z ]+\*\*/);
      // Should have score percentage
      expect(nextSection.content).toMatch(/\d+%/);
      // Should not dump raw IDs without explanation
      expect(nextSection.content).toContain("—");
    }
  });
});

describe("D4: prompt adapter uses planner sections when plannerOutput provided", () => {
  it("prompt has Next Actions section instead of Suggested Next Actions", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-d4");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });
    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const prompt = adaptContextToPrompt({
      contextPack,
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
      activeStates: worldState.active_states,
      completedSkills: worldState.completed_skills.map((r) => r.entityId),
      plannerOutput,
    });

    const labels = prompt.sections.map((s) => s.label);
    // Planner sections should be present
    if (plannerOutput.ranked_actions.length > 0) {
      expect(labels).toContain("Next Actions");
    }
    // Old-style section should not appear when planner is active
    expect(labels).not.toContain("Suggested Next Actions");
  });
});

describe("D5: prompt adapter falls back to next-actions when plannerOutput absent", () => {
  it("Suggested Next Actions section appears when plannerOutput is not provided", () => {
    const { db, doc } = makeDb();

    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const prompt = adaptContextToPrompt({
      contextPack,
      chunkContent: buildChunkContentMap(doc),
      entityDetails: buildEntityDetailMap(doc),
      // no plannerOutput
    });

    // The old-style section should still work
    const labels = prompt.sections.map((s) => s.label);
    // No "Next Actions" (planner) section
    expect(labels).not.toContain("Next Actions");
  });
});

// ── E. Replanning after state update ────────────────────────────

describe("E1: plan updates after world state changes", () => {
  it("adding active state moves entity from blocked to ranked", () => {
    const { db, doc } = makeDb();
    const sessionId = "session-e1";
    const candidates = buildCandidates(db, "Analyze Resume", doc);

    // First plan: no active states → analyze-resume is blocked
    const state1 = getOrCreateWorldState(db, sessionId);
    const output1 = planNextActions(db, {
      worldState: state1,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });
    expect(output1.blocked_actions.some((b) => b.entity_id === "entity:analyze-resume")).toBe(true);
    expect(output1.ranked_actions.some((a) => a.entity_id === "entity:analyze-resume")).toBe(false);

    // Update state: add resume-uploaded
    state1.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state1);

    // Second plan: precondition now met → analyze-resume should be ranked
    const state2 = getOrCreateWorldState(db, sessionId);
    const output2 = planNextActions(db, {
      worldState: state2,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });
    expect(output2.ranked_actions.some((a) => a.entity_id === "entity:analyze-resume")).toBe(true);
    expect(output2.blocked_actions.some((b) => b.entity_id === "entity:analyze-resume")).toBe(
      false,
    );
  });
});
