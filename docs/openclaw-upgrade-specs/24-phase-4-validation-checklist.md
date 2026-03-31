# Phase 4 Validation Checklist

## 目的

本文件定義 `Phase 4: Graph Expansion` 完成後，應如何驗證 OpenClaw 是否已從 entity-aware retrieval 進一步走到 relation-aware retrieval。

如果 Phase 3 的核心是：

> query-time retrieval 有沒有真的把 entity layer 用起來

那 Phase 4 的核心就是：

> 命中 entity 之後，系統能不能沿著 graph relation 做受控且有價值的擴展，而不是只是把 context 撐爆。

---

## 對應範圍

本文件對應 `06-phased-rollout-plan.md` 的：

- `Phase 4: Graph Expansion`

這一階段預期已完成：

- one-hop graph expansion
- relation weights
- expansion budget controls

Phase 4 仍不涵蓋：

- prompt adapter 的最終 token budgeting策略
- runtime state writeback
- planner / routing

---

## 前置條件

開始驗證 Phase 4 前，應先滿足：

1. `Phase 2` 已通過：indexing + lookup 正常
2. `Phase 3` 已通過：entity-aware retrieval + fusion 正常
3. `examples/retrieval-test.ctxfst.md` 已可被穩定 ingest
4. `entity_edges` 表中已有可 traverse 的 edges

### Edge 來源說明

Phase 4 依賴的 edges 應在 Phase 2 indexing 階段由 indexer 自動從 entities 的 `preconditions` / `postconditions` 推斷建立：

- `entity:analyze-resume` 的 `preconditions: [state:resume-uploaded]` → 自動建立 `entity:analyze-resume --REQUIRES--> state:resume-uploaded`
- `entity:analyze-resume` 的 `postconditions: [state:resume-parsed]` → 自動建立 `entity:analyze-resume --LEADS_TO--> state:resume-parsed`
- `entity:generate-report` 的 `preconditions: [state:resume-parsed]` → 自動建立 `entity:generate-report --REQUIRES--> state:resume-parsed`
- `entity:generate-report` 的 `postconditions: [state:analysis-complete]` → 自動建立 `entity:generate-report --LEADS_TO--> state:analysis-complete`

這代表 Phase 2 的 indexer 必須包含「從 preconditions/postconditions 自動推斷 static edges」的邏輯。若 Phase 2 驗收時未包含此功能，應在 Phase 4 開始前補做。

`SIMILAR` edges 可由 LLM inference 或人工標註補充，MVP 階段可先不做。

---

## 使用的 Fixture

本 checklist 的所有 case 基於：

- `examples/retrieval-test.ctxfst.md`

該 fixture 包含完整 workflow 閉環：

`state:resume-uploaded` → `entity:analyze-resume` → `state:resume-parsed` → `entity:generate-report` → `state:analysis-complete`

Phase 2 indexer 應已從此推斷出至少 4 條 `REQUIRES` / `LEADS_TO` edges。

---

## 驗收標準總表

當以下 8 點都成立時，可視為 Phase 4 完成：

1. 命中 entity 後可做 one-hop expansion
2. expansion 結果可依 relation type 過濾
3. `REQUIRES` / `LEADS_TO` 權重高於 `SIMILAR`
4. expansion 結果可被 budget 控制
5. expansion 後的 chunk 補召回有實際價值
6. expansion 不會讓 context pack 充滿低價值噪音
7. retrieval quality 在 relation-sensitive queries 上優於 Phase 3 baseline
8. semantic-only queries 不會因 expansion 而明顯退化

---

## A. Graph Expansion 基本行為驗證

### Case A1: One-hop expansion only

查詢例：

- `Analyze Resume`

要驗證：

- 命中 seed entity 後，只擴一層鄰居
- 不會遞迴展開多跳 graph

預期結果：

- expanded entities 僅包含 seed entity 的直接 neighbors

### Case A2: Expansion after entity hit

查詢例：

- `What is needed for resume analysis`

要驗證：

- 先有 entity hit（`entity:analyze-resume` via alias）
- 再觸發 graph expansion（沿 `REQUIRES` 擴展到 `state:resume-uploaded`）
- expansion 不應在完全沒有 seed entity 時亂跑

### Case A3: No runaway expansion on broad query

查詢例：

- `API`

要驗證：

- 若 query 過廣，expansion 仍受 budget 控制
- 不會因 broad entity hit 造成大量無關擴展

---

## B. Relation Filtering 驗證

### Case B1: `REQUIRES` filter

查詢例：

- `Analyze Resume prerequisites`

要驗證：

- 只開 `REQUIRES` relation filter 時，只擴展 prerequisite neighbors

### Case B2: `LEADS_TO` filter

查詢例：

- `What happens after resume parsing`

要驗證：

- 只開 `LEADS_TO` relation filter 時，只擴展 successor neighbors

### Case B3: `SIMILAR` filter

情境：

