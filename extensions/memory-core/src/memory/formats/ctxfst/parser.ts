import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { CtxfstChunk, CtxfstDocument, CtxfstEntity } from "./types.js";

// Regex for <Chunk id="..."> ... </Chunk> blocks.
// Captures: (1) id attribute, (2) body content
const CHUNK_TAG_RE = /<Chunk\s+id="([^"]+)"\s*>([\s\S]*?)<\/Chunk>/g;

interface RawFrontmatter {
  title?: string;
  document_version?: string;
  entities?: RawEntity[];
  chunks?: RawChunk[];
}

interface RawEntity {
  id?: string;
  name?: string;
  type?: string;
  aliases?: string[];
  preconditions?: string[];
  postconditions?: string[];
  relatedSkills?: string[];
  [key: string]: unknown;
}

interface RawChunk {
  id?: string;
  entities?: string[];
  context?: string;
  tags?: string[];
  state_refs?: string[];
  priority?: string;
  [key: string]: unknown;
}

function extractFrontmatterBlock(source: string): { block: string; body: string } | null {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const endIdx = normalized.indexOf("\n---\n", 4);
  if (endIdx === -1) {
    // Try trailing ---
    const endIdx2 = normalized.lastIndexOf("\n---");
    if (endIdx2 <= 4) {
      return null;
    }
    return {
      block: normalized.slice(4, endIdx2),
      body: normalized.slice(endIdx2 + 4),
    };
  }
  return {
    block: normalized.slice(4, endIdx),
    body: normalized.slice(endIdx + 5),
  };
}

function extractChunkBodies(markdownBody: string): Map<string, string> {
  const map = new Map<string, string>();
  CHUNK_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHUNK_TAG_RE.exec(markdownBody)) !== null) {
    const id = match[1].trim();
    const body = match[2].trim();
    map.set(id, body);
  }
  return map;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => (typeof v === "string" ? v : String(v ?? "")));
}

function buildDocumentId(sourcePath: string): string {
  const base = path.basename(sourcePath);
  // Strip .ctxfst.md or .ctxfst.mdx or .md extension
  return base.replace(/\.(ctxfst\.mdx?|mdx?)$/, "");
}

/**
 * Parse a raw `.ctxfst.md` source string into a CtxfstDocument.
 * Throws ParseError on structural failures (malformed YAML, missing required keys).
 * Does not validate cross-references — use validateCtxfstDocument for that.
 */
export function parseCtxfstDocument(source: string, sourcePath: string): CtxfstDocument {
  const extracted = extractFrontmatterBlock(source);
  if (!extracted) {
    throw new ParseError("MISSING_FRONTMATTER", "No valid YAML frontmatter block found");
  }

  let raw: RawFrontmatter;
  try {
    const parsed = parseYaml(extracted.block) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ParseError("MALFORMED_YAML", "Frontmatter must be a YAML object");
    }
    raw = parsed as RawFrontmatter;
  } catch (err) {
    if (err instanceof ParseError) {
      throw err;
    }
    throw new ParseError(
      "MALFORMED_YAML",
      `Failed to parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!raw.entities || !raw.chunks) {
    throw new ParseError(
      "MISSING_REQUIRED_KEYS",
      "Frontmatter must contain both 'entities' and 'chunks' keys",
    );
  }

  const chunkBodies = extractChunkBodies(extracted.body);

  // Detect unclosed or nested <Chunk> tags
  const openCount = (extracted.body.match(/<Chunk\s/g) ?? []).length;
  const closeCount = (extracted.body.match(/<\/Chunk>/g) ?? []).length;
  if (openCount !== closeCount) {
    throw new ParseError(
      "UNCLOSED_CHUNK_TAG",
      `Mismatched <Chunk> tags: ${openCount} open, ${closeCount} close`,
    );
  }
  // Detect nested <Chunk> tags by looking for <Chunk inside a Chunk body
  for (const [id, body] of chunkBodies) {
    if (/<Chunk\s/.test(body)) {
      throw new ParseError("NESTED_CHUNK_TAG", `Chunk '${id}' contains a nested <Chunk> tag`);
    }
  }

  const entities: CtxfstEntity[] = (raw.entities as RawEntity[]).map((e, i) => {
    if (!e || typeof e !== "object") {
      throw new ParseError("INVALID_ENTITY", `Entity at index ${i} is not an object`);
    }
    return {
      id: typeof e.id === "string" ? e.id : "",
      name: typeof e.name === "string" ? e.name : "",
      type: typeof e.type === "string" ? e.type : "",
      aliases: coerceStringArray(e.aliases),
      preconditions: coerceStringArray(e.preconditions),
      postconditions: coerceStringArray(e.postconditions),
      relatedSkills: coerceStringArray(e.relatedSkills),
    };
  });

  const chunks: CtxfstChunk[] = (raw.chunks as RawChunk[]).map((c, i) => {
    if (!c || typeof c !== "object") {
      throw new ParseError("INVALID_CHUNK", `Chunk at index ${i} is not an object`);
    }
    const id = typeof c.id === "string" ? c.id : "";
    const content = chunkBodies.get(id) ?? "";
    return {
      id,
      entities: coerceStringArray(c.entities),
      context: typeof c.context === "string" ? c.context : "",
      content,
      tags: coerceStringArray(c.tags),
      state_refs: coerceStringArray(c.state_refs),
      priority: typeof c.priority === "string" ? c.priority : "medium",
    };
  });

  const sourceHash = createHash("sha256").update(source).digest("hex");

  return {
    id: buildDocumentId(sourcePath),
    source_path: sourcePath,
    format: "ctxfst",
    title: typeof raw.title === "string" ? raw.title : "",
    document_version: typeof raw.document_version === "string" ? raw.document_version : "",
    entities,
    chunks,
    source_hash: sourceHash,
  };
}

export class ParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ParseError";
    this.code = code;
  }
}
