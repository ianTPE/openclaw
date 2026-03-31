import type { CtxfstDocument } from "./types.js";

/**
 * Normalize a parsed CtxfstDocument:
 * - Trim whitespace from IDs, names, aliases, tags
 * - Deduplicate aliases and tags
 * - Inject defaults for missing optional fields
 */
export function canonicalizeCtxfstDocument(doc: CtxfstDocument): CtxfstDocument {
  return {
    ...doc,
    id: doc.id.trim(),
    title: doc.title.trim(),
    entities: doc.entities.map((e) => ({
      ...e,
      id: e.id.trim(),
      name: e.name.trim(),
      type: e.type.trim() || "concept",
      aliases: dedupe(e.aliases.map((a) => a.trim()).filter(Boolean)),
      preconditions: dedupe(e.preconditions.map((p) => p.trim()).filter(Boolean)),
      postconditions: dedupe(e.postconditions.map((p) => p.trim()).filter(Boolean)),
      relatedSkills: dedupe(e.relatedSkills.map((s) => s.trim()).filter(Boolean)),
    })),
    chunks: doc.chunks.map((c) => ({
      ...c,
      id: c.id.trim(),
      entities: c.entities.map((id) => id.trim()),
      context: c.context.trim(),
      tags: dedupe(c.tags.map((t) => t.trim()).filter(Boolean)),
      state_refs: dedupe(c.state_refs.map((s) => s.trim()).filter(Boolean)),
      priority: c.priority.trim() || "medium",
    })),
  };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
