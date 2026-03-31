# Phase 3 Validation Checklist

## 目的

本文件定義 `Phase 3: Entity-Aware Retrieval` 完成後，應如何驗證 OpenClaw 是否已從「只會索引 entity」真正走到「會在查詢時利用 entity layer 改善結果」。

如果 Phase 2 的核心是：

> entities 有沒有被正確寫進 index，能不能被 lookup

那 Phase 3 的核心就是：

> query-time retrieval 有沒有真的把 entity layer 用起來，和 chunk retrieval 融合後，結果比 chunk-only baseline 更好。

---

## 對應範圍

本文件對應 `06-phased-rollout-plan.md` 的：

- `Phase 3: Entity-Aware Retrieval`

這一階段預期已完成：

- direct entity match（query-time）
- entity -> chunk reverse lookup（query-time）
- vector chunk retrieval
- entity + chunk fusion / ranking
- context pack assembly

Phase 3 仍不涵蓋：

- graph expansion（→ Phase 4）
- prompt adapter / token budget（→ Phase 5）
- runtime state writeback（→ Phase 6）
- planner / routing（→ Phase 7）

---

## 前置條件

Phase 3 的所有 case 假設 Phase 2 已通過驗收，即：

- entities 已正確 persist
- chunk_entities mapping 正確
- entity name / alias lookup 可工作

---

## 使用的 Fixture

本 checklist 的所有 case 基於以下 fixture：

- `examples/retrieval-test.ctxfst.md`

該 fixture 包含：

- 10 entities（7 descriptive + 3 state）
- 8 chunks
- 多組 aliases（如 `fast-api`, `pg`, `semantic search`, `resume analysis`, `report generation`）
- 完整 workflow 閉環：`state:resume-uploaded` → `entity:analyze-resume` → `state:resume-parsed` → `entity:generate-report` → `state:analysis-complete`
- 1 個 similarity trap entity（`entity:resume-template`）

---

## 驗收標準總表

當以下 8 點都成立時，可視為 Phase 3 完成：

1. exact entity queries 可在 query-time 穩定命中正確 entities
2. alias queries 可在 query-time 穩定命中 canonical entities
3. entity-hit 後能穩定召回 supporting chunks
4. entity 與 vector/keyword retrieval 可正常融合
5. semantic-only queries 沒有明顯退化
6. context pack 已包含 relevant entities 與 supporting chunks
7. query ranking 對 exact / alias hit 合理偏好
8. 相較 chunk-only baseline，entity-aware retrieval 有可觀察增益

---

## A. Query-Time Entity Match 驗證

### Case A1: Exact entity query

查詢例：

- `FastAPI`
- `Analyze Resume`
- `PostgreSQL`

要驗證：

- direct entity match 在 query-time 被觸發
- 命中正確 canonical entity
- `matchType = exact`

預期結果：

- `entity:fastapi` / `entity:analyze-resume` / `entity:postgresql` 出現在 relevant entities 前列

### Case A2: Alias query

查詢例：

- `fast-api`（→ `entity:fastapi`）
- `resume analysis`（→ `entity:analyze-resume`）
- `pg`（→ `entity:postgresql`）
- `semantic search`（→ `entity:vector-search`）

要驗證：

- alias match 在 query-time 被觸發
- canonical entity 被正確解析
- `matchType = alias`

### Case A3: No false-positive entity hit

查詢例：

- `Django`（fixture 中不存在）

要驗證：

- 不應錯誤命中無關 entity
- 若有低信心候選，不應壓過真正相關的 chunk result

---

## B. Entity-Derived Chunk Retrieval 驗證

### Case B1: Framework entity -> supporting chunks

查詢例：

- `FastAPI`

要驗證：

- 命中 `entity:fastapi`
- 可回查 `chunk:fastapi-service` 和 `chunk:api-endpoints`
- 這些 chunks 在最終結果中排序合理

### Case B2: Skill entity -> supporting chunks

查詢例：

- `Analyze Resume`

要驗證：

- 命中 `entity:analyze-resume`
- 可回查 `chunk:resume-workflow`

### Case B3: Multi-entity query

查詢例：

- `FastAPI resume parsing`

要驗證：

- 可命中多個 relevant entities（`entity:fastapi`, `entity:analyze-resume` 或 `entity:pdf-parser`）
- supporting chunks 會整合而不是互相覆蓋

---

## C. Fusion Retrieval 驗證

### Case C1: Entity + vector fusion

查詢例：

- `FastAPI parsing workflow`

要驗證：

- entity-aware path 命中 `entity:fastapi`
- vector retrieval 同時召回語意相關 chunks（如 `chunk:resume-workflow`）
- 最終結果同時包含 entity-derived chunks 與 vector-derived chunks

### Case C2: Entity + keyword fusion

查詢例：

- `resume parsed state`

要驗證：

- keyword/FTS path 可與 entity path 共存
- entity hit 不破壞 keyword 命中

