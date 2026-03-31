// Format detection for .ctxfst.md files

const CTXFST_EXTENSION = ".ctxfst.md";

/**
 * Detect by file path extension.
 */
export function isCtxfstPath(path: string): boolean {
  return path.endsWith(CTXFST_EXTENSION);
}

// Heuristic patterns for source-based detection
const FRONTMATTER_FENCE = /^---\s*\n/;
const HAS_ENTITIES_KEY = /^entities:\s*$/m;
const HAS_CHUNK_TAG = /<Chunk\s+id\s*=/;

/**
 * Fallback: detect whether raw source looks like a CtxFST document.
 * Checks for YAML frontmatter containing `entities:` and at least one `<Chunk>` tag.
 */
export function looksLikeCtxfstDocument(source: string): boolean {
  return (
    FRONTMATTER_FENCE.test(source) && HAS_ENTITIES_KEY.test(source) && HAS_CHUNK_TAG.test(source)
  );
}
