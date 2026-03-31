// Shared types for the CtxFST parser, validator, canonicalizer, and indexer.

export interface CtxfstEntity {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  preconditions: string[];
  postconditions: string[];
  relatedSkills: string[];
}

export interface CtxfstChunk {
  id: string;
  entities: string[];
  context: string;
  content: string; // body text from <Chunk> tag
  tags: string[];
  state_refs: string[];
  priority: string;
}

export interface CtxfstDocument {
  id: string;
  source_path: string;
  format: "ctxfst";
  title: string;
  document_version: string;
  entities: CtxfstEntity[];
  chunks: CtxfstChunk[];
  source_hash: string;
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type EntityMatchType = "exact" | "alias";

export interface EntityMatch {
  entity_id: string;
  name: string;
  match_type: EntityMatchType;
  document_id: string;
}

export interface EntityLookupResult {
  query: string;
  matched_entity: string | null;
  match_type: EntityMatchType | null;
  reverse_chunks: string[];
}
