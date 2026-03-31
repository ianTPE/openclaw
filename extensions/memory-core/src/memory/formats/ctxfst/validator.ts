import type { CtxfstDocument, ValidationIssue, ValidationResult } from "./types.js";

/**
 * Validate cross-references and structural constraints in a parsed CtxfstDocument.
 * Returns ok=false when any error-severity issue is found.
 */
export function validateCtxfstDocument(doc: CtxfstDocument): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Duplicate entity IDs
  const entityIds = new Set<string>();
  for (const entity of doc.entities) {
    if (entityIds.has(entity.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_ENTITY_ID",
        message: `Duplicate entity ID: ${entity.id}`,
      });
    }
    entityIds.add(entity.id);
  }

  // Duplicate chunk IDs
  const chunkIds = new Set<string>();
  for (const chunk of doc.chunks) {
    if (chunkIds.has(chunk.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_CHUNK_ID",
        message: `Duplicate chunk ID: ${chunk.id}`,
      });
    }
    chunkIds.add(chunk.id);
  }

  // Missing entity references from chunks
  for (const chunk of doc.chunks) {
    for (const entityId of chunk.entities) {
      if (!entityIds.has(entityId)) {
        issues.push({
          severity: "error",
          code: "MISSING_ENTITY_REF",
          message: `Chunk '${chunk.id}' references unknown entity: ${entityId}`,
        });
      }
    }
    // Also check state_refs against entity IDs
    for (const stateRef of chunk.state_refs) {
      if (!entityIds.has(stateRef)) {
        issues.push({
          severity: "warning",
          code: "MISSING_STATE_REF",
          message: `Chunk '${chunk.id}' state_ref references unknown entity: ${stateRef}`,
        });
      }
    }
  }

  // Chunk frontmatter/body mismatch: every chunk must have non-empty content
  for (const chunk of doc.chunks) {
    if (!chunk.content) {
      issues.push({
        severity: "error",
        code: "MISSING_CHUNK_BODY",
        message: `Chunk '${chunk.id}' declared in frontmatter but has no matching <Chunk> body`,
      });
    }
  }

  const ok = issues.every((i) => i.severity !== "error");
  return { ok, issues };
}
