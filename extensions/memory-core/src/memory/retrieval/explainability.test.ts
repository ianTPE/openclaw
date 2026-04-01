/**
 * Phase 7 Task 7.4 — Explainability Hooks Tests
 *
 * Validates the Phase 7 validation checklist E-section:
 *
 * E. Explainability
 *   [E1] Explanation names the goal
 *   [E2] Explanation references relation semantics (REQUIRES, LEADS_TO, precondition status)
 *   [E3] Explanation is stable, readable, not just raw score dumps
 *
 * Additional coverage:
 *   [F1] Entity match explanations distinguish direct vs graph-expanded
 *   [F2] Chunk inclusion explanations list contributing sources
 *   [F3] Action recommendation explanations cover recommended/blocked/completed
 *   [F4] Full trace composes all stages
 *   [F5] Rendered output is human-readable markdown
 *   [F6] Similarity trap: explanation for resume-template differs from generate-report
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
import {
  buildExplainabilityTrace,
  explainActionRecommendations,
  explainChunkInclusions,
  explainEntityMatches,
  renderExplainabilityTrace,
} from "./explainability.js";
import type { CandidateEntity } from "./planner-types.js";
import { planNextActions } from "./planner.js";
import { retrieveContext } from "./retrieval-pipeline.js";

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

// ── E1: Explanation names the goal ──────────────────────────────

describe("E1: explanation names the goal", () => {
  it("trace summary includes the goal state", () => {
    const { db, doc } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const worldState = getOrCreateWorldState(db, "session-e1");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const trace = buildExplainabilityTrace({ contextPack, plannerOutput });

    expect(trace.goal).toBe("state:analysis-complete");
    expect(trace.summary).toContain("state:analysis-complete");
  });

  it("recommended action explanation references the goal", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-e1b");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const actionExplanations = explainActionRecommendations(plannerOutput);
    const generateReport = actionExplanations.find(
      (a) => a.entity_id === "entity:generate-report" && a.status === "recommended",
    );

    expect(generateReport).toBeDefined();
    // The explanation's goal_reason should reference the goal
    expect(generateReport!.explanation?.goal_reason).toBeTruthy();
    expect(generateReport!.explanation!.goal_reason).toContain("state:analysis-complete");
  });
});

// ── E2: Explanation references relation semantics ───────────────

describe("E2: explanation references relation semantics", () => {
  it("graph-expanded entity explanation names the relation type", () => {
    const { db } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const entityExplanations = explainEntityMatches(contextPack);
    const expanded = entityExplanations.filter((e) => e.match_type === "graph_expansion");

    // If there are graph-expanded entities, their reasons should name the relation
    if (expanded.length > 0) {
      for (const e of expanded) {
        expect(e.expansion_detail).toBeDefined();
        expect(e.expansion_detail!.relation).toBeTruthy();
        // Reason should reference the relation (e.g., "REQUIRES", "LEADS_TO", "SIMILAR")
        expect(e.reason).toMatch(/REQUIRES|LEADS_TO|SIMILAR|EVIDENCE|IMPLIES/);
      }
    }
  });

  it("recommended action with goal path references LEADS_TO/REQUIRES in explanation", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-e2b");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const analyzeResume = plannerOutput.ranked_actions.find(
      (a) => a.entity_id === "entity:analyze-resume",
    );

    if (analyzeResume) {
      // Entity with operational path should mention LEADS_TO/REQUIRES
      expect(analyzeResume.explanation.goal_reason).toBeTruthy();
      expect(analyzeResume.explanation.goal_reason).toMatch(/LEADS_TO|REQUIRES|operational/i);
    }
  });

  it("blocked action explanation lists missing preconditions", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-e2c");
    // No active states → generate-report is blocked (needs state:resume-parsed)

    const candidates = buildCandidates(db, "Generate Report", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const actionExplanations = explainActionRecommendations(plannerOutput);
    const blocked = actionExplanations.find(
      (a) => a.entity_id === "entity:generate-report" && a.status === "blocked",
    );

    if (blocked) {
      expect(blocked.missing_preconditions).toBeDefined();
      expect(blocked.missing_preconditions!.length).toBeGreaterThan(0);
      expect(blocked.reason).toContain("precondition");
    }
  });
});

// ── E3: Explanation is stable and readable ──────────────────────

describe("E3: explanation is stable, readable, not just raw score dumps", () => {
  it("trace summary is a well-formed sentence, not a JSON/score dump", () => {
    const { db, doc } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const worldState = getOrCreateWorldState(db, "session-e3a");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const trace = buildExplainabilityTrace({ contextPack, plannerOutput });

    // Summary should end with a period
    expect(trace.summary).toMatch(/\.$/);
    // Should not contain raw JSON-like structures
    expect(trace.summary).not.toContain("{");
    expect(trace.summary).not.toContain("}");
    // Should contain human-readable words
    expect(trace.summary).toContain("query");
    expect(trace.summary).toContain("entities");
  });

  it("action explanation summary is a human-readable sentence", () => {
    const { db, doc } = makeDb();
    const worldState = getOrCreateWorldState(db, "session-e3b");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const actionExplanations = explainActionRecommendations(plannerOutput);
    for (const a of actionExplanations) {
      // Each reason should be a readable string
      expect(a.reason.length).toBeGreaterThan(5);
      // Should not be a numeric score dump
      expect(a.reason).not.toMatch(/^\d+\.\d+$/);
      // Should not contain raw object notation
      expect(a.reason).not.toContain("[object");
    }
  });

  it("rendered trace output is valid markdown", () => {
    const { db, doc } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const worldState = getOrCreateWorldState(db, "session-e3c");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const trace = buildExplainabilityTrace({ contextPack, plannerOutput });
    const rendered = renderExplainabilityTrace(trace);

    // Should contain markdown headings
    expect(rendered).toContain("## Explainability Trace");
    expect(rendered).toContain("### Matched Entities");
    expect(rendered).toContain("### Action Recommendations");
    // Should contain bullet points with entity names
    expect(rendered).toMatch(/- \*\*[A-Za-z ]+\*\*/);
    // Should contain status labels
    expect(rendered).toMatch(/\[Recommended\]|\[Blocked\]|\[Completed\]/);
  });
});

