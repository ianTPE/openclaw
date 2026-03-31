// CtxFST parser: YAML frontmatter + <Chunk> body extraction
// Produces a raw (pre-canonicalization) CtxfstDocument

import { createHash } from "node:crypto";
import type {
  ChunkRecord,
  CtxfstDocument,
  DocumentRecord,
  EntityRecord,
  EntityType,
  Priority,
} from "./types.js";

// --- Frontmatter extraction ---

interface RawFrontmatter {
  title?: string;
  document_version?: string;
  entities?: RawEntity[];
  chunks?: RawChunk[];
  [key: string]: unknown;
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
  context?: string;
  entities?: string[];
  state_refs?: string[];
  priority?: string;
  version?: number;
  tags?: string[];
  dependencies?: string[];
  [key: string]: unknown;
}

/**
 * Split source into YAML frontmatter string and markdown body.
 * Throws on missing/malformed frontmatter fences.
 */
export function splitFrontmatterAndBody(source: string): {
  frontmatterYaml: string;
  body: string;
} {
  const fenceStart = source.indexOf("---");
  if (fenceStart !== 0 && source.substring(0, fenceStart).trim() !== "") {
    throw new FatalParseError("Missing opening YAML frontmatter fence (---)");
  }

  const fenceEnd = source.indexOf("---", fenceStart + 3);
  if (fenceEnd === -1) {
    throw new FatalParseError("Missing closing YAML frontmatter fence (---)");
  }

  const frontmatterYaml = source.substring(fenceStart + 3, fenceEnd).trim();
  const body = source.substring(fenceEnd + 3).trim();

  return { frontmatterYaml, body };
}

export class FatalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalParseError";
  }
}

// --- YAML parsing (uses a simple built-in approach for frontmatter) ---

/**
 * Parse YAML frontmatter into a raw object.
 * We use a lightweight approach: dynamic import of yaml if available,
 * otherwise fall back to JSON-compatible subset.
 */
export async function parseFrontmatter(yamlStr: string): Promise<RawFrontmatter> {
  // Use the `yaml` package for robust YAML parsing
  try {
    const yamlModule = await import("yaml");
    const parsed = yamlModule.parse(yamlStr);
    if (typeof parsed !== "object" || parsed === null) {
      throw new FatalParseError(
        "Frontmatter must be a YAML mapping (object), got: " + typeof parsed,
      );
    }
    return parsed as RawFrontmatter;
  } catch (err) {
    if (err instanceof FatalParseError) {
      throw err;
    }
    throw new FatalParseError(
      `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// --- <Chunk> body extraction ---

// Regex to match <Chunk id="..."> ... </Chunk> blocks
// Does NOT support nested <Chunk> tags (spec requirement)
const CHUNK_OPEN_RE = /<Chunk\s+id\s*=\s*"([^"]+)"\s*>/g;
const CHUNK_CLOSE_RE = /<\/Chunk>/g;

export interface ExtractedChunkBody {
  id: string;
  content: string;
}

/**
 * Extract all <Chunk id="...">...</Chunk> bodies from markdown.
 * Fatal errors: unclosed tags, nested tags, missing id.
 */
export function extractChunkBodies(markdownBody: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const errors: string[] = [];

  // Find all chunk open/close tag positions
  const opens: Array<{ id: string; start: number; contentStart: number }> = [];
  let match: RegExpExecArray | null;

  // Reset regex
  CHUNK_OPEN_RE.lastIndex = 0;
  while ((match = CHUNK_OPEN_RE.exec(markdownBody)) !== null) {
    opens.push({
      id: match[1],
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  if (opens.length === 0 && markdownBody.trim().length > 0) {
    // Body has content but no chunk tags — that's fine if frontmatter has no chunks
    return bodies;
  }

  for (let i = 0; i < opens.length; i++) {
    const open = opens[i];

    if (!open.id.trim()) {
      throw new FatalParseError(`<Chunk> tag at position ${open.start} has an empty id attribute`);
    }

    // Find the next </Chunk> after this open tag
    CHUNK_CLOSE_RE.lastIndex = open.contentStart;
    const closeMatch = CHUNK_CLOSE_RE.exec(markdownBody);

    if (!closeMatch) {
      throw new FatalParseError(
        `Unclosed <Chunk id="${open.id}"> tag — no matching </Chunk> found`,
      );
    }

    const closeStart = closeMatch.index;

    // Check for nested <Chunk> between this open and its close
    if (i + 1 < opens.length && opens[i + 1].start < closeStart) {
      throw new FatalParseError(
        `Nested <Chunk> detected: <Chunk id="${opens[i + 1].id}"> is inside <Chunk id="${open.id}">`,
      );
    }

    const content = markdownBody.substring(open.contentStart, closeStart).trim();
    bodies.set(open.id, content);
  }

  if (errors.length > 0) {
    throw new FatalParseError(errors.join("; "));
  }

  return bodies;
}

// --- Assemble raw document ---

function computeSourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * Parse a .ctxfst.md source into a raw CtxfstDocument.
 * This does NOT run validation or canonicalization — those are separate steps.
 */
export async function parseCtxfstDocument(
  source: string,
  sourcePath: string,
): Promise<{
  document: CtxfstDocument;
  unknownKeys: string[];
}> {
  const { frontmatterYaml, body } = splitFrontmatterAndBody(source);
  const fm = await parseFrontmatter(frontmatterYaml);
  const chunkBodies = extractChunkBodies(body);

  // Track unknown top-level keys
  const knownTopKeys = new Set([
    "title",
    "document_version",
    "entities",
    "chunks",
    "format",
    "version",
  ]);
  const unknownKeys = Object.keys(fm).filter((k) => !knownTopKeys.has(k));

  // Build document record
  const sourceHash = computeSourceHash(source);
  const documentId = `doc:${sourcePath.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;

  const documentRecord: DocumentRecord = {
    id: documentId,
    title: typeof fm.title === "string" ? fm.title : "",
    sourcePath,
    format: "ctxfst",
    sourceHash,
    documentVersion:
      typeof fm.document_version === "string"
        ? fm.document_version
        : String(fm.document_version ?? "1.0"),
    metadata: {},
  };

  // Build entity records
  const entities: EntityRecord[] = (fm.entities ?? []).map((raw: RawEntity) => ({
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
    type: (typeof raw.type === "string" ? raw.type : "concept") as EntityType,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    preconditions: Array.isArray(raw.preconditions) ? raw.preconditions.map(String) : [],
    postconditions: Array.isArray(raw.postconditions) ? raw.postconditions.map(String) : [],
    relatedSkills: Array.isArray(raw.relatedSkills) ? raw.relatedSkills.map(String) : [],
    metadata: {},
  }));

  // Build chunk records (merge frontmatter metadata with body content)
  const chunks: ChunkRecord[] = (fm.chunks ?? []).map((raw: RawChunk) => {
    const chunkId = typeof raw.id === "string" ? raw.id : "";
    const bodyContent = chunkBodies.get(chunkId) ?? "";

    return {
      id: chunkId,
      context: typeof raw.context === "string" ? raw.context : "",
      content: bodyContent,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      entities: Array.isArray(raw.entities) ? raw.entities.map(String) : [],
      stateRefs: Array.isArray(raw.state_refs) ? raw.state_refs.map(String) : [],
      priority: (typeof raw.priority === "string" ? raw.priority : "medium") as Priority,
      version: typeof raw.version === "number" ? raw.version : 1,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(String) : [],
      metadata: {},
    };
  });

  return {
    document: {
      document: documentRecord,
      entities,
      chunks,
    },
    unknownKeys,
  };
}
