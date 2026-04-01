/**
 * Phase 7 Task 7.2 — Relation-Aware Weighting Tests
 *
 * Validates the core scoring guarantees:
 *
 * A. Goal Proximity
 *   [A1] Direct postcondition hit → highest proximity (≈ LEADS_TO weight)
 *   [A2] Operational chain (LEADS_TO → REQUIRES → LEADS_TO) → mid proximity
 *   [A3] SIMILAR path → lower proximity than operational chain
 *   [A4] No path to goal → 0
 *   [A5] Null goal → 0
 *   [A6] Similarity trap: entity:resume-template scores lower than entity:generate-report
 *
 * B. State Readiness
 *   [B1] No preconditions → 1.0
 *   [B2] All preconditions met → 1.0
 *   [B3] Partial preconditions met → fractional value
 *   [B4] No preconditions met → 0.0
 *
 * C. Novelty
 *   [C1] Never attempted → 1.0
 *   [C2] Completed → 0.0
 *   [C3] Blocked → 0.5
 *
 * D. Composite Score
 *   [D1] composite stays in [0, 1]
 *   [D2] state-ready + goal-proximate scores higher than blocked + distant
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
  applyFailureWriteback,
  applySuccessWriteback,
  getOrCreateWorldState,
  saveWorldState,
} from "../runtime/world-state.js";
import { DEFAULT_RELATION_WEIGHTS } from "./graph-expander.js";
import {
  computeGoalProximity,
  computeNovelty,
  computeStateReadiness,
  scoreCandidate,
} from "./planner-scorer.js";
import { DEFAULT_PLANNER_WEIGHTS } from "./planner-types.js";
import type { CandidateEntity } from "./planner-types.js";

// ── Fixture helpers ──────────────────────────────────────────────

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureCtxfstSchema(db);
  const src = readFileSync(FIXTURE_PATH, "utf-8");
  const raw = parseCtxfstDocument(src, "retrieval-test.ctxfst.md");
  const doc = canonicalizeCtxfstDocument(raw);
  indexCtxfstDocument(db, doc);
  return db;
}

function makeCandidate(
  id: string,
  preconditions: string[],
  postconditions: string[],
  retrieval_score = 1.0,
): CandidateEntity {
  return {
    entity_id: id,
    name: id,
    type: "skill",
    retrieval_score,
    document_id: "doc",
    preconditions,
    postconditions,
  };
}

// ── A. Goal Proximity ────────────────────────────────────────────

describe("A1: direct postcondition hit → highest proximity", () => {
  it("entity:generate-report directly produces state:analysis-complete", () => {
    const db = makeDb();
    const proximity = computeGoalProximity(db, "entity:generate-report", "state:analysis-complete");
    // Direct hit → LEADS_TO weight ≈ 0.92
    expect(proximity).toBeCloseTo(DEFAULT_RELATION_WEIGHTS["LEADS_TO"]!, 5);
    expect(proximity).toBeGreaterThan(0.9);
  });
});

describe("A2: operational chain → mid proximity, above SIMILAR path", () => {
  it("entity:analyze-resume reaches state:analysis-complete via 1-hop chain", () => {
    const db = makeDb();
    // analyze-resume → state:resume-parsed → (generate-report requires it) → state:analysis-complete
    const proximity = computeGoalProximity(db, "entity:analyze-resume", "state:analysis-complete");
    // 1-hop operational: (LEADS_TO × REQUIRES) / 2 ≈ 0.437
    expect(proximity).toBeGreaterThan(0);
    expect(proximity).toBeGreaterThan(0.3);
    expect(proximity).toBeLessThan(0.9); // not a direct hit
  });
});

describe("A3: SIMILAR path scores lower than operational chain", () => {
  it("SIMILAR weight (0.6) < LEADS_TO (0.92) yields lower goal proximity", () => {
    // Directly test the math: operational path ≈ (0.92 × 0.95) / 2 = 0.437
    // SIMILAR path ≈ (0.60 × 0.92) / 2 = 0.276
    const operationalScore =
      (DEFAULT_RELATION_WEIGHTS["LEADS_TO"]! * DEFAULT_RELATION_WEIGHTS["REQUIRES"]!) / 2;
    const similarScore =
      (DEFAULT_RELATION_WEIGHTS["SIMILAR"]! * DEFAULT_RELATION_WEIGHTS["LEADS_TO"]!) / 2;

    expect(operationalScore).toBeGreaterThan(similarScore);
    // Operational should be ~57% higher
    expect(operationalScore / similarScore).toBeGreaterThan(1.5);
  });
});

describe("A4: no path to goal → 0", () => {
  it("entity:fastapi has no path to state:analysis-complete → 0", () => {
    const db = makeDb();
    const proximity = computeGoalProximity(db, "entity:fastapi", "state:analysis-complete");
    expect(proximity).toBe(0);
  });
});

describe("A5: null goal → 0", () => {
  it("returns 0 when goalState is null", () => {
    const db = makeDb();
    const proximity = computeGoalProximity(db, "entity:generate-report", null);
    expect(proximity).toBe(0);
  });
});

describe("A6: similarity trap — entity:resume-template vs entity:generate-report", () => {
  it("generate-report scores higher goal proximity than resume-template for state:analysis-complete", () => {
    const db = makeDb();
    const generateReport = computeGoalProximity(
      db,
      "entity:generate-report",
      "state:analysis-complete",
    );
    const resumeTemplate = computeGoalProximity(
      db,
      "entity:resume-template",
      "state:analysis-complete",
    );

    // generate-report directly produces state:analysis-complete → high proximity
    expect(generateReport).toBeGreaterThan(0.9);
    // resume-template has no operational path → 0 (or tiny SIMILAR score)
    expect(generateReport).toBeGreaterThan(resumeTemplate);
  });
});

// ── B. State Readiness ───────────────────────────────────────────

describe("B1: no preconditions → 1.0", () => {
  it("entity with no preconditions is always ready", () => {
    expect(computeStateReadiness([], [])).toBe(1.0);
    expect(computeStateReadiness([], ["state:resume-uploaded"])).toBe(1.0);
  });
});

describe("B2: all preconditions met → 1.0", () => {
  it("returns 1.0 when all preconditions are in activeStates", () => {
    expect(
      computeStateReadiness(
        ["state:resume-uploaded", "state:resume-parsed"],
        ["state:resume-uploaded", "state:resume-parsed", "state:other"],
      ),
    ).toBe(1.0);
  });
});

describe("B3: partial preconditions met → fractional", () => {
  it("1 of 2 preconditions met → 0.5", () => {
    expect(
      computeStateReadiness(
        ["state:resume-uploaded", "state:resume-parsed"],
        ["state:resume-uploaded"],
      ),
    ).toBe(0.5);
  });
});

describe("B4: no preconditions met → 0.0", () => {
  it("returns 0.0 when active states are empty", () => {
    expect(computeStateReadiness(["state:resume-uploaded"], [])).toBe(0.0);
  });
});

// ── C. Novelty ───────────────────────────────────────────────────

describe("C1: never attempted → 1.0", () => {
  it("fresh entity in an empty session scores novelty 1.0", () => {
    const db = makeDb();
    const worldState = getOrCreateWorldState(db, "session-c1");
    expect(computeNovelty("entity:analyze-resume", worldState)).toBe(1.0);
  });
});

describe("C2: completed → 0.0", () => {
  it("completed entity scores novelty 0.0", () => {
    const db = makeDb();
    applySuccessWriteback(db, "session-c2", "entity:analyze-resume");
    const worldState = getOrCreateWorldState(db, "session-c2");
    expect(computeNovelty("entity:analyze-resume", worldState)).toBe(0.0);
  });
});

describe("C3: previously blocked → 0.5", () => {
  it("blocked entity scores novelty 0.5", () => {
    const db = makeDb();
    applyFailureWriteback(db, "session-c3", "entity:analyze-resume");
    const worldState = getOrCreateWorldState(db, "session-c3");
    expect(computeNovelty("entity:analyze-resume", worldState)).toBe(0.5);
  });
});

// ── D. Composite Score ───────────────────────────────────────────

describe("D1: composite stays in [0, 1]", () => {
  it("scoreCandidate returns composite in [0, 1] for extreme inputs", () => {
    const db = makeDb();
    const worldState = getOrCreateWorldState(db, "session-d1");

    const cases: CandidateEntity[] = [
      makeCandidate("entity:generate-report", ["state:resume-parsed"], ["state:analysis-complete"]),
      makeCandidate("entity:fastapi", [], []),
      makeCandidate("entity:analyze-resume", ["state:resume-uploaded"], ["state:resume-parsed"]),
    ];

    for (const candidate of cases) {
      const result = scoreCandidate(
        db,
        candidate,
        worldState,
        "state:analysis-complete",
        DEFAULT_PLANNER_WEIGHTS,
      );
      expect(
        result.composite,
        `${candidate.entity_id} composite must be >= 0`,
      ).toBeGreaterThanOrEqual(0);
      expect(result.composite, `${candidate.entity_id} composite must be <= 1`).toBeLessThanOrEqual(
        1,
      );
    }
  });
});

describe("D2: goal-proximate + state-ready > blocked + distant", () => {
  it("entity ready to execute with goal path ranks higher than entity with no path", () => {
    const db = makeDb();

    // Session with resume-uploaded active (generate-report is NOT ready — needs resume-parsed)
    const worldState = getOrCreateWorldState(db, "session-d2");
    worldState.active_states = ["state:resume-uploaded"];
    saveWorldState(db, worldState);

    // analyze-resume: precondition met (resume-uploaded), has path to goal
    const analyzeResumeCandidate = makeCandidate(
      "entity:analyze-resume",
      ["state:resume-uploaded"],
      ["state:resume-parsed"],
    );
    const analyzeScore = scoreCandidate(
      db,
      analyzeResumeCandidate,
      worldState,
      "state:analysis-complete",
      DEFAULT_PLANNER_WEIGHTS,
    );

    // fastapi: no preconditions, no path to goal
    const fastapiCandidate = makeCandidate("entity:fastapi", [], []);
    const fastapiScore = scoreCandidate(
      db,
      fastapiCandidate,
      worldState,
      "state:analysis-complete",
      DEFAULT_PLANNER_WEIGHTS,
    );

    // analyze-resume should score higher because it has goal proximity
    expect(analyzeScore.composite).toBeGreaterThan(fastapiScore.composite);
  });
});
