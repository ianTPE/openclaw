# File And Module Blueprint

## 目的

本文件把前面的 spec 進一步壓成接近實作的 OpenClaw 模組藍圖。

目標不是鎖死 OpenClaw 的 repo 結構，而是提供一個合理的新增檔案與責任切分參考。

---

## 建議新增模組

```text
memory/
  formats/
    ctxfst/
      detector.ts
      parser.ts
      validator.ts
      canonicalize.ts
      types.ts

  indexing/
    ctxfst_indexer.ts
    entity_index.ts
    edge_index.ts
    world_state_store.ts

  retrieval/
    entity_matcher.ts
    entity_retriever.ts
    chunk_retriever.ts
    graph_expander.ts
    rank_fusion.ts
    context_pack.ts

  runtime/
    world_state.ts
    precondition_checker.ts
    execution_writeback.ts
    runtime_events.ts

  prompt/
    ctxfst_prompt_adapter.ts

  storage/
    migrations/
      001_ctxfst_documents.sql
      002_ctxfst_entities.sql
      003_ctxfst_edges.sql
      004_ctxfst_world_state.sql
```

---

## Parser 相關檔案

### `memory/formats/ctxfst/detector.ts`

責任：

- 偵測檔案是否為 `.ctxfst.md`
- 或判斷 Markdown 是否包含可辨識的 `CtxFST` 結構

建議函式：

```ts
export function isCtxfstPath(path: string): boolean;
export function looksLikeCtxfstDocument(source: string): boolean;
```

### `memory/formats/ctxfst/types.ts`

責任：

- 定義 parser / validator / indexer 共用型別

建議型別：

```ts
export type CtxfstDocument
export type CtxfstChunk
export type CtxfstEntity
export type ValidationIssue
export type ValidationResult
```

### `memory/formats/ctxfst/parser.ts`

責任：

- parse frontmatter
- parse `<Chunk>` body
- 建立 raw document model

建議函式：

```ts
export function parseCtxfstDocument(source: string, sourcePath: string): CtxfstDocument;
export function extractChunkBodies(markdownBody: string): Map<string, string>;
```

### `memory/formats/ctxfst/validator.ts`

責任：

- cross-reference validation
- enum validation
- uniqueness validation

建議函式：

```ts
export function validateCtxfstDocument(doc: CtxfstDocument): ValidationResult;
```

### `memory/formats/ctxfst/canonicalize.ts`

責任：

- IDs / aliases / tags normalization
- default value injection

建議函式：

```ts
export function canonicalizeCtxfstDocument(doc: CtxfstDocument): CtxfstDocument;
```

---

## Indexing 相關檔案

### `memory/indexing/ctxfst_indexer.ts`

責任：

- 把 canonical `CtxFST` document materialize 到 storage
- 管理 document-level ingest transaction
- **從 entities 的 `preconditions` / `postconditions` 自動推斷建立 static edges**：`preconditions` → `REQUIRES` edge，`postconditions` → `LEADS_TO` edge。此功能為 Phase 4 Graph Expansion 的必要前置。
- **處理增量重建 (Incremental Update) 時的 Transaction 防線**：當底層掛有 SQLite Vector (如 sqlite-vec) 時，必須確保「刪除舊索引」與「寫入新索引」包在同一個 SQLite Transaction 內，防止中途失敗導致記憶庫污染或關聯重建到一半。

建議函式：

```ts
export async function indexCtxfstDocument(doc: CtxfstDocument): Promise<void>;
export async function reindexCtxfstDocument(documentId: string): Promise<void>;
```

### `memory/indexing/entity_index.ts`

責任：

- entity by-id / by-name / by-alias lookup
- chunk -> entity / entity -> chunk mapping API

建議函式：

```ts
export async function upsertEntities(documentId: string, entities: CtxfstEntity[]): Promise<void>;
export async function findEntitiesByQuery(query: string): Promise<EntityMatch[]>;
export async function getChunksForEntities(entityIds: string[]): Promise<string[]>;
```

### `memory/indexing/edge_index.ts`

責任：

- edge upsert / lookup
- relation-specific query

建議函式：

```ts
export async function upsertEntityEdges(edges: EntityEdgeRecord[]): Promise<void>;
export async function getNeighborEntities(
  entityIds: string[],
  relations?: string[],
): Promise<EntityEdgeRecord[]>;
```

