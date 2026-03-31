// CtxFST format support — public API for Phase 1: Parser MVP

export { isCtxfstPath, looksLikeCtxfstDocument } from "./detector.js";
export {
  parseCtxfstDocument,
  extractChunkBodies,
  splitFrontmatterAndBody,
  FatalParseError,
} from "./parser.js";
export { validateCtxfstDocument, validateChunkBodyMapping } from "./validator.js";
export { canonicalizeCtxfstDocument, normalizeId } from "./canonicalize.js";
export type {
  CtxfstDocument,
  DocumentRecord,
  EntityRecord,
  ChunkRecord,
  EntityType,
  Priority,
  RelationType,
  ValidationIssue,
  ValidationResult,
  ParseResult,
  ParseError,
  ParseOutcome,
} from "./types.js";
export { ENTITY_TYPES, PRIORITIES, RELATION_TYPES } from "./types.js";

import { canonicalizeCtxfstDocument } from "./canonicalize.js";
import { parseCtxfstDocument, extractChunkBodies, FatalParseError } from "./parser.js";
import type { ParseOutcome, ValidationIssue } from "./types.js";
import { validateCtxfstDocument, validateChunkBodyMapping } from "./validator.js";

/**
 * Full pipeline: parse + validate body mapping + validate cross-refs + canonicalize.
 * Returns a ParseOutcome (either ok with the document, or error with issues).
 */
export async function ingestCtxfstSource(
  source: string,
  sourcePath: string,
): Promise<ParseOutcome> {
  // Step 1: Parse
  let parseResult;
  try {
    parseResult = await parseCtxfstDocument(source, sourcePath);
  } catch (err) {
    if (err instanceof FatalParseError) {
      return {
        ok: false,
        errors: [
          {
            severity: "error",
            code: "FATAL_PARSE_ERROR",
            message: err.message,
          },
        ],
      };
    }
    throw err;
  }

  const { document: rawDoc, unknownKeys } = parseResult;

  // Step 2: Validate body/frontmatter chunk mapping
  const frontmatterChunkIds = new Set(rawDoc.chunks.map((c) => c.id));
  let bodyChunkIds: Set<string>;
  try {
    const { body } = (await import("./parser.js")).splitFrontmatterAndBody(source);
    const bodies = extractChunkBodies(body);
    bodyChunkIds = new Set(bodies.keys());
  } catch (err) {
    if (err instanceof FatalParseError) {
      return {
        ok: false,
        errors: [
          {
            severity: "error",
            code: "FATAL_PARSE_ERROR",
            message: err.message,
          },
        ],
      };
    }
    throw err;
  }

  const bodyMappingErrors = validateChunkBodyMapping(frontmatterChunkIds, bodyChunkIds);

  // Step 3: Canonicalize (before validation so IDs are normalized)
  const canonDoc = canonicalizeCtxfstDocument(rawDoc);

  // Step 4: Validate cross-references
  const validation = validateCtxfstDocument(canonDoc);

  // Merge body mapping errors into validation
  const allErrors: ValidationIssue[] = [...bodyMappingErrors, ...validation.errors];
  const allWarnings: ValidationIssue[] = [...validation.warnings];

  // Add unknown key warnings
  for (const key of unknownKeys) {
    allWarnings.push({
      severity: "warning",
      code: "UNKNOWN_TOP_LEVEL_KEY",
      message: `Unknown top-level frontmatter key: "${key}"`,
      path: key,
    });
  }

  if (allErrors.length > 0) {
    return {
      ok: false,
      errors: allErrors,
    };
  }

  return {
    ok: true,
    document: canonDoc,
    validation: {
      ok: true,
      errors: [],
      warnings: allWarnings,
    },
  };
}
