# Phase 2 Validation Checklist

## 目的

本文件定義 `Phase 2: Entity-Aware Indexing` 完成後，應如何驗證 OpenClaw 是否已將 entity layer 正確寫入 index 並可做基本 lookup。

Phase 2 的核心問題不是「查詢品質有沒有提升」，而是：

> entities 有沒有被正確寫進 index，而且可以被 name 和 alias 穩定查到。

---

## 驗收範圍

Phase 2 驗證涵蓋：

- entity persistence
- chunk-entity mapping persistence
- entity name lookup
- entity alias lookup
- reindex idempotence
- source hash / document version tracking

Phase 2 驗證不涵蓋：

- query-time fusion retrieval（→ Phase 3）
- context pack assembly（→ Phase 3）
- baseline comparison（→ Phase 3）
- graph expansion（→ Phase 4）
- prompt adapter / token budget（→ Phase 5）
- runtime state（→ Phase 6）

---

## 驗收標準總表

當以下 7 點都成立時，可視為 Phase 2 完成：

1. `entities` 能被正確寫入 index
2. `chunk_entities` mapping 正確建立
3. entity name query 能命中正確 entity
4. alias query 能命中 canonical entity
5. entity 命中後可回查相關 chunks
6. reindex 不產生重複資料，更新時可正確清理舊資料
7. indexer 已從 preconditions / postconditions 自動推斷建立 `REQUIRES` / `LEADS_TO` edges

---

## 使用的 Fixture

本 checklist 的所有 case 基於以下 fixture：

- `examples/retrieval-test.ctxfst.md`

該 fixture 包含：

- 10 entities（7 descriptive + 3 state）
- 8 chunks
- 多組 aliases
- preconditions / postconditions 完整 workflow 閉環
- 1 個 similarity trap entity（`entity:resume-template`，語意相近但 operationally 無關）

---

## A. Entity Persistence 驗證

### Case A1: Entities persisted

輸入：

- `examples/retrieval-test.ctxfst.md`

要驗證：

- `entities` 表內有正確數量的 entity records
- `id`, `name`, `type`, `aliases`, `preconditions`, `postconditions` 均正確寫入

預期結果：

- entity count = 10（`entity:fastapi`, `entity:analyze-resume`, `entity:postgresql`, `entity:vector-search`, `entity:pdf-parser`, `entity:generate-report`, `entity:resume-template`, `state:resume-uploaded`, `state:resume-parsed`, `state:analysis-complete`）
- 無重複 entity rows

### Case A2: Chunk-entity mapping persisted

要驗證：

- `chunk_entities` 中每個 chunk 與 frontmatter 的 `entities[]` 對應一致

預期結果：

- `chunk:fastapi-service` 對到 `entity:fastapi`, `entity:postgresql`
- `chunk:resume-workflow` 對到 `entity:analyze-resume`, `entity:pdf-parser`
- `chunk:vector-indexing` 對到 `entity:vector-search`, `entity:postgresql`
- `chunk:pdf-extraction` 對到 `entity:pdf-parser`
- `chunk:api-endpoints` 對到 `entity:fastapi`
- `chunk:search-ranking` 對到 `entity:vector-search`
- `chunk:report-generation` 對到 `entity:generate-report`
- `chunk:resume-template-guide` 對到 `entity:resume-template`

### Case A3: Source hash and document version persisted

要驗證：

- `documents` 表中有對應 record
- `source_hash` 已計算並寫入
- `document_version` 值為 `"1.0"`

### Case A4: Auto-inferred edges from preconditions / postconditions

要驗證：

- indexer 已從 entities 的 `preconditions` 自動建立 `REQUIRES` edges
- indexer 已從 entities 的 `postconditions` 自動建立 `LEADS_TO` edges

預期結果（基於 `retrieval-test.ctxfst.md`）：

- `entity:analyze-resume --REQUIRES--> state:resume-uploaded`
- `entity:analyze-resume --LEADS_TO--> state:resume-parsed`
- `entity:pdf-parser --REQUIRES--> state:resume-uploaded`
- `entity:pdf-parser --LEADS_TO--> state:resume-parsed`
- `entity:generate-report --REQUIRES--> state:resume-parsed`
- `entity:generate-report --LEADS_TO--> state:analysis-complete`
- `entity_edges` 表中至少有 6 條 auto-inferred static edges

備註：

