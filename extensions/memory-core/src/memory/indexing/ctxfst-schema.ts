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
  // Unique constraint for static/inferred edges to support safe upsert
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ctxfst_edges_static
      ON ctxfst_entity_edges(source_id, target_id, relation, document_id);
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_edges_source ON ctxfst_entity_edges(source_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ctxfst_edges_doc ON ctxfst_entity_edges(document_id);`);
}
