import type { PlannerOutput } from "./planner-types.js";
import { buildPlannerPromptSections } from "./planner.js";
import type {
  ChunkContent,
  ContextPack,
  EntityDetail,
  ExpandedEntity,
  FusedChunkHit,
  PromptContext,
  PromptSection,
} from "./types.js";

// ── Priority tiers (higher = harder to trim) ──────────────────────

const PRIORITY_PRECONDITIONS = 100;
const PRIORITY_ACTIVE_STATES = 90;
const PRIORITY_ENTITIES = 80;
const PRIORITY_GRAPH_RELATIONS = 60;
const PRIORITY_CHUNK_HIGH = 70;
const PRIORITY_CHUNK_MEDIUM = 50;
const PRIORITY_CHUNK_LOW = 30;
const PRIORITY_NEXT_ACTIONS = 40;

// ── Token estimation ──────────────────────────────────────────────

/** Rough token estimate: ~4 characters per token (GPT-family heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Prompt Adapter Options ────────────────────────────────────────

export interface PromptAdapterOptions {
  /** The fully assembled context pack from the retrieval pipeline. */
  contextPack: ContextPack;
  /** Chunk content resolver: chunk_id → content metadata. */
  chunkContent: Map<string, ChunkContent>;
  /** Entity detail resolver: entity_id → type/preconditions/postconditions. */
  entityDetails?: Map<string, EntityDetail>;
  /** Hard token limit for the entire rendered prompt. Defaults to 4000. */
  tokenLimit?: number;
  /** Active user states from the session world state (Phase 6). */
  activeStates?: string[];
  /** Entity IDs of skills already completed in this session (Phase 6). */
  completedSkills?: string[];
  /**
   * Planner output (Phase 7). When provided, replaces the simple
   * postcondition-based "Suggested Next Actions" section with the
   * goal-aware "Next Actions" and "Blocked Actions" sections.
   */
  plannerOutput?: PlannerOutput;
}

// ── Section builders ──────────────────────────────────────────────

function buildActiveStatesSection(activeStates: string[]): PromptSection | null {
  if (activeStates.length === 0) {
    return null;
  }
  const lines = activeStates.map((s) => `- ${s}`);
  return {
    label: "Active States",
    content: lines.join("\n"),
    priority: PRIORITY_ACTIVE_STATES,
  };
}

function buildMissingPreconditionsSection(
  contextPack: ContextPack,
  entityDetails: Map<string, EntityDetail>,
  activeStates: string[],
): PromptSection | null {
  const activeSet = new Set(activeStates);
  const missing: Array<{ entityName: string; missingState: string }> = [];

  for (const entity of contextPack.matched_entities) {
    const detail = entityDetails.get(entity.entity_id);
    if (!detail?.preconditions.length) {
      continue;
    }
    for (const pre of detail.preconditions) {
      if (!activeSet.has(pre)) {
        missing.push({ entityName: entity.name, missingState: pre });
      }
    }
  }

  if (missing.length === 0) {
    return null;
  }

  // Deduplicate missing states
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const m of missing) {
    const key = `${m.entityName}:${m.missingState}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`- ${m.entityName} requires: ${m.missingState}`);
    }
  }

  return {
    label: "Missing Preconditions",
    content: lines.join("\n"),
    priority: PRIORITY_PRECONDITIONS,
  };
}

function buildEntitiesSection(
  contextPack: ContextPack,
  entityDetails: Map<string, EntityDetail>,
): PromptSection | null {
  if (contextPack.matched_entities.length === 0) {
    return null;
  }

  // Deduplicate by entity_id
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const entity of contextPack.matched_entities) {
    if (seen.has(entity.entity_id)) {
      continue;
    }
    seen.add(entity.entity_id);

    const detail = entityDetails.get(entity.entity_id);
    const typePart = detail ? ` (${detail.type})` : "";
    lines.push(`- **${entity.name}**${typePart}`);
  }

  return {
    label: "Relevant Entities",
    content: lines.join("\n"),
    priority: PRIORITY_ENTITIES,
  };
}

function buildGraphRelationsSection(expandedEntities: ExpandedEntity[]): PromptSection | null {
  if (expandedEntities.length === 0) {
    return null;
  }

  // Group by relation type to avoid repetition (D3: relation dedupe)
  const byRelation = new Map<string, string[]>();
  const seenPairs = new Set<string>();

  for (const expanded of expandedEntities) {
    const key = `${expanded.relation}:${expanded.name}`;
    if (seenPairs.has(key)) {
      continue;
    }
    seenPairs.add(key);

    const list = byRelation.get(expanded.relation) ?? [];
    list.push(expanded.name);
    byRelation.set(expanded.relation, list);
  }

  const lines: string[] = [];
  for (const [relation, names] of byRelation) {
    lines.push(`- ${relation}: ${names.join(", ")}`);
  }

  return {
    label: "Related Entities (Graph)",
    content: lines.join("\n"),
    priority: PRIORITY_GRAPH_RELATIONS,
  };
}

function buildChunkSections(
  fusedChunks: FusedChunkHit[],
  chunkContent: Map<string, ChunkContent>,
): PromptSection[] {
  const sections: PromptSection[] = [];
  // Chunks are already deduped and ordered by fused score from rank-fusion.
  // We emit one section per chunk so token trimming can remove individual chunks.
  const seen = new Set<string>();

  for (const chunk of fusedChunks) {
    if (seen.has(chunk.chunk_id)) {
      continue;
    }
    seen.add(chunk.chunk_id);

    const meta = chunkContent.get(chunk.chunk_id);
    if (!meta) {
      continue;
    }

    const priorityNum =
      meta.priority === "high"
        ? PRIORITY_CHUNK_HIGH
        : meta.priority === "medium"
          ? PRIORITY_CHUNK_MEDIUM
          : PRIORITY_CHUNK_LOW;

    // Render: context line as a brief header, then full content
    const rendered = meta.context ? `> ${meta.context}\n\n${meta.content}` : meta.content;

    sections.push({
      label: `Chunk: ${chunk.chunk_id}`,
      content: rendered,
      priority: priorityNum,
    });
  }

  // Sort by priority descending so high-signal chunks appear before low-signal.
  // Within the same priority tier, preserve fused-score order (insertion order).
  sections.sort((a, b) => b.priority - a.priority);

  return sections;
}

function buildNextActionsSection(
  contextPack: ContextPack,
  entityDetails: Map<string, EntityDetail>,
  completedSkills: string[],
): PromptSection | null {
  const completedSet = new Set(completedSkills);
  const actions: string[] = [];
  const seen = new Set<string>();

  // Suggest postconditions of matched entities as next steps,
  // but skip entities whose skill has already been completed in this session.
  for (const entity of contextPack.matched_entities) {
    if (completedSet.has(entity.entity_id)) {
      continue;
    }
    const detail = entityDetails.get(entity.entity_id);
    if (!detail?.postconditions.length) {
      continue;
    }
    for (const post of detail.postconditions) {
      if (!seen.has(post)) {
        seen.add(post);
        actions.push(`- After ${entity.name}: ${post}`);
      }
    }
  }

  if (actions.length === 0) {
    return null;
  }

  return {
    label: "Suggested Next Actions",
    content: actions.join("\n"),
    priority: PRIORITY_NEXT_ACTIONS,
  };
}

// ── Token budget trimming ─────────────────────────────────────────

/**
 * Trim sections to fit within the token budget.
 * Removes lowest-priority sections first. Within the same priority,
 * removes later (lower-ranked) sections first.
 */
function trimToTokenBudget(sections: PromptSection[], tokenLimit: number): PromptSection[] {
  // Calculate total tokens including section labels
  function totalTokens(ss: PromptSection[]): number {
    let sum = 0;
    for (const s of ss) {
      // Account for section header + content + separators
      sum += estimateTokens(`## ${s.label}\n\n${s.content}\n\n`);
    }
    return sum;
  }

  let current = [...sections];
  let tokens = totalTokens(current);

  if (tokens <= tokenLimit) {
    return current;
  }

  // Sort candidates for removal: lowest priority first, then last in list first
  const removalOrder = current
    .map((s, i) => ({ section: s, index: i }))
    .sort((a, b) => {
      const pDiff = a.section.priority - b.section.priority;
      if (pDiff !== 0) return pDiff;
      // Same priority: remove later sections first
      return b.index - a.index;
    });

  for (const candidate of removalOrder) {
    if (tokens <= tokenLimit) {
      break;
    }
    const sectionTokens = estimateTokens(
      `## ${candidate.section.label}\n\n${candidate.section.content}\n\n`,
    );
    current = current.filter((s) => s !== candidate.section);
    tokens -= sectionTokens;
  }

  return current;
}

