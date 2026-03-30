# Benchmark Plan

## 目的

本文件定義如何驗證 OpenClaw 升級到 `CtxFST` 原生支援後，是否真的比 chunk-only memory 更好。

重點不是追求單一分數，而是量化這些升級是否帶來可觀察的 retrieval quality improvement。

---

## Benchmark 問題

我們主要要回答三個問題：

1. entity-aware retrieval 是否比 chunk-only retrieval 更容易召回正確內容？
2. graph expansion 是否有幫助，而不是只把 context 撐爆？
3. runtime state 是否能提升任務相關性，而不是只增加系統複雜度？

---

## 比較組

### Baseline A

- chunk-only vector retrieval

### Baseline B

- chunk-only vector + keyword retrieval

### Variant C

- chunk + entity retrieval

### Variant D

- chunk + entity + graph expansion

### Variant E

- chunk + entity + graph expansion + runtime state

---

## Query Sets

### Query Set 1: Exact Entity Queries

例子：

- `FastAPI`
- `PostgreSQL`
- `Kubernetes`

目標：

- 驗證 entity direct hit 能否提升精準召回

### Query Set 2: Alias Queries

例子：

- `K8s`
- `JS`
- `PG`

目標：

- 驗證 alias normalization 與 canonical entity lookup

### Query Set 3: Semantic Queries

例子：

- 不明講專有名詞，只描述需求或概念

目標：

- 驗證 vector retrieval 仍有保留價值

### Query Set 4: Mixed Queries

例子：

- 同時含 entity 名稱與抽象需求

目標：

- 驗證 entity + vector fusion

### Query Set 5: Relation-Sensitive Queries

例子：

- 查 prerequisite
- 查 next step
- 查 dependency

目標：

- 驗證 `REQUIRES` / `LEADS_TO` 類 relation 的增益

### Query Set 6: State-Sensitive Queries

例子：

- 根據當前 active states 問下一步

目標：

- 驗證 runtime state 對 relevance 的增益

---

## 評估指標

### Retrieval Metrics

- Recall@K
- Precision@K
- MRR
- nDCG

### Entity Metrics

- Entity hit rate
- Alias hit rate
- Canonical resolution accuracy

### Graph Metrics

- Useful expansion rate
- Expansion noise rate
- Expansion size

### Prompt Metrics

- Context pack token size
- Redundancy rate
- Supporting evidence coverage

### Runtime Metrics

- Missing preconditions surfaced rate
- Correct next-step suggestion rate

---

## Annotation Plan

每個 benchmark query 應標註：

- relevant entities
- relevant chunks
- optional useful relations
- optional required states

若資源有限，至少先做：

- relevant entities
- relevant chunks

---

## 評估方式

### Offline Retrieval Evaluation

輸入：

- benchmark queries
- labeled relevant chunks/entities

輸出：

- 各 variant 的 retrieval metrics

### Prompt Quality Review

人工審查：

- prompt 是否過長
- prompt 是否有重複
- prompt 是否保留了關鍵 entities 與 supporting chunks

### Task-Level Review

在 stateful queries 上人工審查：

- suggested next actions 是否合理
- missing preconditions 是否有正確 surfaced

---

## 預期結果

### 對 Exact / Alias Queries

預期：

- Variant C 以上明顯優於 Baseline A/B

### 對 Semantic Queries

預期：

- Baseline A/B 不應被明顯打敗
- Variant C/D 至少維持相近水準

### 對 Relation Queries

預期：

- Variant D 優於 A/B/C

### 對 State Queries

預期：

- Variant E 才能展現真正優勢

---

## Failure Signals

若出現以下現象，代表升級方向需要調整：

- entity-aware retrieval 讓 semantic query 顯著退化
- graph expansion 導致 prompt 膨脹但無實際增益
- alias hit rate 很低
- runtime state 引入後，next-action suggestions 仍無改善

---

## Benchmark Data Requirements

至少準備：

- 30 條 exact entity / alias queries
- 30 條 semantic queries
- 20 條 relation-sensitive queries
- 20 條 state-sensitive queries

總量建議：

- 80 到 120 條 queries

---

## 最小可行 Benchmark

若時間有限，先做三組：

1. exact entity
2. alias
3. semantic

只比較：

- Baseline B
- Variant C
- Variant D

---

## Benchmark 輸出建議

最終至少輸出三種結果：

1. 指標表格
2. 幾組 representative query case study
3. prompt context before/after 範例
