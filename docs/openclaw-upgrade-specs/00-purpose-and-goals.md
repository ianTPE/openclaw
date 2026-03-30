# Purpose And Goals

## 背景

目前 OpenClaw 若以傳統 memory/index 設計為主，核心能力通常是：

- Markdown source ingestion
- chunking
- vector retrieval
- FTS / keyword retrieval
- prompt context assembly

這套設計足以支援「文字片段檢索」，但不足以原生理解 `CtxFST`。

因為 `CtxFST` 的價值不只在 `content`，而在以下結構：

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- multi-relation edges

也就是說，若 OpenClaw 仍只把文件視為 chunk 集合，那它即使能讀 `.ctxfst.md`，也還不能算真正支援 `CtxFST`。

---

## 升級目的

本升級的主要目的有四個：

1. 讓 OpenClaw 原生 ingest `.ctxfst.md`，而不是把它當普通 Markdown。
2. 讓 retrieval 從 chunk-only 升級成 chunk + entity aware retrieval。
3. 讓 runtime 能讀懂 state 與 operational metadata。
4. 讓 prompt context 反映世界模型摘要，而不是原始 schema dump。

---

## 產品層價值

升級後的 OpenClaw 應該具備以下價值：

- 更好的專有名詞召回能力
- 更好的概念導向檢索
- 可以沿 graph relation 擴展 context
- 可以解釋為什麼某段記憶與某個任務有關
- 可以把記憶從黑箱變成可觀察、可修正、可重建的 artifact
- 往 planner / routing / agent state 管理延伸時不需要重做底層模型

---

## 非目標

本升級不以以下事項為第一階段目標：

- 直接做完整 autonomous planner
- 一次完成所有 relation 類型的高品質自動推斷
- 用 `CtxFST` 取代 OpenClaw 既有所有 memory format
- 在 parser 階段就做重度 LLM augmentation
- 把所有 world model 邏輯直接塞進 prompt 而不做結構化存取

---

## 成功定義

當以下條件成立時，可視為達成「原生初步支援 `CtxFST`」：

1. OpenClaw 可匯入 `.ctxfst.md`
2. 系統可同時索引 `chunks` 與 `entities`
3. query 流程可同時利用 entity match 與 chunk retrieval
4. prompt context 可包含 relevant entities 與 supporting chunks

當以下條件成立時，可視為達成「semantic world model runtime 基礎版」：

1. runtime 具備 `goal` / `active_states` / `completed` / `blocked_by`
2. skill execution 前會檢查 `preconditions`
3. skill execution 後會寫入 `postconditions`
4. runtime edge 可持續更新並被後續檢索與規劃使用