// ── F1: Entity match explanations ───────────────────────────────

describe("F1: entity match explanations distinguish direct vs expanded", () => {
  it("direct query match has match_type 'direct_query'", () => {
    const { db } = makeDb();
    const contextPack = retrieveContext({ db, query: "FastAPI", graphExpansion: false });

    const explanations = explainEntityMatches(contextPack);
    const fastapi = explanations.find((e) => e.entity_id === "entity:fastapi");

    expect(fastapi).toBeDefined();
    expect(fastapi!.match_type).toBe("direct_query");
    expect(fastapi!.reason).toContain("Matched query");
  });

  it("graph-expanded entities have match_type 'graph_expansion' and expansion_detail", () => {
    const { db } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const explanations = explainEntityMatches(contextPack);
    const expanded = explanations.filter((e) => e.match_type === "graph_expansion");

    if (expanded.length > 0) {
      for (const e of expanded) {
        expect(e.expansion_detail).toBeDefined();
        expect(e.expansion_detail!.seed_entity).toBeTruthy();
        expect(e.expansion_detail!.relation).toBeTruthy();
        expect(e.expansion_detail!.weighted_score).toBeGreaterThan(0);
      }
    }
  });
});

// ── F2: Chunk inclusion explanations ─────────────────────────────

describe("F2: chunk inclusion explanations list contributing sources", () => {
  it("chunk explanations include source descriptions", () => {
    const { db } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const explanations = explainChunkInclusions(contextPack);

    expect(explanations.length).toBeGreaterThan(0);
    for (const c of explanations) {
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c.reason).toContain("Included via");
      // Sources should be human-readable labels, not raw enum values
      for (const s of c.sources) {
        expect(s).toMatch(/entity reference|graph expansion|vector similarity|keyword match/);
      }
    }
  });
});

// ── F3: Action recommendation explanations ───────────────────────

