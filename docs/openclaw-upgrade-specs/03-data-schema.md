# Data Schema

## 設計原則

OpenClaw 的 `CtxFST` storage schema 至少要能表達四種核心資產：

- document
- chunk
- entity
- edge

如果要吃到 operational metadata 的紅利，還需要：

- world state
- runtime events

---

## Documents

### Recommended Table

```text
documents(
  id,
  source_path,
  title,
  format,
  source_hash,
  document_version,
  ingested_at,
  updated_at,
  metadata_json
)
```

### 說明

- `format`: 例如 `markdown`, `ctxfst`
- `source_hash`: 用於增量重建與變更偵測
- `document_version`: 對應 source 文檔版本
- `ingested_at`, `updated_at`: storage-managed timestamps，不屬於 parser canonical model 必填欄位

---

## Chunks

### Recommended Table

```text
chunks(
  id,
  document_id,
  content,
  context,
  tags_json,
  state_refs_json,
  priority,
  version,
  created_at,
  embedding_vector,
  metadata_json
)
```

### 最小必要欄位

- `id`
- `document_id`
- `content`
- `context`

### 建議欄位

- `tags_json`
- `state_refs_json`
- `priority`
- `version`

### 邊界說明

- `embedding_vector` 屬於 storage/index layer 欄位，不屬於 parser canonical model 的必要欄位
- canonical chunk model 應關注語意內容；embedding 與 FTS token 屬於衍生索引資料

---

## Entities

### Recommended Table

```text
entities(
  id,
  document_id,
  name,
  type,
  aliases_json,
  preconditions_json,
  postconditions_json,
  related_skills_json,
  metadata_json
)
```

### 最小必要欄位

- `id`
- `name`
- `type`

### 建議欄位

- `aliases_json`
- `preconditions_json`
- `postconditions_json`

### `related_skills_json` 語意

- 內容應為 skill artifact identifier，例如 `skills/analyze-resume/SKILL.md`
- 不應填 entity ID
- 不應作為隱式 graph edge 使用
- 若未來需要 skill-to-entity graph，應另建顯式 edge 或 mapping

---

## Chunk-Entity Mapping

### Recommended Table

```text
chunk_entities(
  chunk_id,
  entity_id,
  mention_role,
  confidence
)
```

### 說明

- `mention_role` 可保留日後擴充，例如 `primary`, `secondary`, `state_ref`
- MVP 可只需要 `chunk_id`, `entity_id`

---

## Entity Edges

### Recommended Table

```text
entity_edges(
  id,
  source_id,
  target_id,
  relation,
  document_id,
  source_hash,
  score,
  confidence,
  timestamp,
  status,
  result_summary,
  metadata_json
)
```

### Relation Examples

- `SIMILAR`
- `REQUIRES`
- `LEADS_TO`
- `EVIDENCE`
- `IMPLIES`
- `COMPLETED`
- `BLOCKED_BY`

### Canonical Relation Definitions

| Relation | Directed | Category | Meaning |
|----------|----------|----------|---------|
| `SIMILAR` | No | static/inferred | Semantic similarity or neighborhood |
| `REQUIRES` | Yes | static/inferred | Source depends on target prerequisite |
| `LEADS_TO` | Yes | static/inferred | Source causally or procedurally leads to target |
| `EVIDENCE` | Yes | runtime/manual | Source supports or evidences target |
| `IMPLIES` | Yes | manual | Source logically entails target |
| `COMPLETED` | Yes | runtime | Actor or action completed target |
| `BLOCKED_BY` | Yes | runtime | Source is blocked by target |

### Relation Notes

- `SIMILAR` 不建議作為 planner 的主要路徑依據
- `REQUIRES` 與 `LEADS_TO` 應被視為較高價值的 operational edges
- runtime relations 應保留 session / timestamp / provenance

### 權重建議

- `REQUIRES`, `LEADS_TO` > `SIMILAR`
- runtime relations 應保留 timestamp 與 status

### 主鍵與唯一性建議

- `id` 作為 primary key
- static/inferred edges 建議加 unique constraint：
  - `(source_id, target_id, relation, document_id)`
- runtime edges 不應假設唯一，因為同一對節點可能在不同 session / timestamp 產生多筆事件

### provenance 與 stale edge 清理

- `document_id` 與 `source_hash` 用於追蹤 edge 來源
- reindex 某 document 時，應先移除該 document 舊的 static/inferred edges，再寫入新版本
- runtime edges 應與 document-derived edges 分開處理，不應在文件 reindex 時被整批清除

---

## World State

### Recommended Table

```text
world_states(
  session_id,
  goal_entity_id,
  active_states_json,
  completed_skills_json,
  blocked_by_json,
  current_subgraph_json,
  updated_at
)
```

### 說明

- `goal_entity_id`: 目前任務目標
- `active_states_json`: 當前成立的 state entities
- `completed_skills_json`: 已完成 skills 與結果
- `blocked_by_json`: 阻塞原因

---

## Runtime Events

### Recommended Table

```text
runtime_events(
  id,
  session_id,
  event_type,
  entity_id,
  related_entity_id,
  payload_json,
  created_at
)
```

### 用途

- audit trail
- explainability
- replay
- debuggable memory

---

## Canonical Entity Types

### Descriptive

- `skill`
- `tool`
- `library`
- `framework`
- `platform`
- `database`
- `architecture`
- `protocol`
- `concept`
- `domain`
- `product`

### Operational

- `state`
- `action`
- `goal`
- `agent`
- `evidence`

---

## Schema Notes

1. Parser 與 storage 都必須容忍未來新增欄位。
2. `document_id` 是否掛在 entity 上，可視是否允許 cross-document canonical merge 決定。
3. 若未做全域 entity merge，MVP 先採 document-local entity catalog 即可。
4. 跨文件 canonical merge 應視為 v2+ 能力；MVP 不應隱含自動 merge。

---

## Cross-Document Entity Merge

### MVP

- 採 document-local entity catalog
- 若兩份文件都出現 `entity:fastapi`，預設視為不同 document scope 下的同名 canonical ID，不自動做 global merge pipeline

### 後續方向

若要支援 cross-document merge，建議新增：

- `global_entities`
- `document_entities`
- `entity_aliases`

並以顯式 merge job 或 admin-reviewed normalization 流程處理，而不是在 parser 階段隱式合併。
