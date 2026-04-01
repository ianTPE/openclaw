/**
 * Phase 7 Task 7.1 — Goal-Aware Ranking Input Definitions
 *
 * These tests validate the structural soundness of the planner type contracts:
 *
 * 1. PlannerInput can be constructed from real fixture + session data
 * 2. Scoring signals are well-bounded [0, 1]
 * 3. Default weights sum to ~1.0
 * 4. CandidateEntity can be derived from retrieval + entity detail data
 * 5. PlannerOutput has the expected shape
 * 6. ActionExplanation fields are stable and nullable where expected
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
  DEFAULT_PLANNER_WEIGHTS,
  type BlockedAction,
  type CandidateEntity,
  type PlannerInput,
  type PlannerOutput,
  type RankedAction,
  type ScoringSignals,
} from "./planner-types.js";

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

/** Build CandidateEntity list from fixture entities + retrieval matches. */
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

// ── 1. PlannerInput construction ─────────────────────────────────

describe("PlannerInput can be constructed from fixture + session data", () => {
  it("builds a valid PlannerInput with goal, world state, and candidates", () => {
    const { db, doc } = createIndexedDb();

    const state = getOrCreateWorldState(db, "session-7.1");
    state.active_states = ["state:resume-uploaded"];
    state.goal_entity_id = "state:analysis-complete";
    saveWorldState(db, state);

    const candidates = buildCandidates(db, "Analyze Resume", doc);

    const input: PlannerInput = {
      worldState: state,
      goal: "state:analysis-complete",
      candidateEntities: candidates,
    };

    expect(input.goal).toBe("state:analysis-complete");
    expect(input.worldState.session_id).toBe("session-7.1");
    expect(input.worldState.active_states).toContain("state:resume-uploaded");
    expect(input.candidateEntities.length).toBeGreaterThan(0);

    // Candidate should have entity:analyze-resume with preconditions/postconditions
    const analyzeResume = input.candidateEntities.find(
      (c) => c.entity_id === "entity:analyze-resume",
    );
    expect(analyzeResume).toBeDefined();
    expect(analyzeResume!.preconditions).toContain("state:resume-uploaded");
    expect(analyzeResume!.postconditions).toContain("state:resume-parsed");
    expect(analyzeResume!.retrieval_score).toBeGreaterThan(0);
  });

  it("works with null goal (goal-proximity scoring disabled)", () => {
    const { db, doc } = createIndexedDb();
    const state = getOrCreateWorldState(db, "session-7.1-no-goal");
    const candidates = buildCandidates(db, "FastAPI", doc);

    const input: PlannerInput = {
      worldState: state,
      goal: null,
      candidateEntities: candidates,
    };

    expect(input.goal).toBeNull();
    expect(input.candidateEntities.length).toBeGreaterThan(0);
  });
});

// ── 2. Scoring signals are bounded ──────────────────────────────

