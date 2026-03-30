# OpenClaw CtxFST Upgrade One-Page Summary

## One-Line Summary

The goal of this upgrade is to move OpenClaw's memory layer from plain text-chunk retrieval to a four-layer model:

`chunk + entity + state + relation`

---

## Why This Matters

Chunk-only memory systems are useful, but they have clear limits:

- Finding similar text is not the same as understanding stable concepts.
- Alias, shorthand, and canonical entity recall are often unreliable.
- `preconditions`, `postconditions`, and `state_refs` have no real runtime value without a world-state layer.
- Prompt context becomes a flat text dump instead of a structured world-model summary.

`CtxFST` is valuable because it carries more than chunk content. It also carries:

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- multi-relation edges

---

## What Changes

From:

```text
markdown -> chunks -> vector/fts -> prompt
```

To:

```text
.ctxfst.md
  -> parser + validator
  -> documents / chunks / entities / edges
  -> entity-aware retrieval
  -> graph expansion
  -> runtime state
  -> prompt adapter
```

---

## Core Modules

### 1. Parser Layer

- Read `.ctxfst.md`
- Parse frontmatter and `<Chunk>` blocks
- Validate entity/chunk references

### 2. Index Layer

- Store `documents`
- Store `chunks`
- Store `entities`
- Store `entity_edges`

### 3. Retrieval Layer

- Entity name / alias match
- Entity-to-chunk reverse lookup
- Vector / keyword chunk retrieval
- Graph expansion

### 4. Runtime / State Layer

- Track `goal`
- Track `active_states`
- Handle `preconditions` / `postconditions`
- Write `COMPLETED` / `BLOCKED_BY`

### 5. Prompt Adapter Layer

- Do not dump raw schema
- Produce a compact world-model summary for the model

---

## Recommended MVP

The MVP should only do four things:

1. Ingest `.ctxfst.md`
2. Index `entities` and `chunk_entities`
3. Use both entity retrieval and chunk retrieval at query time
4. Feed both relevant entities and supporting chunks into the prompt

At that point, it is fair to say:

> OpenClaw has initial native support for `CtxFST`.

---

## What Not To Do Too Early

Do not rush into:

- a full planner
- deep multi-hop graph expansion
- pushing all runtime logic into prompts

The safe order is:

1. parser
2. indexing
3. entity-aware retrieval
4. prompt adapter
5. runtime state
6. planner / routing

---

## How To Measure Success

At minimum, compare:

1. chunk-only retrieval
2. chunk + entity retrieval
3. chunk + entity + graph expansion

Key questions:

- Do exact entity queries improve?
- Do alias queries improve?
- Do semantic queries stay strong?
- Does graph expansion add useful context instead of noise?

---

## Success Signals

This upgrade is working if:

1. `.ctxfst.md` ingestion is stable
2. entity exact / alias hit rate improves
3. prompts consistently include relevant entities plus supporting chunks
4. relation-sensitive queries improve
5. runtime state can be added naturally on top

---

## Recommended Reading

For a quick technical deep dive:

1. `01-architecture-overview.md`
2. `03-data-schema.md`
3. `05-retrieval-runtime-spec.md`
4. `10-implementation-tasks-checklist.md`
