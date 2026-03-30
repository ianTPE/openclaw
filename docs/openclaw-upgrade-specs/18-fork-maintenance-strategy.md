# Fork Maintenance Strategy

## 目的

本文件說明如果你 fork `openclaw/openclaw`，並在自己的 repo 裡加入 `CtxFST` 支援，該怎麼降低未來跟 upstream 升級時的維護成本。

---

## 先講結論

可以跟著 OpenClaw upstream 一起升級，但前提是：

- `CtxFST` 整合方式要盡量模組化
- fork 與 upstream 的差異要盡量集中
- 每次 upstream 更新要定期同步，不要累積太久

如果一開始是直接魔改 core memory 流程，那未來每次 upstream 大改時，很可能都會變成高成本 merge，甚至接近重構。

---

## 兩種整合路線

### 路線 A：Additive Integration

做法：

- 新增 `CtxFST` parser / loader
- 新增 entity / edge / state schema
- 新增 retrieval adapter
- 盡量保留既有 chunk-only 流程

特性：

- 比較容易跟 upstream 同步
- 差異集中在新增模組與少數 integration points
- 比較適合長期維護

### 路線 B：Core Rewrite

做法：

- 大量修改既有 memory core
- 改掉既有 retrieval 主流程
- 讓 `CtxFST` 成為唯一中心格式

特性：

- 短期看起來整合比較徹底
- 長期更容易在 upstream 升級時痛苦 merge
- 若 upstream memory architecture 有調整，風險很高

---

## 推薦策略

最推薦的是：

> 先用 Additive Integration 把 `CtxFST` 接進 OpenClaw，再逐步把可 upstream 的 interface 推回 upstream。

這樣有兩個好處：

1. 你的 fork 可先快速跑起來
2. 長期可把 fork diff 壓小

---

## 最佳實務

### 1. 保留 upstream remote

建議 repo 設定至少包含：

- `origin`: 你的 fork
- `upstream`: `openclaw/openclaw`

### 2. 差異集中在新模組

盡量把 `CtxFST` 邏輯集中在：

- `formats/ctxfst`
- `indexing/ctxfst_*`
- `retrieval/*ctxfst*`
- `prompt/ctxfst_*`

避免把邏輯散落到太多既有核心檔案。

### 3. 採 additive schema migration

例如：

- 新增 `documents`
- 新增 `entities`
- 新增 `chunk_entities`
- 新增 `entity_edges`
- 新增 `world_states`

不要直接破壞既有 `chunks` 表的既有契約。

### 4. 用 interface 而不是硬耦合

例如：

- format detector interface
- parser interface
- retrieval orchestrator interface
- prompt adapter interface

interface 穩定後，upstream 升級時比較容易局部替換。

### 5. 補齊 regression tests

每次 sync upstream 前後，至少都要能驗：

- parser 沒壞
- indexing 沒壞
- entity-aware retrieval 沒壞
- prompt adapter 沒壞

---

## 什麼情況下容易每次都重構

以下是高風險訊號：

- 直接修改大量既有 retrieval core 檔案
- 修改 upstream 公開 API 的語意
- 沒有 migration strategy
- 沒有 benchmark baseline
- 沒有 regression tests
- 很久才同步一次 upstream

這種情況下，即使不是每次都「從零重構」，也很容易每次都做高成本整修。

---

## 升級節奏建議

### 小版本同步

建議：

- 定期同步 upstream 小版本
- 每次同步後跑 regression suite

原因：

- 衝突較小
- 容易定位是哪次 upstream 變更影響了 integration

### 大版本同步

建議：

- 先讀 upstream release notes
- 先比對 memory/index/retrieval 相關 diff
- 先跑 spec-to-code impact review
- 再決定是 merge、rebase，還是先做 compatibility shim

---

## 實作上的建議邊界

### 可接受的 fork 差異

- 新增 `CtxFST` format support
- 新增 additive migrations
- 新增 entity-aware retrieval orchestration
- 新增 prompt adapter

### 應盡量 upstream 的東西

- format detection hooks
- parser registration points
- retrieval extension hooks
- prompt-context extension hooks

這些一旦 upstream 接受，你自己 fork 的差異就會明顯變小。

---

## 建議工作流

### 第一步

先在 fork 中做 MVP：

1. parser
2. entities schema
3. entity-aware retrieval
4. prompt adapter

### 第二步

整理出哪些是 generic extension points，嘗試 upstream：

- format loader registry
- retrieval pipeline hooks
- prompt context hooks

### 第三步

把 fork 特有的 `CtxFST` 細節留在你自己的模組中，把 generic hooks 盡量交回 upstream。

---

## 驗收標準

如果你要判斷目前 fork 是否健康，至少看這幾點：

1. upstream 小版本同步時，衝突是否集中在少數檔案
2. regression tests 是否能快速指出壞在哪一層
3. `CtxFST` 支援是否主要存在於新增模組，而不是散落各處
4. 新增 upstream 版本時，是否通常只需調整 integration layer，而不是重寫整套 memory layer

---

## 最後結論

> 你可以 fork OpenClaw 並加上 `CtxFST`，而且未來通常也可以跟著 upstream 升級；但前提是你要把整合做成模組化、可回退、可測試、差異集中的 additive integration。

如果這件事做對，未來多半是持續維護。

如果這件事做錯，未來就很容易變成每次升級都像重構。
