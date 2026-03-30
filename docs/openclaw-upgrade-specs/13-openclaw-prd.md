# OpenClaw CtxFST Native Support PRD

## 文件目的

本文件把 `OpenClaw` 升級為原生支援 `CtxFST` 的需求，整理成偏產品與專案提案格式的 PRD。

---

## Executive Summary

目前 OpenClaw 的記憶層若主要建立在 chunking、vector retrieval、FTS 與 prompt assembly 之上，本質上仍屬於一種 `chunk-only memory system`。

這種設計能支援文字片段檢索，但不足以原生理解 `CtxFST` 所提供的結構化世界模型資訊，例如：

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- multi-relation edges

本專案的目標，是把 OpenClaw 的記憶層從 `text chunk retrieval` 升級成 `chunk + entity + state + relation` 四層模型，使其從單純可搜尋的記憶系統，走向可觀察、可導航、可規劃、可寫回的 semantic world model runtime。

---

## Problem Statement

現況問題主要有四類：

1. 專有名詞、別名、canonical entity 的召回不穩定
2. 系統看得到 chunks，但看不到概念節點與關係
3. `preconditions` / `postconditions` / `state_refs` 沒有 runtime 可承接
4. prompt context 難以表達結構化世界模型，只能塞回扁平文字

這使得 OpenClaw 即使 ingest `.ctxfst.md`，也可能只是在格式層「支援」，而不是在語意層真正「理解」。

---

## Product Goal

讓 OpenClaw 原生支援 `CtxFST`，並在不破壞既有 chunk retrieval 能力的前提下，逐步增加：

- entity-aware retrieval
- graph-aware context expansion
- state-aware runtime memory
- structured prompt adaptation

---

## User Value

升級完成後，使用者應能得到以下價值：

- 以 entity 為中心的更準確召回
- 對 alias / shorthand / canonical names 更穩定的理解
- 對 prerequisite / next step / dependency 類 query 更好的回答
- 對 agent 任務狀態更清楚的記錄與提示
- 對記憶內容更好的可觀測性與可修正性

---

## Non-Goals

本專案第一階段不以以下事項為目標：

- 一次完成完整 autonomous planner
- 完成所有 relation 的高品質自動推理
- 用 `CtxFST` 取代所有既有 memory source formats
- 把所有 runtime 決策邏輯都綁死在 prompt 裡

---

## Users And Use Cases

### Primary Users

- 想把知識庫升級為 GraphRAG / semantic retrieval 的開發者
- 想讓 agent memory 更可 debug、可修正的系統設計者
- 想讓 skill / state / relation 能進入 runtime 的 agent builder

### Primary Use Cases

- query 專有名詞時更穩定召回相關知識
- query 某技能或工具的前置條件與下一步
- 讓 prompt context 同時看到 relevant entities 與 supporting chunks
- 根據 session world state 給出更合理的下一步提示

---

## Scope

### MVP Scope

- `.ctxfst.md` parser
- entity-aware indexing
- entity-aware retrieval
- prompt adapter

### V2 Scope

- graph expansion
- runtime state
- execution writeback

### V3 Scope

- planner / routing integration
- explainability improvements

---

## Functional Requirements

### FR1

系統必須能 ingest `.ctxfst.md` 並建立 canonical document model。

### FR2

系統必須能索引 `entities` 與 `chunk -> entity` mapping。

### FR3

系統必須在 query 階段同時利用 entity 與 chunk retrieval。

### FR4

系統必須能將 retrieval 結果組成包含 entities 與 chunks 的結構化 context pack。

### FR5

系統應支援至少一跳 graph expansion，並有 budget 控制。

### FR6

系統應支援 session-scoped world state，以承接 `preconditions` / `postconditions`。

---

## Non-Functional Requirements

### NFR1

對既有 chunk-only retrieval 不應造成明顯退化。

### NFR2

新 schema 必須支援增量重建與 source hash 比對。

### NFR3

graph expansion 必須可控，避免 prompt context explosion。

### NFR4

新設計必須保留 fallback 到 chunk-only mode 的能力。

---

## Success Metrics

### MVP 成功指標

- `.ctxfst.md` ingestion 成功率高
- entity exact / alias 命中率優於 baseline
- relevant entity + chunk prompt context 可穩定生成

### V2 成功指標

- relation-sensitive queries 的回答品質提升
- runtime state 可正確 surfaced missing preconditions

### V3 成功指標

- next-step suggestion quality 提升
- explainability 更好

---

## Risks

### Risk 1

只做 parser，不做 retrieval 升級。

結果：

- 表面支援 `CtxFST`
- 實際仍是 chunk-only memory

### Risk 2

graph expansion 無限制擴張。

結果：

- prompt 變長
- relevance 下降

### Risk 3

太早把 planner 綁進第一版。

結果：

- 範圍失控
- 難以驗證基礎層是否穩定

---

## Milestones

### Milestone 1

- parser + validator 完成

### Milestone 2

- schema migration + indexing 完成

### Milestone 3

- entity-aware retrieval 完成

### Milestone 4

- prompt adapter 完成

### Milestone 5

- runtime state 完成

### Milestone 6

- planner / routing integration 完成

---

## Launch Recommendation

建議以三段式推出：

1. Internal alpha
2. benchmarked beta
3. native support release

其中：

- alpha 驗 parser / indexing correctness
- beta 驗 retrieval quality
- native support release 才開始主打 world state 能力

---

## Related Docs

- `00-purpose-and-goals.md`
- `00.5-openclaw-current-state-analysis.md`
- `01-architecture-overview.md`
- `03-data-schema.md`
- `05-retrieval-runtime-spec.md`
- `09-migration-guide.md`
- `10-implementation-tasks-checklist.md`
- `11-test-plan.md`
- `12-benchmark-plan.md`
- `17-table-of-contents-and-doc-map.md`
- `18-fork-maintenance-strategy.md`
