// CtxFST canonical document model types
// Shared across parser, validator, indexer, and retrieval layers

// --- Entity Types ---

export const ENTITY_TYPES = [
  "skill",
  "tool",
  "library",
  "framework",
  "platform",
  "database",
  "architecture",
  "protocol",
  "concept",
  "domain",
  "product",
  "state",
  "action",
  "goal",
  "agent",
  "evidence",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

// --- Priority ---

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export type Priority = (typeof PRIORITIES)[number];

// --- Relation Types ---

export const RELATION_TYPES = [
  "SIMILAR",
  "REQUIRES",
  "LEADS_TO",
  "EVIDENCE",
  "IMPLIES",
  "COMPLETED",
  "BLOCKED_BY",
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

// --- Canonical Records ---

export interface EntityRecord {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  preconditions: string[];
  postconditions: string[];
  relatedSkills: string[];
  metadata: Record<string, unknown>;
}

export interface ChunkRecord {
  id: string;
  context: string;
  content: string;
  tags: string[];
  entities: string[];
  stateRefs: string[];
  priority: Priority;
  version: number;
  dependencies: string[];
  metadata: Record<string, unknown>;
}

export interface DocumentRecord {
  id: string;
  title: string;
  sourcePath: string;
  format: "ctxfst";
  sourceHash: string;
  documentVersion: string;
  metadata: Record<string, unknown>;
}

export interface CtxfstDocument {
  document: DocumentRecord;
  entities: EntityRecord[];
  chunks: ChunkRecord[];
}

// --- Validation ---

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// --- Parse Result ---

export interface ParseResult {
  ok: true;
  document: CtxfstDocument;
  validation: ValidationResult;
}

export interface ParseError {
  ok: false;
  errors: ValidationIssue[];
}

export type ParseOutcome = ParseResult | ParseError;
