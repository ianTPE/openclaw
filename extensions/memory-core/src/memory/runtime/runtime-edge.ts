import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ensureCtxfstSchema } from "../indexing/ctxfst-schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Runtime edge relation types (Phase 6). */
export type RuntimeEdgeRelation = "COMPLETED" | "BLOCKED_BY" | "EVIDENCE";

export interface RuntimeEdgeOptions {
  /** Session that produced this event (stored in metadata_json for provenance). */
  sessionId: string;
  sourceId: string;
  targetId: string;
  relation: RuntimeEdgeRelation;
  score?: number;
  confidence?: number;
  resultSummary?: string;
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * Write a runtime edge to ctxfst_entity_edges.
 *
 * Runtime edges differ from static/inferred edges in two ways:
 * - document_id is always '' (empty string), exempt from the static unique index.
 * - Each call creates a new row with a fresh UUID — runtime events are never
 *   de-duplicated, because the same pair of nodes may produce multiple events
 *   across sessions or at different timestamps.
 *
 * Session provenance is stored in metadata_json as { session_id }.
 *
 * Returns the generated edge ID.
 */
export function writeRuntimeEdge(db: DatabaseSync, opts: RuntimeEdgeOptions): string {
  ensureCtxfstSchema(db);

  const id = randomUUID();

  // Use the edge UUID as document_id so that the static unique index
  // (source_id, target_id, relation, document_id) never conflicts between
  // separate runtime events — each event gets its own UUID document_id.
  // The 'runtime' status ensures reindex cleanup (which filters by real doc.id
  // and status='active') never touches these rows.
  db.prepare(`
    INSERT INTO ctxfst_entity_edges
      (id, source_id, target_id, relation, document_id, source_hash,
       score, confidence, timestamp, status, result_summary, metadata_json)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'runtime', ?, ?)
  `).run(
    id,
    opts.sourceId,
    opts.targetId,
    opts.relation,
    id, // document_id = edge UUID → always unique per runtime event
    opts.score ?? 1.0,
    opts.confidence ?? 1.0,
    Date.now(),
    opts.resultSummary ?? "",
    JSON.stringify({ session_id: opts.sessionId }),
  );

  return id;
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * Write a COMPLETED runtime edge (e.g. actor/session completed target entity).
 */
export function writeCompletedEdge(
  db: DatabaseSync,
  sessionId: string,
  sourceId: string,
  targetId: string,
  opts?: Pick<RuntimeEdgeOptions, "score" | "confidence" | "resultSummary">,
): string {
  return writeRuntimeEdge(db, { sessionId, sourceId, targetId, relation: "COMPLETED", ...opts });
}

/**
 * Write a BLOCKED_BY runtime edge (source is currently blocked by target).
 */
export function writeBlockedByEdge(
  db: DatabaseSync,
  sessionId: string,
  sourceId: string,
  targetId: string,
  opts?: Pick<RuntimeEdgeOptions, "score" | "confidence" | "resultSummary">,
): string {
  return writeRuntimeEdge(db, { sessionId, sourceId, targetId, relation: "BLOCKED_BY", ...opts });
}

/**
 * Write an EVIDENCE runtime edge (source supports or evidences target).
 */
export function writeEvidenceEdge(
  db: DatabaseSync,
  sessionId: string,
  sourceId: string,
  targetId: string,
  opts?: Pick<RuntimeEdgeOptions, "score" | "confidence" | "resultSummary">,
): string {
  return writeRuntimeEdge(db, { sessionId, sourceId, targetId, relation: "EVIDENCE", ...opts });
}
