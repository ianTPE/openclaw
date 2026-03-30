# Gap Checklist Before Fork

## 目的

本文件是給真正準備 fork `openclaw/openclaw` 並開始實作 `CtxFST` integration 前使用的檢查表。

它的用途不是再重複 spec，而是把「還需要先去 upstream repo 確認的 gap」列清楚，避免一 fork 就直接開工，結果中途才發現關鍵 extension point 根本不存在。

---

## 使用方式

建議在 fork 前，先做一輪 repo-level code reading，並把下面每個項目標記為：

- `已確認`
- `部分確認`
- `未確認`
- `不適用`

---

## A. Repo 結構與入口點

### A1

- [ ] 找到現有 memory 實作的主入口檔案

要確認：

- memory search manager 在哪裡
- memory indexer 在哪裡
- memory tool handler 在哪裡

### A2

- [ ] 找到現有 storage / migration 目錄結構

要確認：

- SQLite schema 放哪裡
- migrations 怎麼命名
- migration lifecycle 怎麼跑

### A3

- [ ] 找到 retrieval orchestration 主流程

要確認：

- vector search 在哪裡做
- keyword/FTS 在哪裡做
- 最終 context assembly 在哪裡做

---

## B. Plugin 與 Hook 現況

### B1

- [ ] 確認 `memory` plugin slot 的實際 code-level contract

要確認：

- plugin 是怎麼註冊的
- memory plugin 需要實作哪些 methods
- 是否能接管 indexing lifecycle

### B2

- [ ] 確認 `contextEngine` slot 的實際 code-level contract

要確認：

- `registerContextEngine()` 的實作位置
- assemble / compact / ingest 的參數形狀
- 是否能安全注入 state-aware context

### B3

- [ ] 確認是否存在 generic retrieval hooks

要確認：

- 是否已有 retrieval middleware / strategy pattern
- 如果沒有，最小可接受的 integration point 在哪裡

### B4

- [ ] 確認 prompt context extension points

要確認：

- 哪裡把 memory search 結果轉成 prompt context
- 是否能插入 `CtxFST` prompt adapter

---

## C. Memory Pipeline 現況

### C1

- [ ] 確認目前 memory source-of-truth 假設

要確認：

- 是否完全綁死 `MEMORY.md` / `memory/**/*.md`
- 是否已有 custom loader / additional sources 機制

### C2

- [ ] 確認 chunking pipeline 位置與可替換性

要確認：

- chunk size / overlap 是在哪裡決定
- `.ctxfst.md` 是否可跳過既有 chunking，直接 ingest frontmatter-defined chunks

### C3

- [ ] 確認 embedding pipeline 位置

要確認：

- embedding provider abstraction 在哪裡
- 是否能為 entities 新增第二種 embedding pipeline

### C4

- [ ] 確認 FTS / vector hybrid ranking 位置

要確認：

- 是否可插入 entity-aware ranking
- 是否已有 rerank or score fusion module

---

## D. Storage 與資料模型差距

### D1

- [ ] 確認現有 `chunks` schema

要確認：

- 現有欄位有哪些
- 哪些欄位可保留
- 哪些欄位需要 additive migration

### D2

- [ ] 確認是否已有 `documents` 概念

要確認：

- source file metadata 是否已存在
- 若不存在，新增 `documents` 表是否會影響既有查詢

### D3

- [ ] 確認 entity / edge / runtime state 是否完全不存在

要確認：

- 是否已有近似結構可重用
- 若沒有，新增 schema 是否會破壞既有索引流程

### D4

- [ ] 確認 reindex lifecycle

要確認：

- source file 變更時怎麼 refresh index
- 是否支援 per-document reindex
- stale row cleanup 怎麼做

---

## E. Runtime 與 Session 狀態

### E1

- [ ] 確認 session state 現況

要確認：

- OpenClaw 現在是否已有 session-scoped persistent state
- 若有，存在哪裡

### E2

- [ ] 確認 execution result writeback 機制

要確認：

- tool / agent 執行結果是否有 lifecycle hook
- 是否可在成功/失敗時寫 runtime event

### E3

- [ ] 確認多 session 隔離邏輯

要確認：

- session 是否天然隔離
- 若寫入 runtime edges，需要帶什麼 provenance

---

## F. Prompt 與 Context 組裝

### F1

- [ ] 確認 memory search 結果進 prompt 的入口點

要確認：

- memory snippets 在哪裡被組成最終模型 context

### F2

- [ ] 確認 token budget 管理位置

要確認：

- prompt budgeting 在哪裡決定
- `CtxFST` context pack 是否可沿用

### F3

- [ ] 確認是否已有 context compaction / summarization engine

要確認：

- `entities + states + chunks` 是否可能被既有 compaction 打散

---

## G. 測試與 Benchmark 基礎

### G1

- [ ] 確認現有測試框架與測試目錄

要確認：

- parser / retrieval / runtime tests 應放哪裡

### G2

- [ ] 確認是否已有 memory regression tests

要確認：

- 是否能加上 chunk-only baseline tests

### G3

- [ ] 確認 benchmark runner 是否已有基礎設施

要確認：

- 若沒有，是否需要自建 evaluation script

---

## H. 決策點

### H1

- [ ] 判斷 MVP 是先走 fork additive 還是直接 memory plugin

判斷依據：

- `memory` plugin contract 是否足夠清楚
- 是否能用 plugin 接管 indexing + retrieval

### H2

- [ ] 判斷 runtime state 是先留在 fork core 還是延後

判斷依據：

- 是否已找到 execution lifecycle hooks
- 是否能在不破壞主流程下寫入 session state

### H3

- [ ] 判斷哪些 extension points 值得 upstream

候選：

- format loader registry
- retrieval strategy registry
- prompt context hook
- runtime writeback hook

---

## Fork Ready Criteria

當以下條件大致成立時，可以視為 ready to fork：

1. 已找到 memory / retrieval / prompt 三個主入口
2. 已確認現有 storage / migration 結構
3. 已確認 `memory` plugin 與 `contextEngine` slot 的真實 contract 或至少已定位實作位置
4. 已確認 `.ctxfst.md` 會接在哪個 ingestion path
5. 已確認 entity-aware retrieval 會接在哪個 ranking path
6. 已確認 prompt adapter 會接在哪個 context assembly path

---

## 最後建議

fork 前最重要的不是再寫更多 spec，而是回答這三個問題：

1. 我到底要改哪幾個 upstream 檔案？
2. 哪些能力可以新增模組就好，哪些一定要碰 integration point？
3. 我現在是要先證明「有用」，還是已經準備證明「可產品化」？

只要這三個問題答得出來，fork 的風險會小很多。