describe("F3: action explanations cover all statuses", () => {
  it("covers recommended, blocked, and completed actions", () => {
    const { db, doc } = makeDb();

    // Set up a state where we have all three categories
    applySuccessWriteback(db, "session-f3", "entity:fastapi");
    const worldState = getOrCreateWorldState(db, "session-f3");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    // Candidates: analyze-resume (ready), generate-report (blocked), fastapi (completed)
    const candidates: CandidateEntity[] = [
      {
        entity_id: "entity:analyze-resume",
        name: "Analyze Resume",
        type: "skill",
        retrieval_score: 1.0,
        document_id: "doc",
        preconditions: ["state:resume-uploaded"],
        postconditions: ["state:resume-parsed"],
      },
      {
        entity_id: "entity:generate-report",
        name: "Generate Report",
        type: "skill",
        retrieval_score: 0.9,
        document_id: "doc",
        preconditions: ["state:resume-parsed"],
        postconditions: ["state:analysis-complete"],
      },
      {
        entity_id: "entity:fastapi",
        name: "FastAPI",
        type: "tool",
        retrieval_score: 0.8,
        document_id: "doc",
        preconditions: [],
        postconditions: [],
      },
    ];

    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const explanations = explainActionRecommendations(plannerOutput);

    const recommended = explanations.filter((a) => a.status === "recommended");
    const blocked = explanations.filter((a) => a.status === "blocked");
    const completed = explanations.filter((a) => a.status === "completed");

    expect(recommended.length).toBeGreaterThan(0);
    expect(blocked.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);

    // Recommended should have signals and explanation
    for (const r of recommended) {
      expect(r.signals).toBeDefined();
      expect(r.explanation).toBeDefined();
    }

    // Blocked should have missing_preconditions
    for (const b of blocked) {
      expect(b.missing_preconditions).toBeDefined();
      expect(b.missing_preconditions!.length).toBeGreaterThan(0);
    }
  });
});

// ── F4: Full trace composition ──────────────────────────────────

describe("F4: full trace composes all pipeline stages", () => {
  it("trace contains entity, chunk, and action explanations", () => {
    const { db, doc } = makeDb();
    const contextPack = retrieveContext({ db, query: "Analyze Resume", graphExpansion: true });

    const worldState = getOrCreateWorldState(db, "session-f4");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Analyze Resume", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const trace = buildExplainabilityTrace({ contextPack, plannerOutput });

    expect(trace.query).toBe("Analyze Resume");
    expect(trace.goal).toBe("state:analysis-complete");
    expect(trace.entity_explanations.length).toBeGreaterThan(0);
    expect(trace.chunk_explanations.length).toBeGreaterThan(0);
    expect(trace.action_explanations.length).toBeGreaterThan(0);
    expect(trace.summary.length).toBeGreaterThan(0);
  });
});

// ── F5: Rendered output is readable ─────────────────────────────

describe("F5: rendered trace is human-readable markdown", () => {
  it("rendered output has structure and is not empty", () => {
    const { db, doc } = makeDb();
    const contextPack = retrieveContext({ db, query: "Generate Report", graphExpansion: true });

    const worldState = getOrCreateWorldState(db, "session-f5");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const trace = buildExplainabilityTrace({ contextPack, plannerOutput });
    const rendered = renderExplainabilityTrace(trace);

    expect(rendered.length).toBeGreaterThan(100);
    // Should contain the trace summary text
    expect(rendered).toContain(trace.summary);
  });
});

// ── F6: Similarity trap visible in explanations ─────────────────

describe("F6: similarity trap is explained differently", () => {
  it("generate-report and resume-template get different explanations for the same goal", () => {
    const { db, doc } = makeDb();

    const worldState = getOrCreateWorldState(db, "session-f6");
    worldState.active_states = ["state:resume-uploaded", "state:resume-parsed"];
    saveWorldState(db, worldState);

    const candidates = buildCandidates(db, "Generate Report Resume Template", doc);
    const plannerOutput = planNextActions(db, {
      worldState,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    });

    const explanations = explainActionRecommendations(plannerOutput);
    const generateReport = explanations.find((a) => a.entity_id === "entity:generate-report");
    const resumeTemplate = explanations.find((a) => a.entity_id === "entity:resume-template");

    // generate-report should have a goal-related explanation
    if (generateReport?.explanation?.goal_reason) {
      expect(generateReport.explanation.goal_reason).toContain("state:analysis-complete");
    }

    // If both are present, their explanations should differ
    if (generateReport && resumeTemplate) {
      expect(generateReport.reason).not.toBe(resumeTemplate.reason);
    }
  });
});