// ── Main adapter ──────────────────────────────────────────────────

/**
 * Prompt adapter (Phase 5).
 *
 * Transforms a ContextPack into a structured, token-budgeted, deduplicated
 * PromptContext suitable for injection into an LLM prompt.
 *
 * Section order:
 * 1. Missing Preconditions (blockers first)
 * 2. Active States
 * 3. Relevant Entities
 * 4. Graph Relations (when expansion is enabled)
 * 5. Supporting Chunks (ordered by fused score, high-priority first)
 * 6. Suggested Next Actions
 */
export function adaptContextToPrompt(options: PromptAdapterOptions): PromptContext {
  const {
    contextPack,
    chunkContent,
    entityDetails = new Map(),
    tokenLimit = 4000,
    activeStates = [],
    completedSkills = [],
    plannerOutput,
  } = options;

  // Build sections in display order
  const sections: PromptSection[] = [];

  const preconditions = buildMissingPreconditionsSection(contextPack, entityDetails, activeStates);
  if (preconditions) sections.push(preconditions);

  const states = buildActiveStatesSection(activeStates);
  if (states) sections.push(states);

  const entities = buildEntitiesSection(contextPack, entityDetails);
  if (entities) sections.push(entities);

  const graph = buildGraphRelationsSection(contextPack.expanded_entities);
  if (graph) sections.push(graph);

  const chunks = buildChunkSections(contextPack.fused_chunks, chunkContent);
  sections.push(...chunks);

  // Phase 7: when planner output is available, use its richer sections instead
  // of the simple postcondition-based next-actions list.
  if (plannerOutput) {
    sections.push(...buildPlannerPromptSections(plannerOutput));
  } else {
    const nextActions = buildNextActionsSection(contextPack, entityDetails, completedSkills);
    if (nextActions) sections.push(nextActions);
  }

  // Apply token budget
  const trimmed = trimToTokenBudget(sections, tokenLimit);

  // Calculate final token usage
  let estimated = 0;
  for (const s of trimmed) {
    estimated += estimateTokens(`## ${s.label}\n\n${s.content}\n\n`);
  }

  return {
    query: contextPack.query,
    sections: trimmed,
    token_usage: {
      estimated,
      limit: tokenLimit,
    },
  };
}

/**
 * Render a PromptContext into a single string for prompt injection.
 * Each section is rendered as a markdown heading + content block.
 */
export function renderPromptContext(ctx: PromptContext): string {
  return ctx.sections.map((s) => `## ${s.label}\n\n${s.content}`).join("\n\n");
}