- 從 `entity:vector-search` 出發，檢查其 `SIMILAR` 鄰居

要驗證：

- `SIMILAR` expansion 可工作
- 但其排序權重應低於 `REQUIRES` / `LEADS_TO`

備註：

- `SIMILAR` edges 在 MVP 可能尚未存在，可先標記為 optional test

---

## C. Relation Weight 驗證

### Case C1: Operational edges outrank semantic neighbors

查詢例：

- `What do I need before Analyze Resume`

要驗證：

- `REQUIRES` 路徑的 expanded entities / chunks，排序高於純 `SIMILAR` 鄰居

### Case C2: `LEADS_TO` outranks `SIMILAR` in next-step query

查詢例：

- `What comes after resume uploaded`

要驗證：

- `LEADS_TO` 鄰居在 next-step 類 query 中排序更高

### Case C3: Weight table is deterministic

要驗證：

- 相同 relationWeights 設定下，多次執行結果排序穩定

---

## D. Expansion Budget 驗證

### Case D1: Max expanded entities respected

要驗證：

- 設定 `maxExpandedEntities = N` 時，expanded entities 不超過 N

### Case D2: Max expanded chunks respected

要驗證：

- expansion 導出的 supporting chunks 不超過設定上限

### Case D3: Expansion pruning works

要驗證：

- 當 graph 鄰居太多時，低權重 relation 或低分數 neighbors 會被裁掉

### Case D4: No context explosion

要驗證：

- expansion 開啟後，context pack 大小仍在可接受範圍
- 不會因單一熱門 entity 連出過多 chunks 而淹沒主要結果

---

## E. Retrieval Quality 驗證

### Case E1: Relation-sensitive query improves

查詢例：

- `What is required before Analyze Resume`
- `What happens after Resume Parsed`

要驗證：

- Phase 4 結果優於 Phase 3 baseline
- expansion 能補到 chunk-only / entity-only retrieval 較難補到的內容

### Case E2: Supporting chunk relevance remains high

要驗證：

- expanded chunks 雖然是 graph 派生的，但內容仍應與 query 有清楚關聯

### Case E3: No severe degradation on semantic-only queries

查詢例：

- `backend service for parsing API`

要驗證：

- expansion 不應把 semantic-only query 變得更亂或更弱

---

## F. Suggested Query Set

建議至少準備以下 query：

### Relation-sensitive

- `What is required before Analyze Resume`
- `What happens after Resume Parsed`
- `What leads to analysis complete`

### Mixed retrieval + graph

- `resume analysis next step`
- `semantic search indexing pipeline`

### Broad / noisy query

- `API`
- `search`

### Semantic non-regression

- `backend service for parsing API`
- `how the system parses an uploaded resume`

---

## 建議驗收輸出格式

若要做最小 CLI 驗收，建議輸出至少包含：

```json
{
  "query": "What is required before Analyze Resume",
  "seed_entities": [
    {
      "entity_id": "entity:analyze-resume",
      "match_type": "exact",
      "score": 1.0
    }
  ],
  "expanded_entities": [
    {
      "entity_id": "state:resume-uploaded",
      "relation": "REQUIRES",
      "score": 0.92
    }
  ],
  "supporting_chunks": [
    {
      "chunk_id": "chunk:resume-workflow",
      "source": "graph",
      "score": 0.89
    }
  ],
  "limits": {
    "maxExpandedEntities": 5,
    "maxExpandedChunks": 5
  },
  "errors": []
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加最小驗收命令，建議形式像：

```bash
openclaw memory query --format ctxfst --expand-graph "What is required before Analyze Resume"
openclaw memory query --format ctxfst --expand-graph --relations REQUIRES "Analyze Resume prerequisites"
openclaw memory query --format ctxfst --expand-graph --relations LEADS_TO "What happens after Resume Parsed"
openclaw memory query --format ctxfst --expand-graph --max-expanded-entities 3 "API"
```

如果暫時沒有 CLI，也至少應有 integration tests 覆蓋：

- one-hop expansion
- relation filter
- budget control
- relation-sensitive quality improvement

---

## 最小測試清單

Phase 4 至少要有以下測試：

- [ ] one-hop expansion works
- [ ] expansion only starts from valid seed entities
- [ ] relation filtering works
- [ ] `REQUIRES` outranks `SIMILAR`
- [ ] `LEADS_TO` outranks `SIMILAR`
- [ ] max expanded entities respected
- [ ] max expanded chunks respected
- [ ] expansion pruning works
- [ ] relation-sensitive queries improve vs Phase 3 baseline
- [ ] semantic-only queries do not regress significantly
- [ ] context pack does not explode in size

---

## 最後結論

如果你做完 Phase 4，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只是會做 entity-aware retrieval，還能沿 graph relation 做受控的一跳擴展，並在 prerequisite / next-step / dependency 類 query 上帶來明顯價值，同時沒有把 context pack 變成噪音場。

這句話成立，Phase 4 才算真的完成。
