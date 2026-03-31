// CtxFST cross-reference and schema validation
// Runs after parsing, before canonicalization

import {
  ENTITY_TYPES,
  PRIORITIES,
  type CtxfstDocument,
  type ValidationIssue,
  type ValidationResult,
} from "./types.js";

/**
 * Validate a parsed CtxfstDocument for cross-reference integrity,
 * enum correctness, and uniqueness constraints.
 *
 * Returns fatal errors and non-fatal warnings separately.
 */
export function validateCtxfstDocument(doc: CtxfstDocument): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // --- Rule 1: Entity ID uniqueness ---
  const entityIds = new Set<string>();
  for (const entity of doc.entities) {
    if (entityIds.has(entity.id)) {
      errors.push({
        severity: "error",
        code: "DUPLICATE_ENTITY_ID",
        message: `Duplicate entity ID: "${entity.id}"`,
        path: `entities[${entity.id}]`,
      });
    }
    entityIds.add(entity.id);
  }

  // --- Rule 2: Chunk ID uniqueness ---
  const chunkIds = new Set<string>();
  for (const chunk of doc.chunks) {
    if (chunkIds.has(chunk.id)) {
      errors.push({
        severity: "error",
        code: "DUPLICATE_CHUNK_ID",
        message: `Duplicate chunk ID: "${chunk.id}"`,
        path: `chunks[${chunk.id}]`,
      });
    }
    chunkIds.add(chunk.id);
  }

  // --- Rule 3: Chunk body mapping ---
  // Every frontmatter chunk must have body content
  for (const chunk of doc.chunks) {
    if (!chunk.content) {
      errors.push({
        severity: "error",
        code: "MISSING_CHUNK_BODY",
        message: `Chunk "${chunk.id}" declared in frontmatter has no matching <Chunk id="${chunk.id}"> body`,
        path: `chunks[${chunk.id}].content`,
      });
    }
  }

  // --- Rule 4: Entity reference integrity ---
  // chunks[].entities[*] must exist in entities[].id
  for (const chunk of doc.chunks) {
    for (const entityRef of chunk.entities) {
      if (!entityIds.has(entityRef)) {
        errors.push({
          severity: "error",
          code: "MISSING_ENTITY_REFERENCE",
          message: `Chunk "${chunk.id}" references entity "${entityRef}" which does not exist`,
          path: `chunks[${chunk.id}].entities`,
        });
      }
    }
  }

  // --- Rule 5: State reference integrity ---
  // chunks[].stateRefs[*] should exist in entities[].id
  const entityTypeMap = new Map(doc.entities.map((e) => [e.id, e.type]));
  for (const chunk of doc.chunks) {
    for (const stateRef of chunk.stateRefs) {
      if (!entityIds.has(stateRef)) {
        warnings.push({
          severity: "warning",
          code: "MISSING_STATE_REF",
          message: `Chunk "${chunk.id}" state_ref "${stateRef}" does not match any entity ID`,
          path: `chunks[${chunk.id}].state_refs`,
        });
      } else if (entityTypeMap.get(stateRef) !== "state") {
        warnings.push({
          severity: "warning",
          code: "STATE_REF_NOT_STATE_TYPE",
          message: `Chunk "${chunk.id}" state_ref "${stateRef}" points to entity of type "${entityTypeMap.get(stateRef)}", expected "state"`,
          path: `chunks[${chunk.id}].state_refs`,
        });
      }
    }
  }

  // --- Rule 6: Enum validation ---
  const validTypes = new Set<string>(ENTITY_TYPES);
  const validPriorities = new Set<string>(PRIORITIES);

  for (const entity of doc.entities) {
    if (!validTypes.has(entity.type)) {
      errors.push({
        severity: "error",
        code: "INVALID_ENTITY_TYPE",
        message: `Entity "${entity.id}" has invalid type "${entity.type}". Valid types: ${ENTITY_TYPES.join(", ")}`,
        path: `entities[${entity.id}].type`,
      });
    }
  }

  for (const chunk of doc.chunks) {
    if (!validPriorities.has(chunk.priority)) {
      errors.push({
        severity: "error",
        code: "INVALID_PRIORITY",
        message: `Chunk "${chunk.id}" has invalid priority "${chunk.priority}". Valid: ${PRIORITIES.join(", ")}`,
        path: `chunks[${chunk.id}].priority`,
      });
    }
  }

  // --- Non-fatal: empty entity fields ---
  for (const entity of doc.entities) {
    if (!entity.id) {
      errors.push({
        severity: "error",
        code: "EMPTY_ENTITY_ID",
        message: "Entity has an empty ID",
        path: "entities",
      });
    }
    if (!entity.name) {
      warnings.push({
        severity: "warning",
        code: "EMPTY_ENTITY_NAME",
        message: `Entity "${entity.id}" has an empty name`,
        path: `entities[${entity.id}].name`,
      });
    }
  }

  for (const chunk of doc.chunks) {
    if (!chunk.id) {
      errors.push({
        severity: "error",
        code: "EMPTY_CHUNK_ID",
        message: "Chunk has an empty ID",
        path: "chunks",
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check for extra body <Chunk> tags that have no frontmatter declaration.
 * Call this with the set of frontmatter chunk IDs and the set of body chunk IDs.
 */
export function validateChunkBodyMapping(
  frontmatterChunkIds: Set<string>,
  bodyChunkIds: Set<string>,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];

  // Body chunks not declared in frontmatter
  for (const bodyId of bodyChunkIds) {
    if (!frontmatterChunkIds.has(bodyId)) {
      errors.push({
        severity: "error",
        code: "UNDECLARED_BODY_CHUNK",
        message: `<Chunk id="${bodyId}"> exists in body but is not declared in frontmatter chunks`,
        path: `body.chunks[${bodyId}]`,
      });
    }
  }

  return errors;
}
