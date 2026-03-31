// CtxFST canonicalization: normalize IDs, dedupe arrays, inject defaults
// Runs after parsing, can run before or after validation

import type { ChunkRecord, CtxfstDocument, EntityRecord, EntityType, Priority } from "./types.js";
import { ENTITY_TYPES, PRIORITIES } from "./types.js";

/**
 * Normalize an entity/chunk ID to lowercase kebab-case.
 * Strips leading/trailing whitespace, replaces underscores and spaces with hyphens,
 * collapses multiple hyphens, lowercases everything.
 *
 * This is the most critical normalization — prevents ghost nodes from ID drift.
 */
export function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-") // underscores and spaces -> hyphens
    .replace(/[^a-z0-9:-]/g, "-") // non-alphanumeric (except : and -) -> hyphens
    .replace(/-{2,}/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Deduplicate a string array, preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Trim all strings in an array and remove empties.
 */
function cleanStringArray(arr: string[]): string[] {
  return arr.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Normalize an entity type string. Returns the canonical type or the original
 * lowercased string if not in the valid set (validator will catch it).
 */
function normalizeEntityType(raw: string): EntityType {
  const lower = raw.trim().toLowerCase();
  if ((ENTITY_TYPES as readonly string[]).includes(lower)) {
    return lower as EntityType;
  }
  return lower as EntityType;
}

/**
 * Normalize a priority string.
 */
function normalizePriority(raw: string): Priority {
  const lower = raw.trim().toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(lower)) {
    return lower as Priority;
  }
  return lower as Priority;
}

/**
 * Canonicalize a single entity record.
 */
function canonicalizeEntity(entity: EntityRecord): EntityRecord {
  return {
    ...entity,
    id: normalizeId(entity.id),
    name: entity.name.trim(),
    type: normalizeEntityType(entity.type),
    aliases: dedup(cleanStringArray(entity.aliases)),
    preconditions: dedup(cleanStringArray(entity.preconditions).map(normalizeId)),
    postconditions: dedup(cleanStringArray(entity.postconditions).map(normalizeId)),
    relatedSkills: dedup(cleanStringArray(entity.relatedSkills)),
  };
}

/**
 * Canonicalize a single chunk record.
 */
function canonicalizeChunk(chunk: ChunkRecord): ChunkRecord {
  return {
    ...chunk,
    id: normalizeId(chunk.id),
    context: chunk.context.trim(),
    tags: dedup(cleanStringArray(chunk.tags)),
    entities: dedup(cleanStringArray(chunk.entities).map(normalizeId)),
    stateRefs: dedup(cleanStringArray(chunk.stateRefs).map(normalizeId)),
    priority: normalizePriority(chunk.priority),
    dependencies: dedup(cleanStringArray(chunk.dependencies).map(normalizeId)),
  };
}

/**
 * Canonicalize an entire CtxfstDocument.
 * - Normalizes all IDs to lowercase kebab-case
 * - Deduplicates aliases, tags, arrays
 * - Trims whitespace
 * - Injects default values for missing optional fields
 */
export function canonicalizeCtxfstDocument(doc: CtxfstDocument): CtxfstDocument {
  return {
    document: {
      ...doc.document,
      title: doc.document.title.trim(),
      documentVersion: doc.document.documentVersion.trim() || "1.0",
    },
    entities: doc.entities.map(canonicalizeEntity),
    chunks: doc.chunks.map(canonicalizeChunk),
  };
}