- 此功能為 Phase 4 Graph Expansion 的必要前置
- 若此步未在 Phase 2 完成，Phase 4 將無法驗收

---

## B. Reindex 驗證

### Case B1: Reindex idempotence

要驗證：

- 同一份 `.ctxfst.md` 重跑 indexing 不會產生重複 entity 或 mapping rows
- entity count 和 chunk_entities count 前後一致

### Case B2: Update cleanup

情境：

- 修改 fixture（刪除某些 entities 或 chunks），再重跑 ingestion

要驗證：

- 舊的 mapping 和 orphaned entity 能被正確清除或覆寫
- 不殘留過期資料

### Case B3: Source hash change detection

要驗證：

- source 內容未變更時，reindex 可跳過或快速結束
- source 內容變更後，source hash 更新，觸發完整 reindex

---

## C. Entity Lookup 驗證

### Case C1: Exact entity match

查詢例：

- `FastAPI`
- `Analyze Resume`
- `PostgreSQL`

要驗證：

- 能命中正確 canonical entity
- `matchType = exact`

### Case C2: Alias match

查詢例：

- `fast-api`（→ `entity:fastapi`）
- `resume analysis`（→ `entity:analyze-resume`）
- `pg`（→ `entity:postgresql`）
- `semantic search`（→ `entity:vector-search`）

要驗證：

- 能命中正確 canonical entity
- `matchType = alias`

### Case C3: Case-insensitive match

查詢例：

- `FASTAPI`
- `fastapi`
- `Fastapi`

要驗證：

- entity 搜尋對大小寫不敏感，皆能命中 `entity:fastapi`

### Case C4: Unknown entity query

查詢例：

- 一個 fixture 裡不存在的專有名詞（例如 `Django`）

要驗證：

- 不應錯誤命中無關 entity
- 應回傳空或低信心結果

---

## D. Entity-to-Chunk Reverse Lookup 驗證

### Case D1: Framework entity to chunks

查詢例：

- `entity:fastapi`

要驗證：

- 能回查 `chunk:fastapi-service` 和 `chunk:api-endpoints`

### Case D2: Tool entity to chunks

查詢例：

- `entity:pdf-parser`

要驗證：

- 能回查 `chunk:resume-workflow` 和 `chunk:pdf-extraction`

### Case D3: Multi-chunk entity

查詢例：

- `entity:postgresql`

要驗證：

- 能回查 `chunk:fastapi-service` 和 `chunk:vector-indexing`

---

## 建議驗收輸出格式

若要做 Phase 2 CLI 驗收入口，建議輸出格式至少包含：

```json
{
  "document_id": "retrieval-test",
  "entity_count": 10,
  "chunk_count": 8,
  "chunk_entity_mappings": 11,
  "lookup_result": {
    "query": "fast-api",
    "matched_entity": "entity:fastapi",
    "match_type": "alias",
    "reverse_chunks": ["chunk:fastapi-service", "chunk:api-endpoints"]
  }
}
```

---

## 建議驗收指令

```bash
openclaw memory validate-index examples/retrieval-test.ctxfst.md
openclaw memory entity-lookup "FastAPI"
openclaw memory entity-lookup "fast-api"
openclaw memory entity-lookup "Django"
```

如果暫時沒有 CLI，也至少要有 integration tests 覆蓋以上 case。

---

## 最小測試清單

Phase 2 至少要有以下測試：

- [ ] entities persisted with correct count and fields
- [ ] chunk_entities mapping matches fixture
- [ ] source hash and document version persisted
- [ ] reindex idempotence (no duplicates)
- [ ] update cleanup (orphaned data removed)
- [ ] source hash change detection works
- [ ] exact entity name lookup works
- [ ] alias lookup works
- [ ] case-insensitive lookup works
- [ ] unknown entity query returns empty
- [ ] entity -> chunk reverse lookup works (single chunk)
- [ ] entity -> chunk reverse lookup works (multi chunk)
- [ ] auto-inferred REQUIRES edges from preconditions
- [ ] auto-inferred LEADS_TO edges from postconditions
- [ ] entity_edges count matches expected (at least 6)

---

## 最後結論

如果你做完 Phase 2，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在已經能把 `.ctxfst.md` 的 entities 正確寫進 index，可以用 name、alias、case-insensitive 方式穩定查到它們，能從 entity 反查到所有相關 chunks，而且 indexer 已從 preconditions / postconditions 自動建立了 graph edges。

這句話成立，Phase 2 才算真的完成。
