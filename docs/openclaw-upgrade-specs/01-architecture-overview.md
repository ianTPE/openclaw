# Architecture Overview

## 升級後的核心架構

OpenClaw 的 `CtxFST` 原生支援架構分成五層：

1. Parser Layer
2. Index Layer
3. Retrieval Layer
4. Runtime / State Layer
5. Prompt Adapter Layer

---

## 高層資料流

```text
.ctxfst.md source
  -> parser + validator
  -> canonical document model
  -> indexer
  -> documents / chunks / entities / edges / state tables
  -> query-time retrieval
  -> runtime state merge
  -> prompt adapter
  -> model context
```

---

## 五層模組說明

### 1. Parser Layer

責任：

- 讀取 `.ctxfst.md`
- 解析 YAML frontmatter
- 對 `<Chunk id="...">` body 建立對應
- 建立 canonical document model
- 執行 schema-level validation

產出：

- `DocumentRecord`
- `ChunkRecord[]`
- `EntityRecord[]`
- `ValidationReport`

### 2. Index Layer

責任：

- 將 canonical model 寫入 storage
- 維護 documents / chunks / entities / edges
- 維護 chunk -> entity mapping
- 支援 reindex / incremental rebuild

產出：

- 可被 retrieval 與 runtime 直接查詢的結構化索引

### 3. Retrieval Layer

責任：

- entity match / extraction
- chunk vector retrieval
- graph expansion
- relevance fusion / reranking
- final context pack assembly

產出：

- `RetrievedEntities`
- `RetrievedChunks`
- `ExpandedEdges`
- `ContextPack`

### 4. Runtime / State Layer

責任：

- 維護 session world state
- precondition checking
- postcondition writeback
- runtime edges: `COMPLETED`, `BLOCKED_BY`, `EVIDENCE`

產出：

- `WorldStateSnapshot`
- runtime-updated edges

### 5. Prompt Adapter Layer

責任：

- 把 retrieval 與 runtime 輸出轉成模型可吃的摘要
- 控制 prompt 長度與排序
- 區分 active state、supporting evidence、missing preconditions

產出：

- `PromptContextEnvelope`

---

## 設計判斷

### 為什麼不能只有 parser

因為只讀得懂 `.ctxfst.md`，但 retrieval 仍只看 chunk，系統仍然不理解 entity layer。

### 為什麼不能只有 entity index

因為 `preconditions` / `postconditions` / `state_refs` 沒有 runtime state 時只是靜態 metadata。

### 為什麼需要 prompt adapter

因為模型真正需要的是經過壓縮與排序的世界模型摘要，而不是原始 schema dump。

---

## 推薦的實作順序

1. Parser Layer
2. Index Layer 的 entity extension
3. Retrieval Layer 的 entity-aware retrieval
4. Prompt Adapter Layer
5. Runtime / State Layer
6. Planner / routing extensions
