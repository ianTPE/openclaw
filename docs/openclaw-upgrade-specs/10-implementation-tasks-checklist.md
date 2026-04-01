# Implementation Tasks Checklist

本文件把 `OpenClaw -> CtxFST native support` 的 spec 拆成可以排期、指派、驗收的工程任務。

---

## 使用方式

- 每個 task 都應有 owner
- 每個 task 都應有驗收方式
- 建議依 phase 順序執行，不要跳太快到 planner

---

## Phase 0: Alignment

### Task 0.1

- [x] 確認 `CtxFST` 核心欄位最小集合

完成條件：

- 團隊確認以下欄位進 MVP：
  - `entities`
  - `chunks`
  - `chunks[].entities`
  - `aliases`
  - `state_refs`

### Task 0.2

- [x] 確認 entity types 與 relation enums

完成條件：

- 寫出 OpenClaw 第一版支援的：
  - entity types
  - relations
  - priority enums

### Task 0.3

- [x] 確認舊 memory pipeline 哪些部分沿用、哪些部分擴充

完成條件：

- 有一頁設計結論，說明：
  - 哪些 chunk retrieval 元件沿用
  - 哪些 DB schema 擴充
  - 哪些部分不在 MVP

---

## Phase 1: Parser MVP

### Task 1.1

- [x] 新增 `.ctxfst.md` format detection

完成條件：

- path-based detection 可運作
- source-based fallback detection 可運作

### Task 1.2

- [x] 實作 YAML frontmatter parser

完成條件：

- 能解析 `title`, `entities`, `chunks`, metadata

### Task 1.3

- [x] 實作 `<Chunk id="...">` body parser

完成條件：

- 能抽出所有 chunk body
- 能對應 chunk ID -> content

### Task 1.4

- [x] 實作 cross-reference validator

完成條件：

- 可驗證：
  - duplicate entity IDs
  - duplicate chunk IDs
  - missing chunk body
  - body/frontmatter mismatch
  - missing entity references

### Task 1.5

- [x] 實作 canonicalization

完成條件：

- **entity ID 嚴格經過 Regex 清洗並統一轉為 Kebab-case，避免產生幽靈節點**
- aliases 去重
- tags 去重
- 預設值注入
- enum 正規化

### Task 1.6

- [x] 補 parser test fixtures

完成條件：

- 至少包含：
  - valid minimal document
  - valid full document
  - missing entity reference
  - duplicate IDs
  - chunk mapping mismatch
- 使用 `examples/minimal.ctxfst.md` 與 `examples/full.ctxfst.md` 作為起始 fixture 來源

---

## Phase 2: Storage And Indexing

### Task 2.1

- [x] 新增 `documents` schema migration

完成條件：

- 支援 `source_hash`
- 支援 `document_version`

### Task 2.2

- [x] 新增 `entities` schema migration

完成條件：

- 支援：
  - `id`
  - `name`
  - `type`
  - `aliases_json`
  - `preconditions_json`
  - `postconditions_json`

### Task 2.3

- [x] 新增 `chunk_entities` schema migration

完成條件：

- 可以從 entity 反查 chunks

### Task 2.4

- [x] 新增 `entity_edges` schema migration

完成條件：

- 支援：
  - `relation`
  - `score`
  - `confidence`
  - `timestamp`

### Task 2.5

- [x] 實作 `CtxFST` document indexer

完成條件：

- 可把 document / chunks / entities / mappings 一次寫入
- reindex 時不產生重複資料

### Task 2.6

- [x] 導入 source hash 與增量重建策略

完成條件：

- source 未變更時避免重建
- source 變更時能安全 reindex（**必須將刪除舊索引與寫入新索引的操作包在同一個 SQLite Transaction 中確保一致性**）

### Task 2.7

- [x] 實作從 preconditions / postconditions 自動推斷 static edges

完成條件：

- indexer 在 ingest 時自動從 entities 的 `preconditions` 建立 `REQUIRES` edges
- indexer 在 ingest 時自動從 entities 的 `postconditions` 建立 `LEADS_TO` edges
- 基於 `retrieval-test.ctxfst.md` 驗證至少有 6 條 auto-inferred edges
- reindex 時舊的 static edges 會被正確清理並重建

備註：

- 此 task 為 Phase 4 Graph Expansion 的必要前置

---

## Phase 3: Entity-Aware Retrieval

### Task 3.1

- [x] 實作 entity exact match

完成條件：

- query 可直接命中 entity `name`

### Task 3.2

- [x] 實作 alias match

完成條件：

- query 可命中 entity `aliases`

### Task 3.3

- [x] 實作 entity -> chunk reverse lookup

完成條件：

- 命中 entity 後可拉出相關 chunks

### Task 3.4

- [x] 保留既有 vector retrieval 並接到 fusion pipeline

完成條件：

- vector retrieval 可與 entity retrieval 並行工作

### Task 3.5

- [x] 保留 keyword / FTS retrieval 並接到 fusion pipeline

完成條件：

- keyword retrieval 可與 entity retrieval 並行工作

### Task 3.6

- [x] 實作 fusion / ranking

完成條件：

- 可合併：
  - entity hits
  - entity-derived chunks
  - vector hits
  - keyword hits

### Task 3.7

