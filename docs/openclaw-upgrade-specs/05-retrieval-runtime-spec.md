# Retrieval And Runtime Spec

## 目標

把 OpenClaw 的查詢與執行模型從：

- `query -> top-k chunks`

升級成：

- `query -> entity-aware retrieval -> graph-aware context -> runtime-aware prompt`

---

## Retrieval Pipeline

### 建議流程

```text
query
  -> entity extraction / direct entity match
  -> chunk vector retrieval
  -> graph expansion
  -> fusion / rerank
  -> context pack
  -> prompt adapter
```

---

## Step 1: Entity Candidate Generation

方法可依序分三類：

1. exact match on entity name
2. alias match
3. optional LLM/entity extraction

MVP 至少做到前兩項。

---

## Step 2: Chunk Retrieval

chunk retrieval 仍保留既有價值，因為 chunk 是詳細上下文載體。

查詢來源可包含：

- vector search
- FTS / keyword search
- entity -> chunk reverse lookup

---

## Entity Embedding Strategy

MVP 建議不要一開始就做複雜的 aggregate embedding。

### MVP representation text

entity 向量化時，建議使用以下 representation text：

```text
name + type + aliases
```

例如：

```text
FastAPI | framework | fast-api
```

### v2 optional strategy

若 entity retrieval 需要更強語意，可再加入：

- top supporting chunk contexts
- short generated description

但這應視為後續優化，不應擋住 MVP。

---

## Step 3: Graph Expansion

當 query 命中 entity 後，可沿 entity graph 擴展一層。

### 建議 relation 優先級

1. `REQUIRES`
2. `LEADS_TO`
3. `EVIDENCE`
4. `SIMILAR`

### 控制原則

- 預設只擴一層
- 設置 relation-specific weight
- 設置 max expanded entities / chunks
- 避免 context explosion

---

## Step 4: Fusion And Ranking

合併來源包括：

- direct entity hit
- entity-derived chunks
- vector chunks
- graph-expanded chunks

可採用：

- weighted score fusion
- RRF
- lightweight rerank

---

## Context Pack 結構

Retrieval 輸出不應只是 chunk list，應至少包含：

```text
ContextPack {
  relevant_entities[]
  supporting_chunks[]
  expanded_edges[]
  active_states[]
  missing_preconditions[]
  suggested_next_actions[]
}
```

---

## `state_refs` Semantics

`state_refs` 的預設語意應定義為：

> 這個 chunk 與哪些 state entities 高度相關，可作為 state-aware retrieval 的 relevance anchor。

### 這代表什麼

- `state_refs` 預設是 retrieval/ranking signal
- 它不是硬性 gating condition
- 它不代表「這些 state 必須 active 才能讀這個 chunk」

### 預設行為

- 若 query 或 session world state 命中某 active state，相關 `state_refs` chunks 可被加權提升
- 若沒有對應 active state，這些 chunks 仍可被召回

### 若未來需要 hard filtering

若要表達「只有在某 state 成立時才 relevant」，應另設更明確欄位，例如：

- `required_states`
- 或 runtime policy rule

MVP 不建議把 `state_refs` 同時拿來做 tagging 與 hard gating。

---

## Runtime State

若要吃到 `preconditions` / `postconditions` 的紅利，就需要 session-scoped world state。

### 最小 world state

```text
WorldState {
  session_id
  goal
  active_states[]
  completed_skills[]
  blocked_by[]
}
```

---

## `preconditions` / `postconditions` Value Domain

`preconditions` 與 `postconditions` 的值應為 state entity ID，例如 `state:markdown-proficient`、`state:parser-ready`。

### 為什麼要求 entity ID

- runtime `PreconditionChecker` 需要拿 `preconditions[]` 去比對 `WorldState.activeStates[]`
- 若 preconditions 是自由字串（如 `knowledge_of_markdown`），而 activeStates 裡放的是 entity ID（如 `state:markdown-proficient`），兩者無法自動 match
- 用 entity ID 確保 preconditions、postconditions、state_refs、activeStates 四者共用同一套 ID namespace

### Canonicalization 建議

- parser canonicalization 階段，應將 preconditions / postconditions 值正規化為 lowercase kebab-case entity ID
- 若值不符合 `state:*` 格式，validator 應發出 warning（非 fatal），提醒作者補上對應 state entity

### MVP 容忍度

- MVP 階段，runtime checker 先做 exact string match
- 若 precondition 值不在任何 entity ID 中，仍可標記為 missing，不應 crash
- v2 再考慮強制要求所有 preconditions / postconditions 值必須對應已定義的 state entity

---

## Execution Policy

### 執行前

- 檢查 skill/entity 所需 `preconditions`
- 若缺失，標記 missing preconditions
- 視策略決定阻擋、降權或提示

### 執行後

- 成功時寫入 `postconditions`
- 建立 `COMPLETED` edge 或 runtime event
- 失敗時建立 `BLOCKED_BY` event / edge

---

## Concurrency And Multi-Session Notes

MVP 應先把 `world state` 視為 session-scoped，而不是 global shared state。

### 原則

- `world_states` 以 `session_id` 為主鍵或主要查詢鍵
- runtime writeback 預設只影響當前 session state
- runtime edges 應保留 `session_id` 或等價 provenance

### 這代表什麼

- 兩個不同 session 可各自擁有不同 `active_states`
- `COMPLETED` / `BLOCKED_BY` 不應默默覆蓋其他 session 的 runtime 結果
- 若未來需要 shared team-level state，應另設 global state layer，不應在 MVP 隱含共享

---

## Prompt Adapter

Prompt adapter 的責任不是直接塞 schema，而是做摘要。

### 建議輸出區塊

- active user states
- relevant entities
- retrieved chunks
- missing preconditions
- suggested next actions
- evidence / completion summary

### 原則

- 先給 state 與 entities，再給 supporting chunks
- chunk 只保留高相關內容
- 避免重複 chunk 與重複 entity

### Token budget 建議

MVP 可先用以下參考值：

- total injected memory context: 1200-1800 tokens
- relevant entities summary: 150-300 tokens
- missing preconditions / next actions: 80-150 tokens
- supporting chunks: 800-1300 tokens
- expanded graph / relation summary: 100-250 tokens

### 數量上限建議

- relevant entities: 3-8
- supporting chunks: 3-6
- expanded edges: 3-10

以上是預設建議值，實際數字可依模型 context budget 再調整。
- **強制執行 Hard Token Limit (硬上限)**：在 ContextPack 組裝時，依據優先級（例如：活躍狀態 Priority > Graph 一跳關聯 > Vector 語意補充）自動剔除超量資料，防止 Context 被熱門節點的擴展（如單一實體連著 20 個 chunks）瞬間撐爆。

---

## MVP Scope

MVP 只要求以下三件事：

1. query 同時檢索 entities 與 chunks
2. prompt 組裝時同時輸出 relevant entities 與 chunks
3. graph expansion 最多一層，且只用少數高價值 relation

---

## v2 Scope

第二階段再加入：

- full runtime world state
- execution writeback
- state-aware reranking
- planner / routing integration
