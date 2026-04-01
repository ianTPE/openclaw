# Phase 5 CLI Smoke Tests

Quick-reference command list for manually validating the Prompt Adapter against
the acceptance criteria in `25-phase-5-validation-checklist.md`.

Prerequisite: at least `retrieval-test.ctxfst.md` is present in the workspace
memory directory (`~/.openclaw/workspace/memory/`).

---

## A. Prompt Envelope Shape

### A1/A2: Structured output, stable across runs

```bash
openclaw memory search "FastAPI parsing workflow"
openclaw memory search "FastAPI parsing workflow"
```

Verify: both runs produce the same section headings (Relevant Entities, Chunks,
etc.) in the same order.

### A3: No raw frontmatter/schema dump

```bash
openclaw memory search --json "FastAPI parsing workflow"
```

Verify: `rendered` field contains no raw YAML frontmatter or `---` block.

---

## B. Content Selection

### B1: Relevant entities included

```bash
openclaw memory search "FastAPI parsing workflow"
```

Verify: output lists FastAPI entity with name, type, and relation.

### B2: Supporting chunks included

```bash
openclaw memory search "How does the system parse an uploaded resume and what backend supports it?"
```

Verify: at least one chunk with resume-parsing content appears.

### B3: Graph summary included when expansion is on

```bash
openclaw memory search --expand-graph "What is required before Analyze Resume?"
```

Verify: output includes a Related Entities (Graph) section with REQUIRES edges.

---

## C. Ordering

### C1: State/entity summary before chunks

```bash
openclaw memory search --expand-graph "What is required before Analyze Resume?"
```

Verify: Relevant Entities and Missing Preconditions appear before Chunk sections.

### C2: High-signal chunks first

```bash
openclaw memory search "resume intake critical steps"
```

Verify: highest-priority chunk (`chunk:intake-critical` or similar) appears first.

### C3: Missing preconditions surfaced early

```bash
openclaw memory search "What do I need before Analyze Resume?"
```

Verify: Missing Preconditions section appears near the top of output.

---

## D. Dedupe

### D1/D2/D3: Chunk, entity, and relation dedupe

```bash
openclaw memory search --json --expand-graph "FastAPI parsing workflow"
```

Verify in JSON output:
- No chunk ID appears more than once in `prompt.sections`.
- No entity ID appears more than once in Relevant Entities.
- No relation pair appears more than once in Related Entities (Graph).

---

## E. Token Budget

### E1/E2: Hard limit respected, sane allocation

```bash
openclaw memory search --json --expand-graph --token-limit 2000 "FastAPI parsing workflow"
```

Verify: `prompt.token_usage.estimated` <= 2000.

### E3: Overflow trimming preserves high-signal content

```bash
# Normal budget
openclaw memory search --expand-graph "What is required before Analyze Resume?"

# Tight budget
openclaw memory search --expand-graph --token-limit 500 "What is required before Analyze Resume?"
```

Compare: tight budget keeps Missing Preconditions + Relevant Entities + core
chunk. Graph and Suggested Next Actions are trimmed first.

---

## F. Answer Quality

### F1: Exact entity question

```bash
openclaw memory search "What is FastAPI used for here?"
```

Verify: context is sufficient to explain FastAPI's role in the system.

### F2: Prerequisite question

```bash
openclaw memory search --expand-graph "What is required before Analyze Resume?"
```

Verify: output surfaces REQUIRES relations and missing state preconditions.

### F3: Mixed workflow question

```bash
openclaw memory search "How does the system parse an uploaded resume and what backend supports it?"
```

Verify: output includes both a workflow chunk and a FastAPI/backend chunk.

---

## G. Before/After (Phase 4 vs Phase 5)

```bash
# Phase 4 raw retrieval (contextPack only)
openclaw memory search --json --expand-graph "What is required before Analyze Resume?" \
  | jq '.contextPack'

# Phase 5 adapted prompt
openclaw memory search --json --expand-graph "What is required before Analyze Resume?" \
  | jq '.rendered'
```

Compare:
- G1: `rendered` is more readable than raw `contextPack`.
- G2: `rendered` has less noise (no duplicate chunks/entities).
- G3: `rendered` still covers the key entities, chunks, and relations from
  `contextPack`.
