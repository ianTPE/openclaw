import type { DatabaseSync } from "node:sqlite";
import type { EntityLookupResult, EntityMatch } from "../formats/ctxfst/types.js";

interface EntityRow {
  id: string;
  document_id: string;
  name: string;
  aliases_json: string;
}

/**
 * Look up entities by query string.
 * Tries exact name match first, then alias match (both case-insensitive).
 * Returns all matches across all indexed documents.
 */
export function findEntitiesByQuery(db: DatabaseSync, query: string): EntityMatch[] {
  const q = query.trim();
  if (!q) {
    return [];
  }

  // 1. Exact name match (case-insensitive)
  const exactRows = db
    .prepare(
      `SELECT id, document_id, name, aliases_json
       FROM ctxfst_entities
       WHERE LOWER(name) = LOWER(?)`,
    )
    .all(q) as EntityRow[];

  if (exactRows.length > 0) {
    return exactRows.map((row) => ({
      entity_id: row.id,
      name: row.name,
      match_type: "exact" as const,
      document_id: row.document_id,
    }));
  }

  // 2. Alias match (case-insensitive) using json_each
  const aliasRows = db
    .prepare(
      `SELECT e.id, e.document_id, e.name, e.aliases_json
       FROM ctxfst_entities e, json_each(e.aliases_json) alias
       WHERE LOWER(alias.value) = LOWER(?)`,
    )
    .all(q) as EntityRow[];

  if (aliasRows.length > 0) {
    // Deduplicate by (id, document_id) — json_each can yield multiple rows per entity
    const seen = new Set<string>();
    const results: EntityMatch[] = [];
    for (const row of aliasRows) {
      const key = `${row.id}|${row.document_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          entity_id: row.id,
          name: row.name,
          match_type: "alias" as const,
          document_id: row.document_id,
        });
      }
    }
    return results;
  }

  return [];
}

/**
 * Return all chunk IDs associated with the given entity.
 */
export function getChunksForEntity(db: DatabaseSync, entityId: string): string[] {
  const rows = db
    .prepare("SELECT chunk_id FROM ctxfst_chunk_entities WHERE entity_id = ?")
    .all(entityId) as Array<{ chunk_id: string }>;
  return rows.map((r) => r.chunk_id);
}

/**
 * High-level entity lookup: find entity and resolve reverse chunks.
 */
export function entityLookup(db: DatabaseSync, query: string): EntityLookupResult {
  const matches = findEntitiesByQuery(db, query);
  if (matches.length === 0) {
    return { query, matched_entity: null, match_type: null, reverse_chunks: [] };
  }
  // Return first match (best: exact before alias, as returned by findEntitiesByQuery)
  const best = matches[0];
  const chunks = getChunksForEntity(db, best.entity_id);
  return {
    query,
    matched_entity: best.entity_id,
    match_type: best.match_type,
    reverse_chunks: chunks,
  };
}
