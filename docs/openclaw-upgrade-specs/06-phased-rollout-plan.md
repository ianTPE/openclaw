# Phased Rollout Plan

## 原則

不要一次大改 OpenClaw。

建議按價值密度與風險分成幾個階段。

---

## Phase 0: Spec Alignment

目標：

- 確認 OpenClaw memory team 對 `CtxFST` 欄位語意的一致理解
- 確認 relation enum、entity types、state model 的最小集合

交付：

- 本 spec 目錄
- parser contract
- storage schema draft

---

## Phase 1: Parser MVP

目標：

- 可 ingest `.ctxfst.md`
- 可輸出 canonical document model

交付：

- format detection
- frontmatter + body chunk parser
- validation report

成功條件：

- 任何合法 `.ctxfst.md` 都可被可靠讀取

---

## Phase 2: Entity-Aware Indexing

目標：

- 在既有 chunk index 之外加入 entity layer

交付：

- entities table
- chunk_entities table
- basic entity lookup API
- source hash / document version

成功條件：

- query 時可由 entity name / alias 命中 entity records

---

## Phase 3: Entity-Aware Retrieval

目標：

- query 同時利用 entity 與 chunk

交付：

- direct entity match
- entity -> chunk reverse lookup
- vector chunk retrieval
- context pack assembly

成功條件：

- 專有名詞、縮寫、明確概念 query 的召回品質明顯提升

---

## Phase 4: Graph Expansion

目標：

- 讓 retrieval 開始理解 relation，而不是只有 chunk

交付：

- one-hop graph expansion
- relation weights
- expansion budget controls

成功條件：

- `REQUIRES` / `LEADS_TO` 類 query 可補到純向量難召回內容

---

## Phase 5: Prompt Adapter

目標：

- 讓模型看到整理後的世界模型摘要

交付：

- structured prompt context builder
- token budget rules
- dedupe / ranking logic

成功條件：

- prompt 不再依賴原始 schema dump

---

## Phase 6: Runtime State

目標：

- 啟用 `preconditions` / `postconditions` / `state_refs`

交付：

- world state persistence
- execution precheck
- execution writeback
- runtime edges / events

成功條件：

- agent 執行結果可回饋到後續 retrieval 與 routing

---

## Phase 7: Planner And Routing

目標：

- 讓 OpenClaw 從 entity-aware retrieval 進一步長成 state-aware runtime

交付：

- goal-aware routing
- relation-aware weighting
- explainable next action suggestions

成功條件：

- 系統可以根據 state 與 relation 提供更合理的下一步

---

## MVP 定義

如果資源有限，最小可行版只做：

1. `ctxfst parser`
2. `entity-aware indexing`
3. `entity-aware retrieval`
4. `prompt adapter`

這樣就已經可以宣稱：

> OpenClaw 已原生初步支援 `CtxFST`

---

## 風險提示

### 風險 1: 只加 parser，不改 retrieval

結果：

- 表面支援 `CtxFST`
- 實際仍是 chunk-only memory

### 風險 2: graph expansion 無限制

結果：

- context explosion
- prompt 品質下降

### 風險 3: 太早把 planner 綁進第一版

結果：

- implementation complexity 爆炸
- 難以驗證每層責任

---

## 建議驗收順序

1. 能讀
2. 能索引
3. 能查到 entity
4. 能把 entity 和 chunks 一起送進 prompt
5. 再做 runtime state