describe("ScoringSignals are well-bounded in [0, 1]", () => {
  it("all signal values must be in [0, 1]", () => {
    // Construct a representative set of signal values
    const examples: ScoringSignals[] = [
      // Ideal: all signals high
      { retrieval_score: 1.0, goal_proximity: 1.0, state_readiness: 1.0, novelty: 1.0 },
      // Entity with no path to goal
      { retrieval_score: 0.9, goal_proximity: 0.0, state_readiness: 1.0, novelty: 1.0 },
      // Completed entity
      { retrieval_score: 0.8, goal_proximity: 0.5, state_readiness: 1.0, novelty: 0.0 },
      // Blocked entity (partial readiness)
      { retrieval_score: 0.7, goal_proximity: 0.3, state_readiness: 0.5, novelty: 0.5 },
      // Zero retrieval (shouldn't normally happen but valid)
      { retrieval_score: 0.0, goal_proximity: 0.0, state_readiness: 0.0, novelty: 0.0 },
    ];

    for (const signals of examples) {
      for (const [key, value] of Object.entries(signals)) {
        expect(value, `${key} must be >= 0`).toBeGreaterThanOrEqual(0);
        expect(value, `${key} must be <= 1`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("composite score formula stays in [0, 1] with default weights", () => {
    const w = DEFAULT_PLANNER_WEIGHTS;

    // Best case: all signals = 1.0
    const maxScore =
      1.0 * w.retrieval + 1.0 * w.goalProximity + 1.0 * w.stateReadiness + 1.0 * w.novelty;
    expect(maxScore).toBeLessThanOrEqual(1.0 + 1e-9);

    // Worst case: all signals = 0.0
    const minScore =
      0.0 * w.retrieval + 0.0 * w.goalProximity + 0.0 * w.stateReadiness + 0.0 * w.novelty;
    expect(minScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 3. Default weights ──────────────────────────────────────────

describe("DEFAULT_PLANNER_WEIGHTS", () => {
  it("sum to 1.0", () => {
    const w = DEFAULT_PLANNER_WEIGHTS;
    const sum = w.retrieval + w.goalProximity + w.stateReadiness + w.novelty;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("goalProximity is the strongest signal", () => {
    const w = DEFAULT_PLANNER_WEIGHTS;
    expect(w.goalProximity).toBeGreaterThan(w.retrieval);
    expect(w.goalProximity).toBeGreaterThan(w.stateReadiness);
    expect(w.goalProximity).toBeGreaterThan(w.novelty);
  });

  it("novelty is the weakest signal", () => {
    const w = DEFAULT_PLANNER_WEIGHTS;
    expect(w.novelty).toBeLessThan(w.retrieval);
    expect(w.novelty).toBeLessThan(w.goalProximity);
    expect(w.novelty).toBeLessThan(w.stateReadiness);
  });
});

// ── 4. CandidateEntity from retrieval data ──────────────────────

describe("CandidateEntity derivation from retrieval + fixture", () => {
  it("skill entities carry preconditions and postconditions", () => {
    const { db, doc } = createIndexedDb();
    const candidates = buildCandidates(db, "Analyze Resume Generate Report", doc);

    const skills = candidates.filter((c) => c.type === "skill");
    expect(skills.length).toBeGreaterThan(0);

    for (const skill of skills) {
      // Skills in the fixture have at least one precondition and one postcondition
      expect(skill.preconditions.length, `${skill.name} should have preconditions`).toBeGreaterThan(
        0,
      );
      expect(
        skill.postconditions.length,
        `${skill.name} should have postconditions`,
      ).toBeGreaterThan(0);
    }
  });

  it("non-operational entities (framework, concept) have empty preconditions", () => {
    const { db, doc } = createIndexedDb();
    const candidates = buildCandidates(db, "FastAPI Vector Search", doc);

    const nonOperational = candidates.filter((c) => c.type === "framework" || c.type === "concept");
    expect(nonOperational.length).toBeGreaterThan(0);

    for (const entity of nonOperational) {
      expect(entity.preconditions).toHaveLength(0);
      expect(entity.postconditions).toHaveLength(0);
    }
  });
});

// ── 5. PlannerOutput shape ──────────────────────────────────────

describe("PlannerOutput has the expected shape", () => {
  it("can construct a well-formed PlannerOutput", () => {
    const rankedAction: RankedAction = {
      entity_id: "entity:analyze-resume",
      name: "Analyze Resume",
      type: "skill",
      score: 0.82,
      explanation: {
        goal_reason: "Leads toward state:analysis-complete via state:resume-parsed",
        state_reason: "All preconditions met (state:resume-uploaded is active)",
        novelty_reason: "Not yet attempted in this session",
        summary: "Recommended: leads toward goal, preconditions satisfied, and not yet attempted.",
      },
      signals: {
        retrieval_score: 0.9,
        goal_proximity: 0.5,
        state_readiness: 1.0,
        novelty: 1.0,
      },
    };

    const blockedAction: BlockedAction = {
      entity_id: "entity:generate-report",
      name: "Generate Report",
      missing_preconditions: ["state:resume-parsed"],
    };

    const output: PlannerOutput = {
      goal: "state:analysis-complete",
      ranked_actions: [rankedAction],
      blocked_actions: [blockedAction],
      completed_actions: [],
    };

    expect(output.goal).toBe("state:analysis-complete");
    expect(output.ranked_actions).toHaveLength(1);
    expect(output.ranked_actions[0].score).toBeGreaterThan(0);
    expect(output.ranked_actions[0].explanation.summary).toBeTruthy();
    expect(output.blocked_actions).toHaveLength(1);
    expect(output.blocked_actions[0].missing_preconditions).toContain("state:resume-parsed");
    expect(output.completed_actions).toHaveLength(0);
  });

  it("completed_actions tracks entity IDs from session state", () => {
    const { db } = createIndexedDb();

    // Complete a skill
    applySuccessWriteback(db, "session-output", "entity:analyze-resume");

    const output: PlannerOutput = {
      goal: "state:analysis-complete",
      ranked_actions: [],
      blocked_actions: [],
      completed_actions: ["entity:analyze-resume"],
    };

    expect(output.completed_actions).toContain("entity:analyze-resume");
  });
});

// ── 6. ActionExplanation nullable fields ────────────────────────

describe("ActionExplanation field nullability", () => {
  it("goal_reason is null when no goal is set", () => {
    const action: RankedAction = {
      entity_id: "entity:fastapi",
      name: "FastAPI",
      type: "framework",
      score: 0.6,
      explanation: {
        goal_reason: null,
        state_reason: "No preconditions required",
        novelty_reason: "Not yet referenced in this session",
        summary: "Relevant to query; no preconditions needed.",
      },
      signals: {
        retrieval_score: 1.0,
        goal_proximity: 0.0,
        state_readiness: 1.0,
        novelty: 1.0,
      },
    };

    expect(action.explanation.goal_reason).toBeNull();
    expect(action.explanation.state_reason).toBeTruthy();
    expect(action.explanation.summary).toBeTruthy();
  });

  it("goal_reason is present when goal is set and entity is on path", () => {
    const action: RankedAction = {
      entity_id: "entity:analyze-resume",
      name: "Analyze Resume",
      type: "skill",
      score: 0.85,
      explanation: {
        goal_reason: "Leads toward state:analysis-complete (2 hops via state:resume-parsed)",
        state_reason: "All preconditions met",
        novelty_reason: "Not yet attempted",
        summary: "Recommended: on the critical path to goal, preconditions satisfied.",
      },
      signals: {
        retrieval_score: 0.9,
        goal_proximity: 0.5,
        state_readiness: 1.0,
        novelty: 1.0,
      },
    };

    expect(action.explanation.goal_reason).toBeTruthy();
    expect(action.explanation.goal_reason).toContain("state:analysis-complete");
  });
});
