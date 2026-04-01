import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ensureCtxfstSchema } from "../indexing/ctxfst-schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompletedSkillRecord {
  entityId: string;
  /** ISO-8601 timestamp of the successful execution. */
  timestamp: string;
  status: "completed" | "failed";
  resultSummary?: string;
}

/** Session-scoped world state persisted in ctxfst_world_states. */
export interface WorldState {
  session_id: string;
  goal_entity_id: string | null;
  /** Entity IDs of states currently active in this session. */
  active_states: string[];
  /** Skills that have been successfully executed in this session. */
  completed_skills: CompletedSkillRecord[];
  /** Entity IDs that are currently blocking progress. */
  blocked_by: string[];
  updated_at: number;
}

export interface PreconditionCheckResult {
  ok: boolean;
  /** Entity IDs of preconditions not yet present in active_states. */
  missing: string[];
}

// ── Read / Write ──────────────────────────────────────────────────────────────

/**
 * Load the world state for a session. Returns null if no state exists yet.
 */
export function loadWorldState(db: DatabaseSync, sessionId: string): WorldState | null {
  ensureCtxfstSchema(db);
  const row = db.prepare("SELECT * FROM ctxfst_world_states WHERE session_id = ?").get(sessionId) as
    | WorldStateRow
    | undefined;
  return row ? rowToWorldState(row) : null;
}

/**
 * Load the world state for a session, creating an empty one if it doesn't exist.
 */
export function getOrCreateWorldState(
  db: DatabaseSync,
  sessionId: string,
  goalEntityId?: string,
): WorldState {
  ensureCtxfstSchema(db);
  const existing = loadWorldState(db, sessionId);
  if (existing) return existing;

  const state: WorldState = {
    session_id: sessionId,
    goal_entity_id: goalEntityId ?? null,
    active_states: [],
    completed_skills: [],
    blocked_by: [],
    updated_at: Date.now(),
  };
  saveWorldState(db, state);
  return state;
}

/**
 * Persist a world state to the database (upsert by session_id).
 */
export function saveWorldState(db: DatabaseSync, state: WorldState): void {
  ensureCtxfstSchema(db);
  db.prepare(`
    INSERT INTO ctxfst_world_states
      (session_id, goal_entity_id, active_states_json, completed_skills_json, blocked_by_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      goal_entity_id        = excluded.goal_entity_id,
      active_states_json    = excluded.active_states_json,
      completed_skills_json = excluded.completed_skills_json,
      blocked_by_json       = excluded.blocked_by_json,
      updated_at            = excluded.updated_at
  `).run(
    state.session_id,
    state.goal_entity_id ?? null,
    JSON.stringify(state.active_states),
    JSON.stringify(state.completed_skills),
    JSON.stringify(state.blocked_by),
    Date.now(),
  );
}

// ── Precondition Checker (Task 6.3) ───────────────────────────────────────────

/**
 * Check whether the preconditions of an entity are satisfied in the given session.
 *
 * @param db          Open SQLite database.
 * @param sessionId   Target session.
 * @param entityId    Entity whose preconditions are evaluated.
 * @param documentId  If provided, restrict entity lookup to this document.
 *                    Otherwise the first matching entity across all documents is used.
 *
 * Returns { ok: true } when all preconditions are in active_states,
 * or { ok: false, missing: [...] } listing every missing state ID.
 */
export function checkPreconditions(
  db: DatabaseSync,
  sessionId: string,
  entityId: string,
  documentId?: string,
): PreconditionCheckResult {
  ensureCtxfstSchema(db);

  const preconditions = getEntityField<string[]>(db, entityId, "preconditions_json", documentId);
  if (preconditions.length === 0) {
    return { ok: true, missing: [] };
  }

  const state = loadWorldState(db, sessionId);
  const activeSet = new Set(state?.active_states ?? []);
  const missing = preconditions.filter((p) => !activeSet.has(p));

  return { ok: missing.length === 0, missing };
}

// ── Postcondition Writeback (Task 6.4) ────────────────────────────────────────

/**
 * Apply successful execution writeback for a given entity in a session:
 * - Merges entity's postconditions into active_states (deduped).
 * - Records a CompletedSkillRecord (idempotent by entityId).
 * - Appends a "completed" runtime event.
 *
 * Does NOT modify blocked_by.
 */
