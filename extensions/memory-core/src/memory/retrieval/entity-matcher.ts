import type { DatabaseSync } from "node:sqlite";
import type { EntityMatch } from "../formats/ctxfst/types.js";
import { findEntitiesByQuery } from "../indexing/entity-index.js";

export interface EntityMatchWithScore extends EntityMatch {
  /** Normalized relevance score: 1.0 for exact, 0.9 for alias. */
  score: number;
}

/**
 * Extract candidate entity strings from a query.
 *
 * Tries the full query, each individual word, and consecutive 2-word pairs.
 * This lets "FastAPI parsing workflow" match `entity:fastapi` via the word
 * "FastAPI" without requiring an exact full-query match.
 */
function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (t) {
      seen.add(t);
    }
  };
  add(query);
  const words = query.split(/\s+/).filter(Boolean);
  for (const word of words) {
    add(word);
  }
  for (let i = 0; i < words.length - 1; i++) {
    add(`${words[i]} ${words[i + 1]}`);
  }
  return [...seen];
}

/**
 * Query-time entity matching.
 * Wraps findEntitiesByQuery across query tokens and attaches relevance scores
 * so downstream fusion can weight entity-derived hits appropriately.
 * Deduplicates matches by entity_id — full-query exact wins over partial.
 */
export function matchEntitiesForQuery(db: DatabaseSync, query: string): EntityMatchWithScore[] {
  const tokens = queryTokens(query);
  // key = `${entity_id}:${document_id}`
  const best = new Map<string, EntityMatchWithScore>();

  for (const token of tokens) {
    const matches = findEntitiesByQuery(db, token);
    for (const m of matches) {
      const key = `${m.entity_id}:${m.document_id}`;
      const score = m.match_type === "exact" ? 1.0 : 0.9;
      const existing = best.get(key);
      // Prefer exact over alias; prefer higher score
      if (!existing || score > existing.score) {
        best.set(key, { ...m, score });
      }
    }
  }

  return Array.from(best.values());
}
