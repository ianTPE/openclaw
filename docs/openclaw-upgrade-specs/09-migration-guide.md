# Migration Guide

## 目的

本文件描述 OpenClaw 如何從現有的 chunk-only memory/index，逐步遷移到 `chunk + entity + state + relation` 四層模型。

重點不是一次翻新，而是逐步導入，並在每一步保留可回退性。

---

## 起點

假設現有 OpenClaw 具備以下能力：

- Markdown source ingestion
- chunking
- vector retrieval
- FTS / keyword retrieval
- SQLite 或等價 storage

這是一個典型的 `chunk-only memory system`。

---

## 遷移原則

1. 先擴 schema，再擴 retrieval。
2. 先讓 `CtxFST` 成為一種可 ingest 的 format，再讓它成為優先語意來源。
3. planner / runtime state 最後再接，避免第一版責任混亂。
4. 每一階段都應保留 fallback 到 chunk-only retrieval 的能力。

---

## Step 1: 加入 `CtxFST` parser，但不取代既有 loader

### 目標

- 現有 Markdown ingestion 不受影響
- 新增 `.ctxfst.md` format support

### 變更

- 新增 `CtxFST` format detector
- 新增 parser / validator / canonicalizer
- ingestion pipeline 根據副檔名或內容選擇 loader

### 驗收

- 既有 `.md` 繼續可 ingest
- 新的 `.ctxfst.md` 可被讀成 canonical document model

---

## Step 2: 擴充 storage schema

### 目標

- 不破壞既有 `chunks` 查詢
- 新增 entity / edge / world state 能力

### 變更

- 新增 `documents`
- 新增 `entities`
- 新增 `chunk_entities`
- 新增 `entity_edges`
- 預留 `world_states`, `runtime_events`

### 驗收

- 舊 chunk records 仍可查
- 新 `CtxFST` document 可同時落到 chunk 與 entity tables

---

## Step 3: entity-aware retrieval 與 chunk retrieval 並存

### 目標

- 不破壞原本 vector / FTS
- 新增 entity match 與 reverse lookup

### 變更

- query 先做 entity name / alias match
- entity hit 後回查相關 chunks
- 再與 vector/FTS 結果融合

### 驗收

- 純文字 query 不退化
- 專有名詞 / alias query 召回更穩

---

## Step 4: 加入一跳 graph expansion

### 目標

- 讓 retrieval 開始理解 relation，而不是只有 chunk

### 變更

- 對命中 entity 做一跳 neighbor expansion
- relation 設權重
- 限制 max expanded nodes

### 驗收

- `REQUIRES` / `LEADS_TO` 類 query 可補到純向量難召回內容

---

## Step 5: 加入 prompt adapter

### 目標

- 避免 schema dump
- 把 retrieval 結果整理成模型真的用得上的上下文

### 變更

- context pack builder
- prompt context envelope builder
- token budget / dedupe 策略

### 驗收

- prompt 中同時出現 relevant entities 與 supporting chunks
- context 更短但更聚焦

---

## Step 6: 啟用 world state

### 目標

- 讓 `preconditions` / `postconditions` / `state_refs` 開始有 operational value

### 變更

- 新增 session-scoped `world_states`
- execution 前檢查 preconditions
- execution 後寫入 postconditions

### 驗收

- 系統能標記 missing preconditions
- 執行成功後能更新 active states

---

## Step 7: planner / routing 整合

### 目標

- 讓 retrieval 結果與 runtime state 被更高層 agent decision 使用

### 變更

- goal-aware routing
- state-aware ranking
- completion-aware next action suggestion

### 驗收

- 系統不只找資訊，也能推薦更合理的下一步

---

## 與 CH23 的關係

### 遷移前

`CH23` 模式比較像：

```text
markdown source
  -> chunk index
  -> retrieval
  -> export / inspect / repair / reindex
```

### 遷移後

會變成：

```text
ctxfst source
  -> parser
  -> chunk + entity + edge index
  -> entity-aware retrieval
  -> prompt adapter
  -> runtime state
  -> writeback
```

重點是：

- `CH23` 的 debugability 仍保留
- 但系統不再只是被動可修，而是主動理解結構

---

## 最小遷移包

若只能做最小幅度升級，建議至少完成：

1. `CtxFST` parser
2. `entities` + `chunk_entities` schema
3. entity name/alias match
4. prompt adapter

這四步已足夠把 OpenClaw 從 chunk-only retrieval 推進到「初步原生支援 `CtxFST`」。

---

## 回退策略

若某一階段表現不穩，系統應支援回退：

- retrieval 可 fallback 到 chunk-only mode
- prompt adapter 可 fallback 到 chunk-only context builder
- runtime state 可暫時關閉，只保留靜態 retrieval

這樣可以降低升級風險，也更容易做 A/B 驗證。
