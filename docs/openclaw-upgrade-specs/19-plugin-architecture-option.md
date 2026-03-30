# Plugin Architecture Option

## 目的

本文件說明 `CtxFST -> OpenClaw` 整合時，為什麼短期建議先採 `fork + additive integration`，而不是一開始就全面 plugin 化，以及什麼時候應該從 fork 過渡到 plugin architecture。

---

## 先講結論

如果你的長期目標是：

> 讓 OpenClaw 變成完整的 `CtxFST semantic world model runtime`

但你短期目標只是：

> 先驗證 `CtxFST` integration 到底有沒有明顯價值

那最合理的策略是：

1. 短期：`fork + additive integration`
2. 中期：整理 generic extension points
3. 長期：`memory plugin + context engine/hook`

### 補充

這裡提到的 `memory` slot 與 `contextEngine` slot，不是純概念假設。

OpenClaw 官方文件目前已公開描述：

- `plugins.slots.memory`
- `plugins.slots.contextEngine`
- `api.registerContextEngine(...)`

參考：

- https://docs.openclaw.ai/concepts/memory
- https://docs.openclaw.ai/concepts/context-engine
- https://docs.openclaw.ai/plugins

但 memory plugin 的細部 SDK contract 仍建議直接讀 upstream repo 實作再定稿。

---

## 為什麼短期不先全面 plugin 化

### 原因 1：你現在要驗證的是價值，不是抽象層設計

最先要回答的問題不是：

- plugin API 該長什麼樣
- context hook 應該怎麼抽象

而是：

- entity-aware retrieval 有沒有更好
- alias / canonical entity hit rate 有沒有提升
- `entities + chunks` prompt context 有沒有更穩
- `state` / `relation` 值不值得真的接進 runtime

在這個階段，直接做 plugin abstraction 很容易過早設計。

### 原因 2：你還不知道哪些 hook 真的是必要的

`CtxFST` 的完整目標不只是 parser。

它最後會碰到：

- memory ingestion
- indexing
- retrieval
- prompt assembly
- runtime state
- execution writeback

如果你現在還沒跑出第一版，就很難知道：

- 哪些地方只需要 plugin
- 哪些地方需要 upstream hooks
- 哪些地方其實根本不值得抽象

### 原因 3：fork + additive integration 更容易快速做 benchmark

在 fork 中，你可以比較直接地：

- 加 parser
- 擴 schema
- 接 retrieval path
- 比 chunk-only baseline

這對驗證價值非常重要。

---

## 為什麼不是 core rewrite

雖然短期建議 fork，但不是建議魔改 core。

這裡推薦的是：

> `fork + additive integration`

不是：

> `fork + core rewrite`

兩者差很多。

### Additive Integration

- 新增 `CtxFST` parser
- 新增 `entities` / `edges` / `world_state` schema
- 新增 entity-aware retrieval path
- 新增 prompt adapter
- 盡量保留既有 chunk-only path

### Core Rewrite

- 直接改掉既有 memory flow
- 讓 `CtxFST` 成為唯一資料模型
- 改寫 retrieval 主幹
- 改掉既有 public contract

短期驗證應避免後者。

---

## 三階段建議路線

## Stage A: Value Validation

### 目標

先證明 `CtxFST` 對 OpenClaw memory 的增益是真的。

### 做法

- fork OpenClaw
- 加 `.ctxfst.md` parser
- 加 `entities` / `chunk_entities`
- 做 entity-aware retrieval
- 做 prompt adapter
- 跑 benchmark

### 驗證問題

- entity query 是否更準
- alias query 是否更穩
- semantic query 是否不退化
- prompt context 是否更有結構

### 不做的事

- 不急著做完整 planner
- 不急著做深度 graph expansion
- 不急著做完整 plugin productization

---

## Stage B: Runtime Validation

### 目標

驗證 `CtxFST` 不只是提升 retrieval，而是真的值得走向 semantic world model runtime。

### 做法

- 加 world state
- 加 precondition checking
- 加 postcondition writeback
- 加 runtime-aware context assembly

### 驗證問題

- `preconditions` / `postconditions` 是否真的有 operational value
- state-aware prompt 是否更好
- next-step hint 是否更合理

---

## Stage C: Productization

### 目標

降低長期 fork 維護成本，把已驗證有價值的能力收斂成 plugin / hook-based architecture。

### 做法

- 整理 generic extension points
- 能 upstream 的 hooks 先 upstream
- 把 `CtxFST` 收斂成：
  - memory plugin
  - context engine plugin 或 runtime hooks

### 結果

- 長期維護成本下降
- fork diff 變小
- 更容易跟 upstream 版本同步

---

## 什麼情況下應該從 fork 過渡到 plugin

當以下條件成立時，就值得從 fork 過渡到 plugin architecture：

1. parser / indexing / retrieval 已經在 fork 中跑穩
2. benchmark 已證明 entity-aware retrieval 有明顯增益
3. 你已經知道哪些 integration points 是穩定的
4. 你能區分哪些是 generic hooks、哪些是 `CtxFST` 專屬邏輯
5. 你開始覺得 upstream merge 成本在上升

這時候再抽 plugin，會比一開始硬抽來得成熟很多。

---

## plugin 化後可能的形態

### Memory Plugin

負責：

- `.ctxfst.md` ingestion
- parser / validator
- entity-aware indexing
- entity-aware retrieval

### Context Engine Plugin 或 Hook Layer

負責：

- world-state-aware context assembly
- compact / assemble 規則
- active states / missing preconditions prompt injection

### Runtime Hooks

負責：

- execution writeback
- completed / blocked runtime edges
- session world state updates

---

## 如何判斷現在適不適合 plugin-first

### 適合 plugin-first 的情況

- OpenClaw memory slot / context engine slot contract 已經很清楚
- 你只需要做格式支援與 retrieval extension
- 不需要碰太多 runtime lifecycle

### 不適合 plugin-first 的情況

- 你還不確定 memory slot contract 是否足夠
- 你還不確定 runtime state 會怎麼接
- 你要先做 benchmark 才知道值不值得投資

這時候先 fork 比較穩。

---

## 實務建議

如果你現在就要開始，我建議：

### 短期

- fork OpenClaw
- 依本 spec 做 additive integration
- 不魔改 core
- 先做 MVP benchmark

### 中期

- 把抽象邊界記錄下來
- 盤點哪些 integration points 值得 upstream

### 長期

- 逐步把 generic hooks upstream
- 把 `CtxFST` 收斂為 plugin / provider package

---

## 最後結論

> 短期先 `fork + additive integration` 是正確的，因為你現在最需要先驗證 `CtxFST` 在 OpenClaw 裡是否真的有效；等效果被 benchmark 證明後，再把穩定下來的整合點抽成 `memory plugin + context engine/hook`，才是長期最健康的路線。