### Case C3: Deduplication

要驗證：

- 同一個 chunk 若同時被 entity、vector、keyword 路徑命中，最終只保留一份
- 可保留來源資訊或融合分數

---

## D. Semantic Query Non-Regression 驗證

### Case D1: Semantic-only query

查詢例：

- `how the system extracts text from uploaded documents`

要驗證：

- 沒有 direct entity hit 時，vector/keyword retrieval 仍能正常工作
- 應召回 `chunk:pdf-extraction` 或 `chunk:resume-workflow` 等語意相關結果
- entity-aware retrieval 不應讓 semantic-only query 顯著退化

### Case D2: Indirect concept query

查詢例：

- `backend service for processing API requests`

要驗證：

- 即使 query 沒直接說 `FastAPI`，系統也應保留原本的 semantic recall 能力

---

## E. Context Pack 驗證

### Case E1: Relevant entities present

要驗證：

- context pack 不只是 chunks
- relevant entities 會被顯式輸出

### Case E2: Supporting chunks present

要驗證：

- context pack 中 supporting chunks 與 relevant entities 能對得起來

### Case E3: Stable ordering

要驗證：

- exact entity hit 與其 supporting chunks，不應被低相關 vector hit 壓到下面

### Case E4: Output shape stability

要驗證：

- 同一個 query 在相同 index 與相同設定下，多次執行 context pack shape 應一致

---

## F. Baseline Comparison 驗證

### 比較組

至少比較：

- Baseline: chunk-only vector + keyword retrieval
- Variant: entity-aware retrieval（entity match + entity-derived chunks + vector + keyword fusion）

### Case F1: Exact entity queries

查詢例：

- `FastAPI`
- `PostgreSQL`

要驗證：

- entity-aware retrieval 在 exact entity queries 上優於或至少不差於 baseline

### Case F2: Alias queries

查詢例：

- `fast-api`
- `pg`
- `semantic search`

要驗證：

- entity-aware retrieval 明顯優於 baseline（chunk-only 很難用 alias 召回）

### Case F3: Semantic queries

查詢例：

- `how the system extracts text from uploaded documents`

要驗證：

- semantic queries 不應明顯退化

### 建議觀察指標

- Recall@K
- Precision@K
- entity hit rate
- alias hit rate
- context pack redundancy

---

## G. Suggested Query Set

建議至少準備以下查詢集合：

### Exact entity

- `FastAPI`
- `Analyze Resume`
- `PostgreSQL`
- `Vector Search`

### Alias

- `fast-api`
- `resume analysis`
- `pg`
- `semantic search`
- `pdf-extractor`

### Mixed

- `FastAPI parsing workflow`
- `resume parsed state`
- `PostgreSQL vector indexing`

### Semantic

- `how the system extracts text from uploaded documents`
- `backend service for processing API requests`
- `ranking strategies for search results`

---

## 建議驗收輸出格式

若要做最小 CLI 驗收，建議輸出至少包含：

```json
{
  "query": "FastAPI parsing workflow",
  "matched_entities": [
    {
      "entity_id": "entity:fastapi",
      "match_type": "exact",
      "score": 1.0
    }
  ],
  "supporting_chunks": [
    {
      "chunk_id": "chunk:fastapi-service",
      "source": "entity",
      "score": 0.94
    }
  ],
  "vector_chunks": [
    {
      "chunk_id": "chunk:resume-workflow",
      "source": "vector",
      "score": 0.72
    }
  ],
  "errors": []
}
```

---

## 建議驗收指令

```bash
openclaw memory query "FastAPI"
openclaw memory query "fast-api"
openclaw memory query "FastAPI parsing workflow"
openclaw memory query "how the system extracts text from uploaded documents"
```

如果暫時沒有 CLI，也至少應有 integration tests 覆蓋以上四類 query。

---

## 最小測試清單

Phase 3 至少要有以下測試：

- [ ] exact entity query hits correct entity at query-time
- [ ] alias query resolves canonical entity at query-time
- [ ] false-positive entity hit does not occur for unknown terms
- [ ] entity -> supporting chunk retrieval works
- [ ] multi-entity query returns merged relevant chunks
- [ ] entity + vector fusion works
- [ ] entity + keyword fusion works
- [ ] dedupe works across retrieval sources
- [ ] semantic-only query does not regress significantly
- [ ] indirect concept query still has reasonable recall
- [ ] context pack includes relevant entities
- [ ] context pack includes supporting chunks
- [ ] context pack ordering is stable and sensible
- [ ] exact entity query beats or matches chunk-only baseline
- [ ] alias query beats chunk-only baseline

---

## 最後結論

如果你做完 Phase 3，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只是把 entity 存進去了，而是真的在 query-time retrieval 用它改善了 exact entity query、alias query、mixed query 的結果，而且沒有明顯傷害 semantic-only query。

這句話成立，Phase 3 才算真的完成。
