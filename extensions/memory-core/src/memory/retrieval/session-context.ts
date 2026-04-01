import type { DatabaseSync } from "node:sqlite";
import { loadWorldState, type WorldState } from "../runtime/world-state.js";
import {
  adaptContextToPrompt,
  renderPromptContext,
  type PromptAdapterOptions,
} from "./prompt-adapter.js";
import { retrieveContext, type RetrievalPipelineOptions } from "./retrieval-pipeline.js";
import type { ChunkContent, EntityDetail, PromptContext } from "./types.js";

// ── Options ───────────────────────────────────────────────────────

export interface SessionAwareRetrievalOptions {
  db: DatabaseSync;
  query: string;
  /** Session whose world state should inform the prompt. */
  sessionId: string;
  /** Retrieval pipeline overrides (vectorHits, keywordHits, limit, graphExpansion). */
  retrieval?: Omit<RetrievalPipelineOptions, "db" | "query">;
  /** Chunk content resolver (same as PromptAdapterOptions). */
  chunkContent: Map<string, ChunkContent>;
  /** Entity detail resolver (same as PromptAdapterOptions). */
  entityDetails?: Map<string, EntityDetail>;
  /** Hard token limit. Defaults to 4000. */
  tokenLimit?: number;
}

export interface SessionAwareResult {
  prompt: PromptContext;
  rendered: string;
  /** The world state that was used (null if the session has no state yet). */
  worldState: WorldState | null;
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Session-aware retrieval + prompt assembly (Phase 6, Task 6.6).
 *
 * Loads the session's world state and feeds it into the retrieval → prompt
 * adapter pipeline so that:
 *
 * - Active states are surfaced in the prompt.
 * - Missing preconditions are computed against the live session state.
 * - Already-completed skills are excluded from "Suggested Next Actions".
 */
export function retrieveSessionAwareContext(
  options: SessionAwareRetrievalOptions,
): SessionAwareResult {
  const { db, query, sessionId, retrieval = {}, chunkContent, entityDetails, tokenLimit } = options;

  // 1. Load session world state
  const worldState = loadWorldState(db, sessionId);

  const activeStates = worldState?.active_states ?? [];
  const completedSkills = (worldState?.completed_skills ?? []).map((r) => r.entityId);

  // 2. Run retrieval pipeline
  const contextPack = retrieveContext({
    db,
    query,
    ...retrieval,
  });

  // 3. Build prompt with session state
  const adapterOpts: PromptAdapterOptions = {
    contextPack,
    chunkContent,
    entityDetails,
    tokenLimit,
    activeStates,
    completedSkills,
  };

  const prompt = adaptContextToPrompt(adapterOpts);
  const rendered = renderPromptContext(prompt);

  return { prompt, rendered, worldState };
}
