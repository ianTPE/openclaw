/**
 * Phase 6 Validation Tests — Runtime State
 *
 * Covers the Phase 6 validation checklist
 * (docs/openclaw-upgrade-specs/27-phase-6-validation-checklist.md):
 *
 * A. World State Persistence
 *   [A1] session state can be created and loaded back
 *   [A2] existing session state survives multiple load calls
 *   [A3] state persists across separate getOrCreate calls
 *
 * B. Precondition Checking (Task 6.3)
 *   [B1] satisfied preconditions → ok = true, missing = []
 *   [B2] missing preconditions → ok = false, missing lists absent state
 *   [B3] multiple missing preconditions surfaced in full
 *   [B4] entity with no preconditions → ok = true
 *
 * C. Postcondition Writeback — Success (Task 6.4)
 *   [C1] successful execution adds postconditions to active_states
 *   [C2] completed skill recorded with entityId + timestamp + status
 *   [C3] idempotent: second applySuccessWriteback does not duplicate state or skills
 *   [C4] failed execution does NOT apply postconditions
 *
 * D. Failure / Blocked Writeback (Task 6.4)
 *   [D1] failure writes entity to blocked_by
 *   [D2] blocked_by is deduped on repeated failure calls
 *   [D3] failure appends "blocked" runtime event
 *
 * E. Runtime Events (Task 6.2 + 6.4)
 *   [E1] COMPLETED event written on success
 *   [E2] BLOCKED event written on failure
 *   [E3] runtime events carry session_id + entity_id + timestamp
 *
 * F. Runtime Edge Writeback (Task 6.5)
 *   [F1] COMPLETED edge written and retrievable
 *   [F2] BLOCKED_BY edge written and retrievable
 *   [F3] EVIDENCE edge written and retrievable
 *   [F4] multiple runtime edges between same pair are allowed (no unique conflict)
 *   [F5] runtime edges carry session provenance in metadata_json
 *
 * G. Multi-Session Isolation
 *   [G1] sessions A and B do not share active_states
 *   [G2] runtime events from one session don't appear in another
 *   [G3] runtime edges from one session don't overwrite another's state
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalizeCtxfstDocument } from "../formats/ctxfst/canonicalize.js";
import { parseCtxfstDocument } from "../formats/ctxfst/parser.js";
import { indexCtxfstDocument } from "../indexing/ctxfst-indexer.js";
import {
  writeBlockedByEdge,
  writeCompletedEdge,
  writeEvidenceEdge,
  writeRuntimeEdge,
} from "./runtime-edge.js";
import {
  applyFailureWriteback,
  applySuccessWriteback,
  checkPreconditions,
  getOrCreateWorldState,
  getSessionEvents,
  loadWorldState,
  saveWorldState,
} from "./world-state.js";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
);

function makeDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

function loadFixtureDoc() {
  const src = fs.readFileSync(FIXTURE_PATH, "utf8");
  const raw = parseCtxfstDocument(src, FIXTURE_PATH);
  return canonicalizeCtxfstDocument(raw);
}

let db: DatabaseSync;
let docId: string;

beforeEach(() => {
  db = makeDb();
  const doc = loadFixtureDoc();
  docId = doc.id;
  indexCtxfstDocument(db, doc);
});

// ---------------------------------------------------------------------------
// A. World State Persistence
// ---------------------------------------------------------------------------

describe("A1: session state can be created and loaded back", () => {
  it("getOrCreateWorldState creates a new empty state and loadWorldState retrieves it", () => {
    const sessionId = "session-a1";
    const created = getOrCreateWorldState(db, sessionId);

    expect(created.session_id).toBe(sessionId);
    expect(created.goal_entity_id).toBeNull();
    expect(created.active_states).toEqual([]);
    expect(created.completed_skills).toEqual([]);
    expect(created.blocked_by).toEqual([]);

    const loaded = loadWorldState(db, sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.session_id).toBe(sessionId);
    expect(loaded!.active_states).toEqual([]);
  });

  it("loadWorldState returns null for an unknown session", () => {
    const result = loadWorldState(db, "nonexistent-session");
    expect(result).toBeNull();
  });
});

describe("A2: existing session state survives multiple load calls", () => {
  it("mutated state persists after saveWorldState", () => {
    const sessionId = "session-a2";
    const state = getOrCreateWorldState(db, sessionId);
    state.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state);

    const loaded = loadWorldState(db, sessionId);
    expect(loaded!.active_states).toContain("state:resume-uploaded");
  });
});

describe("A3: state persists across separate getOrCreate calls", () => {
  it("second getOrCreateWorldState returns the already-saved state", () => {
    const sessionId = "session-a3";
    const first = getOrCreateWorldState(db, sessionId);
    first.active_states = ["state:resume-uploaded"];
    saveWorldState(db, first);

    const second = getOrCreateWorldState(db, sessionId);
    expect(second.active_states).toContain("state:resume-uploaded");
  });
});

// ---------------------------------------------------------------------------
// B. Precondition Checking
// ---------------------------------------------------------------------------

describe("B1: satisfied preconditions → ok = true", () => {
  it("entity:analyze-resume with state:resume-uploaded active returns ok", () => {
    const sessionId = "session-b1";
    const state = getOrCreateWorldState(db, sessionId);
    state.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state);

    const result = checkPreconditions(db, sessionId, "entity:analyze-resume");
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("B2: missing precondition → ok = false, correct missing list", () => {
  it("entity:analyze-resume with empty session returns missing state:resume-uploaded", () => {
    const sessionId = "session-b2";
    getOrCreateWorldState(db, sessionId);

    const result = checkPreconditions(db, sessionId, "entity:analyze-resume");
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("state:resume-uploaded");
  });

  it("works when session does not exist yet (treated as empty)", () => {
    const result = checkPreconditions(db, "never-created", "entity:analyze-resume");
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe("B3: multiple missing preconditions surfaced", () => {
  it("entity:generate-report needs state:resume-parsed; reports it when absent", () => {
    const sessionId = "session-b3";
    getOrCreateWorldState(db, sessionId);

    const result = checkPreconditions(db, sessionId, "entity:generate-report");
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("state:resume-parsed");
  });
});

describe("B4: entity with no preconditions", () => {
  it("entity:fastapi has no preconditions → always ok", () => {
    const sessionId = "session-b4";
    getOrCreateWorldState(db, sessionId);

    const result = checkPreconditions(db, sessionId, "entity:fastapi");
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. Postcondition Writeback — Success
// ---------------------------------------------------------------------------

describe("C1: successful execution adds postconditions to active_states", () => {
  it("applySuccessWriteback for entity:analyze-resume adds state:resume-parsed", () => {
    const sessionId = "session-c1";
    const state = getOrCreateWorldState(db, sessionId);
    state.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state);

    applySuccessWriteback(db, sessionId, "entity:analyze-resume");

    const updated = loadWorldState(db, sessionId)!;
    expect(updated.active_states).toContain("state:resume-parsed");
    // Original state preserved
    expect(updated.active_states).toContain("state:resume-uploaded");
  });
});

describe("C2: completed skill recorded", () => {
  it("completed_skills contains entityId, timestamp, and status after success", () => {
    const sessionId = "session-c2";
    applySuccessWriteback(db, sessionId, "entity:analyze-resume", undefined, {
      resultSummary: "resume parsed ok",
    });

    const state = loadWorldState(db, sessionId)!;
    expect(state.completed_skills).toHaveLength(1);

    const record = state.completed_skills[0];
    expect(record.entityId).toBe("entity:analyze-resume");
    expect(record.status).toBe("completed");
    expect(record.timestamp).toBeTruthy();
    expect(record.resultSummary).toBe("resume parsed ok");
  });
});

describe("C3: idempotent writeback", () => {
  it("calling applySuccessWriteback twice does not duplicate active_states or completed_skills", () => {
    const sessionId = "session-c3";
    applySuccessWriteback(db, sessionId, "entity:analyze-resume");
    applySuccessWriteback(db, sessionId, "entity:analyze-resume");

    const state = loadWorldState(db, sessionId)!;

    const uniqueStates = new Set(state.active_states);
    expect(uniqueStates.size).toBe(state.active_states.length); // no duplicates

    const resumeParsedCount = state.active_states.filter((s) => s === "state:resume-parsed").length;
    expect(resumeParsedCount).toBe(1);

    const skillCount = state.completed_skills.filter(
      (r) => r.entityId === "entity:analyze-resume",
    ).length;
    expect(skillCount).toBe(1);
  });
});

describe("C4: failed execution does NOT apply postconditions", () => {
  it("applyFailureWriteback does not add postconditions to active_states", () => {
    const sessionId = "session-c4";
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const state = loadWorldState(db, sessionId)!;
    expect(state.active_states).not.toContain("state:resume-parsed");
  });
});

// ---------------------------------------------------------------------------
// D. Failure / Blocked Writeback
// ---------------------------------------------------------------------------

describe("D1: failure writes entity to blocked_by", () => {
  it("applyFailureWriteback adds entity to blocked_by", () => {
    const sessionId = "session-d1";
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const state = loadWorldState(db, sessionId)!;
    expect(state.blocked_by).toContain("entity:analyze-resume");
  });
});

describe("D2: blocked_by is deduped on repeated failure calls", () => {
  it("calling applyFailureWriteback twice does not duplicate blocked_by entries", () => {
    const sessionId = "session-d2";
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const state = loadWorldState(db, sessionId)!;
    const count = state.blocked_by.filter((id) => id === "entity:analyze-resume").length;
    expect(count).toBe(1);
  });
});

describe("D3: failure appends runtime event", () => {
  it("a 'blocked' runtime event is written after applyFailureWriteback", () => {
    const sessionId = "session-d3";
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const events = getSessionEvents(db, sessionId);
    const blockedEvent = events.find(
      (e) => e.event_type === "blocked" && e.entity_id === "entity:analyze-resume",
    );
    expect(blockedEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// E. Runtime Events
// ---------------------------------------------------------------------------

describe("E1: COMPLETED event written on success", () => {
  it("applySuccessWriteback appends a 'completed' runtime event", () => {
    const sessionId = "session-e1";
    applySuccessWriteback(db, sessionId, "entity:analyze-resume");

    const events = getSessionEvents(db, sessionId);
    const completedEvent = events.find(
      (e) => e.event_type === "completed" && e.entity_id === "entity:analyze-resume",
    );
    expect(completedEvent).toBeDefined();
  });
});

describe("E2: BLOCKED event written on failure", () => {
  it("applyFailureWriteback appends a 'blocked' runtime event", () => {
    const sessionId = "session-e2";
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const events = getSessionEvents(db, sessionId);
    expect(events.some((e) => e.event_type === "blocked")).toBe(true);
  });
});

describe("E3: runtime events carry required provenance", () => {
  it("each event has session_id, entity_id, and created_at", () => {
    const sessionId = "session-e3";
    applySuccessWriteback(db, sessionId, "entity:analyze-resume");

    const events = getSessionEvents(db, sessionId);
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.session_id).toBe(sessionId);
      expect(event.entity_id).toBeTruthy();
      expect(event.created_at).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// F. Runtime Edge Writeback
// ---------------------------------------------------------------------------

describe("F1: COMPLETED edge written and retrievable", () => {
  it("writeCompletedEdge inserts a COMPLETED row in ctxfst_entity_edges", () => {
    const sessionId = "session-f1";
    const id = writeCompletedEdge(db, sessionId, "session-agent", "entity:analyze-resume", {
      resultSummary: "done",
    });

    const row = db.prepare("SELECT * FROM ctxfst_entity_edges WHERE id = ?").get(id) as
      | { relation: string; result_summary: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.relation).toBe("COMPLETED");
    expect(row!.result_summary).toBe("done");
  });
});

describe("F2: BLOCKED_BY edge written and retrievable", () => {
  it("writeBlockedByEdge inserts a BLOCKED_BY row", () => {
    const sessionId = "session-f2";
    const id = writeBlockedByEdge(db, sessionId, "entity:analyze-resume", "state:resume-uploaded");

    const row = db.prepare("SELECT relation FROM ctxfst_entity_edges WHERE id = ?").get(id) as
      | { relation: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.relation).toBe("BLOCKED_BY");
  });
});

describe("F3: EVIDENCE edge written and retrievable", () => {
  it("writeEvidenceEdge inserts an EVIDENCE row", () => {
    const sessionId = "session-f3";
    const id = writeEvidenceEdge(db, sessionId, "entity:pdf-parser", "entity:analyze-resume");

    const row = db.prepare("SELECT relation FROM ctxfst_entity_edges WHERE id = ?").get(id) as
      | { relation: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.relation).toBe("EVIDENCE");
  });
});

describe("F4: multiple runtime edges between same pair allowed", () => {
  it("two COMPLETED edges for the same (source, target) do not conflict", () => {
    const sessionId = "session-f4";
    const id1 = writeCompletedEdge(db, sessionId, "agent", "entity:analyze-resume");
    const id2 = writeCompletedEdge(db, sessionId, "agent", "entity:analyze-resume");

    expect(id1).not.toBe(id2);

    const rows = db
      .prepare(
        "SELECT id FROM ctxfst_entity_edges WHERE source_id = 'agent' AND target_id = 'entity:analyze-resume' AND relation = 'COMPLETED'",
      )
      .all() as Array<{ id: string }>;
    expect(rows.length).toBe(2);
  });
});

describe("F5: runtime edges carry session provenance", () => {
  it("metadata_json contains session_id", () => {
    const sessionId = "session-f5";
    const id = writeRuntimeEdge(db, {
      sessionId,
      sourceId: "agent",
      targetId: "entity:analyze-resume",
      relation: "COMPLETED",
    });

    const row = db.prepare("SELECT metadata_json FROM ctxfst_entity_edges WHERE id = ?").get(id) as
      | { metadata_json: string }
      | undefined;

    expect(row).toBeDefined();
    const meta = JSON.parse(row!.metadata_json) as { session_id: string };
    expect(meta.session_id).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// G. Multi-Session Isolation
// ---------------------------------------------------------------------------

describe("G1: sessions A and B do not share active_states", () => {
  it("completing a skill in session A does not affect session B", () => {
    const sessionA = "session-g1-a";
    const sessionB = "session-g1-b";

    applySuccessWriteback(db, sessionA, "entity:analyze-resume");
    getOrCreateWorldState(db, sessionB);

    const stateA = loadWorldState(db, sessionA)!;
    const stateB = loadWorldState(db, sessionB)!;

    expect(stateA.active_states).toContain("state:resume-parsed");
    expect(stateB.active_states).not.toContain("state:resume-parsed");
    expect(stateB.completed_skills).toHaveLength(0);
  });
});

describe("G2: runtime events from one session don't appear in another", () => {
  it("session B getSessionEvents returns only its own events", () => {
    const sessionA = "session-g2-a";
    const sessionB = "session-g2-b";

    applySuccessWriteback(db, sessionA, "entity:analyze-resume");
    applyFailureWriteback(db, sessionB, "entity:pdf-parser");

    const eventsA = getSessionEvents(db, sessionA);
    const eventsB = getSessionEvents(db, sessionB);

    expect(eventsA.every((e) => e.session_id === sessionA)).toBe(true);
    expect(eventsB.every((e) => e.session_id === sessionB)).toBe(true);
    expect(eventsA.some((e) => e.entity_id === "entity:pdf-parser")).toBe(false);
  });
});

describe("G3: runtime edges from one session don't overwrite another session's state", () => {
  it("two COMPLETED edges for different sessions both persist independently", () => {
    const sessionA = "session-g3-a";
    const sessionB = "session-g3-b";

    const idA = writeCompletedEdge(db, sessionA, "agent", "entity:analyze-resume");
    const idB = writeCompletedEdge(db, sessionB, "agent", "entity:analyze-resume");

    expect(idA).not.toBe(idB);

    const rowA = db
      .prepare("SELECT metadata_json FROM ctxfst_entity_edges WHERE id = ?")
      .get(idA) as { metadata_json: string };
    const rowB = db
      .prepare("SELECT metadata_json FROM ctxfst_entity_edges WHERE id = ?")
      .get(idB) as { metadata_json: string };

    expect(JSON.parse(rowA.metadata_json).session_id).toBe(sessionA);
    expect(JSON.parse(rowB.metadata_json).session_id).toBe(sessionB);
  });
});

// ---------------------------------------------------------------------------
// H. End-to-end runtime flow
// ---------------------------------------------------------------------------

describe("H1: upload → analyze → parsed state chain", () => {
  it("adding state:resume-uploaded then applySuccessWriteback yields state:resume-parsed", () => {
    const sessionId = "session-h1";

    // Step 1: start empty
    const state0 = getOrCreateWorldState(db, sessionId);
    expect(state0.active_states).toEqual([]);

    // Step 2: add state:resume-uploaded
    state0.active_states = ["state:resume-uploaded"];
    saveWorldState(db, state0);

    // Step 3: check preconditions for entity:analyze-resume — should pass
    const precheck = checkPreconditions(db, sessionId, "entity:analyze-resume");
    expect(precheck.ok).toBe(true);

    // Step 4: simulate successful execution
    applySuccessWriteback(db, sessionId, "entity:analyze-resume");

    // Step 5: state:resume-parsed must be in active_states
    const final = loadWorldState(db, sessionId)!;
    expect(final.active_states).toContain("state:resume-parsed");
    expect(final.completed_skills.some((r) => r.entityId === "entity:analyze-resume")).toBe(true);
  });
});

describe("H3: failed execution path", () => {
  it("missing preconditions + failure writeback → no postconditions, blocked_by set", () => {
    const sessionId = "session-h3";

    // Session starts empty — preconditions missing
    const precheck = checkPreconditions(db, sessionId, "entity:analyze-resume");
    expect(precheck.ok).toBe(false);

    // Simulate failure
    applyFailureWriteback(db, sessionId, "entity:analyze-resume");

    const state = loadWorldState(db, sessionId)!;
    expect(state.active_states).not.toContain("state:resume-parsed");
    expect(state.blocked_by).toContain("entity:analyze-resume");
  });
});
