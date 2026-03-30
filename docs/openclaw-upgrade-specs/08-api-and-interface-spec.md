# API And Interface Spec

## 目的

本文件把 `CtxFST` integration 所需的主要 interface 壓成可直接映射到程式碼的 API 規格。

以下命名以 TypeScript 風格表示，但不限制最終語言。

---

## Shared Types

### `CtxfstEntity`

```ts
type CtxfstEntity = {
  id: string
  name: string
  type: string
  aliases: string[]
  preconditions: string[]
  postconditions: string[]
  relatedSkills: string[]
  metadata?: Record<string, unknown>
}
```

`relatedSkills` 指向 skill artifact identifier，例如 `skills/analyze-resume/SKILL.md`，不是 entity ID。

### `CtxfstChunk`

```ts
type CtxfstChunk = {
  id: string
  context: string
  content: string
  tags: string[]
  entities: string[]
  stateRefs: string[]
  priority?: 'low' | 'medium' | 'high' | 'critical'
  version?: number
  createdAt?: string
  dependencies?: string[]
  metadata?: Record<string, unknown>
}
```

### `CtxfstDocument`

```ts
type CtxfstDocument = {
  id: string
  sourcePath: string
  title?: string
  format: 'ctxfst'
  sourceHash?: string
  documentVersion?: string | number
  entities: CtxfstEntity[]
  chunks: CtxfstChunk[]
  metadata?: Record<string, unknown>
}
```

### `PersistedDocumentRecord`

```ts
type PersistedDocumentRecord = CtxfstDocument & {
  ingestedAt: string
  updatedAt: string
}
```

### `PersistedChunkRecord`

```ts
type PersistedChunkRecord = CtxfstChunk & {
  documentId: string
  embeddingVector?: number[]
}
```

### `EntityEdgeRecord`

```ts
type EntityEdgeRecord = {
  sourceId: string
  targetId: string
  relation: string
  score?: number
  confidence?: number
  timestamp?: string
  status?: string
  resultSummary?: string
  metadata?: Record<string, unknown>
}
```

### `WorldState`

```ts
type WorldState = {
  sessionId: string
  goal?: string
  activeStates: string[]
  completedSkills: CompletedSkillRecord[]
  blockedBy: string[]
  currentSubgraph?: {
    nodes: string[]
    edges: EntityEdgeRecord[]
  }
}
```

### `CompletedSkillRecord`

```ts
type CompletedSkillRecord = {
  entityId: string
  timestamp: string
  resultSummary?: string
  status?: 'completed' | 'failed'
}
```

---

## Parser Interfaces

### `CtxfstFormatDetector`

```ts
interface CtxfstFormatDetector {
  isPathSupported(path: string): boolean
  detectFromSource(source: string): boolean
}
```

### `CtxfstParser`

```ts
interface CtxfstParser {
  parse(source: string, sourcePath: string): CtxfstDocument
}
```

### `CtxfstValidator`

```ts
interface CtxfstValidator {
  validate(doc: CtxfstDocument): ValidationResult
}
```

### `ValidationResult`

```ts
type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]
}

type ValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}
```

---

## Indexing Interfaces

### `CtxfstIndexer`

```ts
interface CtxfstIndexer {
  indexDocument(doc: CtxfstDocument): Promise<void>
  reindexDocument(documentId: string): Promise<void>
  deleteDocument(documentId: string): Promise<void>
}
```

### `EntityRepository`

```ts
interface EntityRepository {
  upsertMany(documentId: string, entities: CtxfstEntity[]): Promise<void>
  getById(entityId: string): Promise<CtxfstEntity | null>
  findByNameOrAlias(query: string): Promise<EntityMatch[]>
  getChunksForEntities(entityIds: string[]): Promise<string[]>
}
```

### `ChunkRepository`

```ts
interface ChunkRepository {
  upsertMany(documentId: string, chunks: CtxfstChunk[]): Promise<void>
  getByIds(chunkIds: string[]): Promise<CtxfstChunk[]>
  searchByVector(query: string, limit: number): Promise<ChunkHit[]>
  searchByKeyword(query: string, limit: number): Promise<ChunkHit[]>
}
```

### `EdgeRepository`

```ts
interface EdgeRepository {
  upsertMany(edges: EntityEdgeRecord[]): Promise<void>
  getNeighbors(entityIds: string[], relations?: string[], limit?: number): Promise<EntityEdgeRecord[]>
}
```

---

## Retrieval Interfaces

### `EntityMatcher`

