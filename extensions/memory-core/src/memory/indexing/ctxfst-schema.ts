import type { DatabaseSync } from "node:sqlite";

/**
 * Ensure all CtxFST Phase 2 tables exist in the given SQLite database.
 * Safe to call multiple times (CREATE TABLE IF NOT EXISTS).
 */
export function ensureCtxfstSchema(db: DatabaseSync): void {
  // Document registry with source hash for incremental reindex
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_documents (
      id               TEXT PRIMARY KEY,
      source_path      TEXT NOT NULL,
      title            TEXT NOT NULL DEFAULT '',
      format           TEXT NOT NULL DEFAULT 'ctxfst',
      source_hash      TEXT NOT NULL,
      document_version TEXT NOT NULL DEFAULT '',
      ingested_at      INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      metadata_json    TEXT NOT NULL DEFAULT '{}'
    );
  `);

  // Entity catalog per document
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_entities (
      id                  TEXT NOT NULL,
      document_id         TEXT NOT NULL,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL DEFAULT 'concept',
      aliases_json        TEXT NOT NULL DEFAULT '[]',
      preconditions_json  TEXT NOT NULL DEFAULT '[]',
      postconditions_json TEXT NOT NULL DEFAULT '[]',
      related_skills_json TEXT NOT NULL DEFAULT '[]',
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id, document_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_entities_name ON ctxfst_entities(LOWER(name));`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_entities_doc ON ctxfst_entities(document_id);`);

  // Chunk → entity mapping (allows entity → chunk reverse lookup)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_chunk_entities (
      chunk_id    TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      document_id TEXT NOT NULL,
      PRIMARY KEY (chunk_id, entity_id, document_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_ce_entity ON ctxfst_chunk_entities(entity_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_ce_doc ON ctxfst_chunk_entities(document_id);`);

  // Entity edges — static edges auto-inferred from preconditions/postconditions,
  // and runtime edges written back during execution (Phase 6).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_entity_edges (
      id             TEXT NOT NULL,
      source_id      TEXT NOT NULL,
      target_id      TEXT NOT NULL,
      relation       TEXT NOT NULL,
      document_id    TEXT NOT NULL DEFAULT '',
      source_hash    TEXT NOT NULL DEFAULT '',
      score          REAL NOT NULL DEFAULT 1.0,
      confidence     REAL NOT NULL DEFAULT 1.0,
      timestamp      INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      result_summary TEXT NOT NULL DEFAULT '',
      metadata_json  TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id)
    );
  `);
  // Unique constraint for static/inferred edges.
  // Runtime edges avoid conflicts by using the edge UUID as their document_id,
  // so (source_id, target_id, relation, document_id=uuid) is always unique per runtime event.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ctxfst_edges_static
      ON ctxfst_entity_edges(source_id, target_id, relation, document_id);
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_edges_source ON ctxfst_entity_edges(source_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_edges_doc ON ctxfst_entity_edges(document_id);`);

  // ── Phase 6: Runtime State ─────────────────────────────────────────────────

  // Session-scoped world state (one row per session).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_world_states (
      session_id            TEXT PRIMARY KEY,
      goal_entity_id        TEXT,
      active_states_json    TEXT NOT NULL DEFAULT '[]',
      completed_skills_json TEXT NOT NULL DEFAULT '[]',
      blocked_by_json       TEXT NOT NULL DEFAULT '[]',
      updated_at            INTEGER NOT NULL
    );
  `);

  // Append-only runtime event log (one row per event; no uniqueness constraint).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctxfst_runtime_events (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      event_type        TEXT NOT NULL,
      entity_id         TEXT NOT NULL,
      related_entity_id TEXT,
      payload_json      TEXT NOT NULL DEFAULT '{}',
      created_at        INTEGER NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_ctxfst_events_session ON ctxfst_runtime_events(session_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_ctxfst_events_entity ON ctxfst_runtime_events(entity_id);`,
  );
}
