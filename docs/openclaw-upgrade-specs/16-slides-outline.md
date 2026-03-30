# OpenClaw Native CtxFST Support Slides Outline

本文件是給內部提案或技術簡報使用的 10 頁簡報大綱。

---

## Slide 1

### 標題

讓 OpenClaw 原生理解 `CtxFST`

### 副標

從 chunk-only memory 到 semantic world model runtime

### 講者重點

- 這不是單純的格式支援
- 這是記憶層升級

---

## Slide 2

### 標題

今天的 OpenClaw memory 解什麼問題

### 畫面主內容

`Markdown -> Chunk -> Vector / FTS -> Prompt`

### 講者重點

- 現有流程能做文字片段檢索
- 但主要工作單位仍是 chunk

---

## Slide 3

### 標題

問題：chunk-only memory 的天花板

### 畫面主內容

- 找得到相似文字
- 不代表看得到穩定概念
- alias / canonical entity 召回不穩
- 缺少 state 與 relation 語意

### 講者重點

- 這正是 `CtxFST` 想補的缺口

---

## Slide 4

### 標題

`CtxFST` 真正有價值的是什麼

### 畫面主內容

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- relation edges

### 講者重點

- 如果只 ingest chunks，就只吃到最表面那層

---

## Slide 5

### 標題

升級目標

### 畫面主內容

從：

`text chunk retrieval`

到：

`chunk + entity + state + relation`

### 講者重點

- 這是從記憶系統走向世界模型 runtime

---

## Slide 6

### 標題

五層架構

### 畫面主內容

- Parser
- Index
- Retrieval
- Runtime / State
- Prompt Adapter

### 講者重點

- 每層責任清楚，避免一次大改

---

## Slide 7

### 標題

MVP 先做什麼

### 畫面主內容

1. ingest `.ctxfst.md`
2. index entities
3. entity-aware retrieval
4. prompt adapter

### 講者重點

- 第一版先把 retrieval quality 做出來

---

## Slide 8

### 標題

第二階段再做什麼

### 畫面主內容

- world state
- preconditions / postconditions
- runtime writeback
- graph-aware next step hints

### 講者重點

- 這一階段才開始讓 operational metadata 真正生效

---

## Slide 9

### 標題

怎麼證明這件事有價值

### 畫面主內容

比較：

- chunk-only
- chunk + entity
- chunk + entity + graph

指標：

- entity hit rate
- alias hit rate
- Recall@K
- context quality

### 講者重點

- 不只做功能，要做 benchmark

---

## Slide 10

### 標題

結論

### 畫面主內容

> 讓 OpenClaw 原生支援 `CtxFST`，
> 核心不是換格式，
> 而是升級 memory architecture。

### 講者重點

- 先做 parser + entity-aware retrieval
- 再做 runtime state
- 最後才做 planner