export function applySuccessWriteback(
  db: DatabaseSync,
  sessionId: string,
  entityId: string,
  documentId?: string,
  opts?: { resultSummary?: string },
): void {
  ensureCtxfstSchema(db);
  const state = getOrCreateWorldState(db, sessionId);

  // Merge postconditions → active_states (deduped)
  const postconditions = getEntityField<string[]>(db, entityId, "postconditions_json", documentId);
  const activeSet = new Set(state.active_states);
  for (const post of postconditions) {
    activeSet.add(post);
  }
  state.active_states = Array.from(activeSet);

  // Record completed skill (idempotent: skip if already present)
  if (!state.completed_skills.some((r) => r.entityId === entityId)) {
    state.completed_skills.push({
      entityId,
      timestamp: new Date().toISOString(),
      status: "completed",
      ...(opts?.resultSummary !== undefined ? { resultSummary: opts.resultSummary } : {}),
    });
  }

  saveWorldState(db, state);
  appendRuntimeEvent(db, sessionId, "completed", entityId);
}

/**
 * Apply failure writeback for a given entity in a session:
 * - Adds entity to blocked_by (deduped).
 * - Does NOT apply postconditions.
 * - Appends a "blocked" runtime event.
 */
export function applyFailureWriteback(db: DatabaseSync, sessionId: string, entityId: string): void {
  ensureCtxfstSchema(db);
  const state = getOrCreateWorldState(db, sessionId);

  const blockedSet = new Set(state.blocked_by);
  blockedSet.add(entityId);
  state.blocked_by = Array.from(blockedSet);

  saveWorldState(db, state);
  appendRuntimeEvent(db, sessionId, "blocked", entityId);
}

// ── Runtime Event Log ─────────────────────────────────────────────────────────

export interface RuntimeEvent {
  id: string;
  session_id: string;
  event_type: string;
  entity_id: string;
  related_entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: number;
}

/**
 * Return all runtime events for a session, oldest first.
 */
export function getSessionEvents(db: DatabaseSync, sessionId: string): RuntimeEvent[] {
  ensureCtxfstSchema(db);
  const rows = db
    .prepare("SELECT * FROM ctxfst_runtime_events WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as RuntimeEventRow[];
  return rows.map(rowToRuntimeEvent);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface WorldStateRow {
  session_id: string;
  goal_entity_id: string | null;
  active_states_json: string;
  completed_skills_json: string;
  blocked_by_json: string;
  updated_at: number;
}

interface RuntimeEventRow {
  id: string;
  session_id: string;
  event_type: string;
  entity_id: string;
  related_entity_id: string | null;
  payload_json: string;
  created_at: number;
}

function rowToWorldState(row: WorldStateRow): WorldState {
  return {
    session_id: row.session_id,
    goal_entity_id: row.goal_entity_id,
    active_states: JSON.parse(row.active_states_json) as string[],
    completed_skills: JSON.parse(row.completed_skills_json) as CompletedSkillRecord[],
    blocked_by: JSON.parse(row.blocked_by_json) as string[],
    updated_at: row.updated_at,
  };
}

function rowToRuntimeEvent(row: RuntimeEventRow): RuntimeEvent {
  return {
    id: row.id,
    session_id: row.session_id,
    event_type: row.event_type,
    entity_id: row.entity_id,
    related_entity_id: row.related_entity_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

/** Fetch a JSON-encoded array field from ctxfst_entities, parsed as T. Returns [] if not found. */
function getEntityField<T>(
  db: DatabaseSync,
  entityId: string,
  column: "preconditions_json" | "postconditions_json",
  documentId?: string,
): T {
  const row = documentId
    ? (db
        .prepare(`SELECT ${column} FROM ctxfst_entities WHERE id = ? AND document_id = ? LIMIT 1`)
        .get(entityId, documentId) as Record<string, string> | undefined)
    : (db.prepare(`SELECT ${column} FROM ctxfst_entities WHERE id = ? LIMIT 1`).get(entityId) as
        | Record<string, string>
        | undefined);

  if (!row) return [] as unknown as T;
  return JSON.parse(row[column]) as T;
}

function appendRuntimeEvent(
  db: DatabaseSync,
  sessionId: string,
  eventType: string,
  entityId: string,
  relatedEntityId?: string,
  payload?: Record<string, unknown>,
): void {
  db.prepare(`
    INSERT INTO ctxfst_runtime_events
      (id, session_id, event_type, entity_id, related_entity_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    sessionId,
    eventType,
    entityId,
    relatedEntityId ?? null,
    JSON.stringify(payload ?? {}),
    Date.now(),
  );
}