### `memory/indexing/world_state_store.ts`

責任：

- session world state persistence

建議函式：

```ts
export async function getWorldState(sessionId: string): Promise<WorldState>;
export async function saveWorldState(state: WorldState): Promise<void>;
```

---

## Retrieval 相關檔案

### `memory/retrieval/entity_matcher.ts`

責任：

- exact name match
- alias match
- optional future NER/LLM extraction

建議函式：

```ts
export async function matchEntities(query: string): Promise<EntityMatch[]>;
```

### `memory/retrieval/entity_retriever.ts`

責任：

- entity -> chunk reverse lookup
- entity-centric retrieval scoring

建議函式：

```ts
export async function retrieveByEntities(matches: EntityMatch[]): Promise<EntityRetrievalResult>;
```

### `memory/retrieval/chunk_retriever.ts`

責任：

- vector search
- FTS search

建議函式：

```ts
export async function retrieveChunksByVector(query: string, k?: number): Promise<ChunkHit[]>;
export async function retrieveChunksByKeyword(query: string, k?: number): Promise<ChunkHit[]>;
```

### `memory/retrieval/graph_expander.ts`

責任：

- 一跳 relation expansion

建議函式：

```ts
export async function expandEntityNeighborhood(
  entityIds: string[],
  options?: GraphExpansionOptions,
): Promise<ExpandedGraphResult>;
```

### `memory/retrieval/rank_fusion.ts`

責任：

- 多來源 fusion
- relation-weighted ranking

建議函式：

```ts
export function fuseRetrievalResults(input: FusionInput): RankedContext;
```

### `memory/retrieval/context_pack.ts`

責任：

- 輸出給 prompt adapter 的結構化 context pack

建議函式：

```ts
export function buildContextPack(input: RankedContext, state?: WorldState): ContextPack;
```

---

## Runtime 相關檔案

### `memory/runtime/world_state.ts`

責任：

- state snapshot loading
- active state mutations

建議函式：

```ts
export function createEmptyWorldState(sessionId: string): WorldState;
export function applyPostconditions(state: WorldState, postconditions: string[]): WorldState;
```

### `memory/runtime/precondition_checker.ts`

責任：

- 執行前檢查 preconditions 是否成立

建議函式：

```ts
export function checkPreconditions(state: WorldState, required: string[]): PreconditionCheckResult;
```

### `memory/runtime/execution_writeback.ts`

責任：

- 成功/失敗結果回寫 state 與 edges

建議函式：

```ts
export async function writeExecutionSuccess(input: ExecutionWritebackInput): Promise<void>;
export async function writeExecutionFailure(input: ExecutionFailureInput): Promise<void>;
```

### `memory/runtime/runtime_events.ts`

責任：

- audit event logging

建議函式：

```ts
export async function appendRuntimeEvent(event: RuntimeEvent): Promise<void>;
```

---

## Prompt 相關檔案

### `memory/prompt/ctxfst_prompt_adapter.ts`

責任：

- 把 `ContextPack + WorldState` 轉為模型上下文
- **實作 Hard Token Limit (硬上限)**：ContextPack 組裝時，須實作依據優先級（Priority > Graph > Vector）自動剔除超量資料的邏輯，避免 Graph 擴展瞬間將模型 Context 撐爆。

建議函式：

```ts
export function buildCtxfstPromptContext(
  pack: ContextPack,
  state?: WorldState,
): PromptContextEnvelope;
```

---

## 遷移檔案

### `storage/migrations/001_ctxfst_documents.sql`

建立：

- `documents`

### `storage/migrations/002_ctxfst_entities.sql`

建立：

- `entities`
- `chunk_entities`

### `storage/migrations/003_ctxfst_edges.sql`

建立：

- `entity_edges`

### `storage/migrations/004_ctxfst_world_state.sql`

建立：

- `world_states`
- `runtime_events`

---

## 第一批優先實作檔案

若只做 MVP，建議優先開工：

1. `memory/formats/ctxfst/parser.ts`
2. `memory/formats/ctxfst/validator.ts`
3. `memory/indexing/ctxfst_indexer.ts`
4. `memory/indexing/entity_index.ts`
5. `memory/retrieval/entity_matcher.ts`
6. `memory/retrieval/context_pack.ts`
7. `memory/prompt/ctxfst_prompt_adapter.ts`