- [x] 實作 retrieval integration tests

完成條件：

- 測試情境至少包含：
  - exact entity query
  - alias query
  - abstract semantic query
  - mixed query

---

## Phase 4: Graph Expansion

### Task 4.1

- [x] 定義第一版 relation 權重

完成條件：

- 至少定義：
  - `REQUIRES`
  - `LEADS_TO`
  - `SIMILAR`
  - `EVIDENCE`

### Task 4.2

- [x] 實作 one-hop graph expansion

完成條件：

- 只擴一層
- 可 relation filter

### Task 4.3

- [x] 實作 expansion budget controls

完成條件：

- 可限制：
  - max expanded entities
  - max expanded chunks
  - relation allowlist

### Task 4.4

- [x] 將 graph expansion 接入 fusion pipeline

完成條件：

- expanded entity / chunk 可影響最終排序

---

## Phase 5: Prompt Adapter

### Task 5.1

- [x] 定義 `ContextPack` 結構

完成條件：

- 至少包含：
  - relevant entities
  - supporting chunks
  - expanded edges
  - active states
  - missing preconditions

### Task 5.2

- [x] 實作 prompt adapter

完成條件：

- 輸出：
  - active user states
  - relevant entities
  - retrieved chunks
  - missing preconditions
  - suggested next actions

補充：

- 已提供 `openclaw memory search` 作為最小 CLI 驗收入口（`prompt-preview` 保留為 deprecated alias）

### Task 5.3

- [x] 實作 token budget / dedupe 策略

完成條件：

- **實作 Hard Token Limit，依據優先權（Priority > Graph > Vector）自動剔除超量資料**
- prompt 不會被 graph expansion 瞬間撐爆
- 重複 entity / chunk 可被去除

### Task 5.4

- [x] 建立 prompt regression examples

完成條件：

- 至少保存：
  - chunk-only prompt
  - entity-aware prompt
  - state-aware prompt mockup

補充：

- 已有 `prompt-adapter.test.ts` 覆蓋 Phase 5 主要驗收面向

---

## Phase 6: Runtime State

### Task 6.1

- [ ] 新增 `world_states` schema migration

完成條件：

- 支援：
  - `session_id`
  - `goal_entity_id`
  - `active_states_json`
  - `completed_skills_json`
  - `blocked_by_json`

### Task 6.2

- [ ] 新增 `runtime_events` schema migration

完成條件：

- 可追蹤 success / failure / blocked / evidence 類事件

### Task 6.3

- [ ] 實作 precondition checker

完成條件：

- 可回傳：
  - `ok`
  - `missing[]`

### Task 6.4

- [ ] 實作 postcondition writeback

完成條件：

- 執行成功後能更新 active states

### Task 6.5

- [ ] 實作 runtime edge writeback

完成條件：

- 可新增：
  - `COMPLETED`
  - `BLOCKED_BY`
  - `EVIDENCE`

### Task 6.6

- [ ] 讓 retrieval 能讀 session world state

完成條件：

- active states 可影響 context 排序或提示內容

---

## Phase 7: Planner / Routing

### Task 7.1

- [ ] 定義 goal-aware ranking inputs

完成條件：

- 明確定義：
  - goal entity
  - active states
  - completed skills
  - blocked entities

### Task 7.2

- [ ] 實作 relation-aware weighting

完成條件：

- `REQUIRES` / `LEADS_TO` 權重高於 `SIMILAR`

### Task 7.3

- [ ] 實作 suggested next actions

完成條件：

- prompt adapter 可輸出 next action hints

### Task 7.4

- [ ] 建立 explainability hooks

完成條件：

- 能說明：
  - 為什麼命中這些 entity
  - 為什麼擴展到這些 chunks
  - 為什麼推薦這些下一步

---

## Cross-Cutting Tasks

### Task X.1

- [ ] 建立 sample `.ctxfst.md` 測試資料集

完成條件：

- 至少包含：
  - descriptive-only doc
  - state-heavy doc
  - relation-heavy doc
  - mixed world-model doc

### Task X.2

- [ ] 建立 migration rollback plan

完成條件：

- 每個 phase 都定義 fallback 行為

### Task X.3

- [ ] 建立 observability 指標

完成條件：

- 至少追蹤：
  - parser failures
  - validation warnings
  - entity hit rate
  - graph expansion size
  - prompt context size

### Task X.4

- [ ] 建立 benchmark queries

完成條件：

- 可比較：
  - chunk-only retrieval
  - entity-aware retrieval
  - graph-expanded retrieval

---

## MVP Checklist

如果只做 MVP，至少完成以下項目：

- [x] `.ctxfst.md` detection
- [x] parser + validator
- [x] `documents` / `entities` / `chunk_entities` schema
- [x] entity exact / alias match
- [x] entity -> chunk reverse lookup
- [x] chunk + entity fusion retrieval
- [x] prompt adapter

---

## Ready-To-Start 建議順序

第一批可以直接開工的順序：

1. Task 1.1 - 1.6
2. Task 2.1 - 2.7
3. Task 3.1 - 3.7
4. Task 5.1 - 5.4

做到這裡，OpenClaw 就已經從 chunk-only memory 進化到「原生初步支援 `CtxFST`」。
