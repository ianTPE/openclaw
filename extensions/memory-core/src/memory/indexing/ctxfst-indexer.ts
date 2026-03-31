import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CtxfstDocument } from "../formats/ctxfst/types.js";
import { ensureCtxfstSchema } from "./ctxfst-schema.js";

/**
 * Index a canonical CtxfstDocument into the database.
 *
 * - If the document already exists with the same source_hash, indexing is skipped.
 * - Otherwise, old records are deleted and new ones are written atomically
 *   within a single SQLite transaction.
 * - Static edges (REQUIRES / LEADS_TO) are auto-inferred from entity
 *   preconditions and postconditions.
 *
 * Returns { skipped: true } when the source was unchanged.
 */
export function indexCtxfstDocument(db: DatabaseSync, doc: CtxfstDocument): { skipped: boolean } {
  ensureCtxfstSchema(db);

  // Check whether this document is already indexed with the same hash.
  const existing = db
    .prepare("SELECT source_hash FROM ctxfst_documents WHERE id = ?")
    .get(doc.id) as { source_hash: string } | undefined;

  if (existing?.source_hash === doc.source_hash) {
    return { skipped: true };
  }

  const now = Date.now();

  // Atomic transaction: delete stale records, write fresh ones.
  db.exec("BEGIN");
  try {
    // 1. Remove old static edges for this document
    db.prepare("DELETE FROM ctxfst_entity_edges WHERE document_id = ? AND status = 'active'").run(
      doc.id,
    );

    // 2. Remove old chunk-entity mappings for this document
    db.prepare("DELETE FROM ctxfst_chunk_entities WHERE document_id = ?").run(doc.id);

    // 3. Remove old entities for this document
    db.prepare("DELETE FROM ctxfst_entities WHERE document_id = ?").run(doc.id);

    // 4. Upsert document record
    db.prepare(`
      INSERT INTO ctxfst_documents
        (id, source_path, title, format, source_hash, document_version, ingested_at, updated_at, metadata_json)
      VALUES (?, ?, ?, 'ctxfst', ?, ?, ?, ?, '{}')
      ON CONFLICT(id) DO UPDATE SET
        source_path      = excluded.source_path,
        title            = excluded.title,
        source_hash      = excluded.source_hash,
        document_version = excluded.document_version,
        updated_at       = excluded.updated_at
    `).run(doc.id, doc.source_path, doc.title, doc.source_hash, doc.document_version, now, now);

    // 5. Insert entities
    const insertEntity = db.prepare(`
      INSERT INTO ctxfst_entities
        (id, document_id, name, type, aliases_json, preconditions_json, postconditions_json, related_skills_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `);
    for (const entity of doc.entities) {
      insertEntity.run(
        entity.id,
        doc.id,
        entity.name,
        entity.type,
        JSON.stringify(entity.aliases),
        JSON.stringify(entity.preconditions),
        JSON.stringify(entity.postconditions),
        JSON.stringify(entity.relatedSkills),
      );
    }

    // 6. Insert chunk-entity mappings
    const insertMapping = db.prepare(`
      INSERT INTO ctxfst_chunk_entities (chunk_id, entity_id, document_id) VALUES (?, ?, ?)
    `);
    for (const chunk of doc.chunks) {
      for (const entityId of chunk.entities) {
        insertMapping.run(chunk.id, entityId, doc.id);
      }
    }

    // 7. Auto-infer static edges from preconditions (REQUIRES) and postconditions (LEADS_TO)
    const insertEdge = db.prepare(`
      INSERT INTO ctxfst_entity_edges
        (id, source_id, target_id, relation, document_id, source_hash, score, confidence, timestamp, status)
      VALUES (?, ?, ?, ?, ?, ?, 1.0, 1.0, ?, 'active')
      ON CONFLICT(source_id, target_id, relation, document_id) DO UPDATE SET
        source_hash = excluded.source_hash,
        timestamp   = excluded.timestamp
    `);
    for (const entity of doc.entities) {
      for (const pre of entity.preconditions) {
        insertEdge.run(randomUUID(), entity.id, pre, "REQUIRES", doc.id, doc.source_hash, now);
      }
      for (const post of entity.postconditions) {
        insertEdge.run(randomUUID(), entity.id, post, "LEADS_TO", doc.id, doc.source_hash, now);
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { skipped: false };
}