```ts
interface EntityMatcher {
  match(query: string): Promise<EntityMatch[]>
}
```

### `EntityMatch`

```ts
type EntityMatch = {
  entityId: string
  matchedText: string
  matchType: 'exact' | 'alias' | 'inferred'
  score: number
}
```

### `EntityRetrievalResult`

```ts
type EntityRetrievalResult = {
  matchedEntities: EntityMatch[]
  chunkIds: string[]
}
```

### `ChunkHit`

```ts
type ChunkHit = {
  chunkId: string
  score: number
  source: 'vector' | 'keyword' | 'entity' | 'graph'
}
```

### `GraphExpansionOptions`

```ts
type GraphExpansionOptions = {
  maxDepth?: number
  maxEntities?: number
  relations?: string[]
  relationWeights?: Record<string, number>
}
```

### `GraphExpander`

```ts
interface GraphExpander {
  expand(entityIds: string[], options?: GraphExpansionOptions): Promise<ExpandedGraphResult>
}
```

### `ExpandedGraphResult`

```ts
type ExpandedGraphResult = {
  entities: string[]
  edges: EntityEdgeRecord[]
}
```

### `ContextPack`

```ts
type ContextPack = {
  relevantEntities: CtxfstEntity[]
  supportingChunks: CtxfstChunk[]
  expandedEdges: EntityEdgeRecord[]
  activeStates: string[]
  missingPreconditions: string[]
  suggestedNextActions: string[]
}
```

### `FusionInput`

```ts
type FusionInput = {
  entityMatches: EntityMatch[]
  entityChunks: ChunkHit[]
  vectorChunks: ChunkHit[]
  keywordChunks?: ChunkHit[]
  graphChunks?: ChunkHit[]
  expandedGraph?: ExpandedGraphResult
}
```

### `RankedContext`

```ts
type RankedContext = {
  entities: EntityMatch[]
  chunks: ChunkHit[]
  expandedEdges: EntityEdgeRecord[]
}
```

### `RetrievalOrchestrator`

```ts
interface RetrievalOrchestrator {
  retrieve(query: string, sessionId?: string): Promise<ContextPack>
}
```

---

## Runtime Interfaces

### `WorldStateStore`

```ts
interface WorldStateStore {
  get(sessionId: string): Promise<WorldState | null>
  save(state: WorldState): Promise<void>
}
```

### `PreconditionCheckResult`

```ts
type PreconditionCheckResult = {
  ok: boolean
  missing: string[]
}
```

### `PreconditionChecker`

```ts
interface PreconditionChecker {
  check(state: WorldState, required: string[]): PreconditionCheckResult
}
```

### `ExecutionWritebackInput`

```ts
type ExecutionWritebackInput = {
  sessionId: string
  entityId: string
  postconditions: string[]
  resultSummary?: string
  timestamp?: string
}
```

### `ExecutionWritebackFailureInput`

```ts
type ExecutionWritebackFailureInput = {
  sessionId: string
  entityId: string
  blockedBy?: string[]
  resultSummary?: string
  timestamp?: string
}
```

### `ExecutionWriteback`

```ts
interface ExecutionWriteback {
  writeSuccess(input: ExecutionWritebackInput): Promise<void>
  writeFailure(input: ExecutionWritebackFailureInput): Promise<void>
}
```

### `RuntimeEvent`

```ts
type RuntimeEvent = {
  id: string
  sessionId: string
  eventType: 'completed' | 'blocked_by' | 'evidence' | 'state_update'
  entityId?: string
  relatedEntityId?: string
  payload?: Record<string, unknown>
  createdAt: string
}
```

---

## Prompt Interfaces

### `PromptContextEnvelope`

```ts
type PromptContextEnvelope = {
  activeUserStates: string[]
  relevantEntities: Array<{
    id: string
    name: string
    type: string
  }>
  retrievedChunks: Array<{
    id: string
    context: string
    content: string
  }>
  missingPreconditions: string[]
  suggestedNextActions: string[]
}
```

### `CtxfstPromptAdapter`

```ts
interface CtxfstPromptAdapter {
  build(pack: ContextPack, state?: WorldState): PromptContextEnvelope
}
```

---

## API Design Notes

1. Parser / validator / canonicalizer 應保持純函式風格。
2. Repository interfaces 應讓 storage layer 可替換。
3. Retrieval orchestration 應能單獨測試，不依賴 prompt layer。
4. Prompt adapter 只消費 `ContextPack` 與 `WorldState`，不要直接讀 DB。
