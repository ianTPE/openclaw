# Phase 2 Validation Checklist

## 目的

本文件定義 `Phase 2: Entity-Aware Indexing + Retrieval` 完成後，應如何驗證 OpenClaw 對 `CtxFST` 的支援是否真的超越了單純 parser MVP。

Phase 2 的核心問題不是「能不能讀 `.ctxfst.md`」，而是：

> 系統能不能把 `entities` 與 `chunks` 一起索引起來，並在查詢時真正利用 entity layer 產生更好的召回結果。

---

## 驗收範圍

Phase 2 驗證涵蓋：

- entity-aware indexing
- entity lookup
- chunk-to-entity mapping
- entity-aware retrieval
- entity + chunk fusion retrieval

Phase 2 驗證不涵蓋：

- runtime state writeback
- planner / routing
- execution policy
- multi-step planning

---

## 驗收標準總表

當以下 7 點都成立時，可視為 Phase 2 完成：

1. `entities` 能被正確寫入 index
2. `chunk_entities` mapping 正確建立
3. entity name query 能命中正確 entity
4. alias query 能命中 canonical entity
5. entity 命中後可回查相關 chunks
6. entity + chunk fusion retrieval 能正常工作
7. chunk-only baseline 沒有明顯退化

---

## A. Indexing 驗證

### Case A1: Entities persisted

輸入：

- `examples/full.ctxfst.md`

要驗證：

- `entities` 表內有正確數量的 entity records
- `id`, `name`, `type`, `aliases`, `preconditions`, `postconditions` 均正確寫入

預期結果：

- entity count 符合 fixture
- 無重複 entity rows

### Case A2: Chunk-entity mapping persisted

要驗證：

- `chunk_entities` 中每個 chunk 與 frontmatter 的 `entities[]` 對應一致

預期結果：

- `workflow:resume-analysis` 對到 `entity:analyze-resume`, `entity:resume-uploaded`, `entity:resume-parsed`
- `reference:fastapi-service` 對到 `entity:fastapi`

### Case A3: Reindex idempotence & Update cleanup

要驗證：

- 同一份 `.ctxfst.md` 重跑 indexing 不會產生重複 entity 或 mapping rows
- 檔案更新（刪除某些 entity 或 chunk）並重跑 ingestion 時，資料庫舊的 mapping 或 orphaned entity 能夠被正確清除或覆寫

---

## B. Entity Lookup 驗證

### Case B1: Exact entity match

查詢例：

- `FastAPI`
- `Analyze Resume`

要驗證：

- 能命中正確 canonical entity
- `matchType = exact`

### Case B2: Alias match

查詢例：

- `fast-api`
- `resume analysis`

要驗證：

- 能命中正確 canonical entity
- `matchType = alias`

### Case B3: Unknown entity query

查詢例：

- 一個 fixture 裡不存在的專有名詞

要驗證：

- 不應錯誤命中無關 entity
- 應回傳空或低信心結果

### Case B4: Case-insensitive match

查詢例：

- `FASTAPI`
- `fastapi`

要驗證：

- entity 搜尋必須對大小寫不敏感（case-insensitive），皆能命中 `FastAPI` (canonical target) 等同義或大小寫變化

---

## C. Entity-to-Chunk Reverse Lookup 驗證

### Case C1: Framework entity to chunks

查詢例：

- `FastAPI`

要驗證：

- 命中 `entity:fastapi`
- 能回查 `reference:fastapi-service`

### Case C2: Action/state entity to chunks

查詢例：

- `Analyze Resume`

要驗證：

- 命中 `entity:analyze-resume`
- 能回查 `workflow:resume-analysis`

---

## D. Fusion Retrieval 驗證

### Case D1: Entity-first query

查詢例：

- `FastAPI`

要驗證：

- relevant entity 出現在結果中
- supporting chunk 出現在結果中
- chunk source 可標示為 `entity` 或 fusion 後的高優先結果

### Case D2: Alias + semantic mixed query

查詢例：

- `fast-api parsing workflow`

要驗證：

- alias 命中 canonical entity
- 語意相關 chunk 也能被一起拉進來

### Case D3: Semantic-only query

查詢例：

- `how the system parses an uploaded resume`

要驗證：

- vector/keyword retrieval 仍可工作
- entity-aware path 不應讓語意查詢退化

---

## E. Retrieval Output 驗證

### Case E1: Context pack includes entities and chunks

要驗證：

- retrieval 輸出不只是 chunk list
- 至少能看到：
  - relevant entities
  - supporting chunks

### Case E2: No duplicate entities/chunks

要驗證：

- fusion 後重複結果被去重

### Case E3: Ranking sanity

要驗證：

- exact/alias hit 的 entity 與其 supporting chunks，排序不應被低相關 vector hit 壓掉

### Case E4: Context Limit Protection (Token Budget)

要驗證：

- 當某個超熱門的 entity 關聯了非常多（如數百個）chunks 時，fusion 出來的結果會被正確限制數量（截斷 / top-K）
- 確保不會把 LLM 的 context window 灌爆，維持穩定的 prompt size

---

## F. Baseline Comparison 驗證

### Case F1: Exact entity query vs chunk-only baseline

要驗證：

- entity-aware retrieval 在 exact entity query 上優於或至少不差於 chunk-only baseline

### Case F2: Alias query vs chunk-only baseline

要驗證：

- entity-aware retrieval 明顯優於 chunk-only baseline

### Case F3: Semantic query vs chunk-only baseline

要驗證：

- semantic query 不應明顯退化

---

## 建議驗收輸出格式

若要做 Phase 2 CLI 驗收入口，建議輸出格式至少包含：

```json
{
  "query": "FastAPI",
  "matched_entities": [
    {
      "entity_id": "entity:fastapi",
      "match_type": "exact",
      "score": 1.0
    }
  ],
  "supporting_chunks": [
    {
      "chunk_id": "reference:fastapi-service",
      "source": "entity",
      "score": 0.94
    }
  ],
  "warnings": [],
  "errors": []
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加最小驗收命令，建議形式像：

```bash
openclaw memory validate-index examples/full.ctxfst.md
openclaw memory query --format ctxfst "FastAPI"
openclaw memory query --format ctxfst "fast-api parsing workflow"
openclaw memory query --format ctxfst "how the system parses an uploaded resume"
```

如果暫時沒有 CLI，也至少要有 integration tests 覆蓋這三類 query。

---

## 最小測試清單

Phase 2 至少要有以下測試：

- [ ] entities persisted correctly
- [ ] chunk_entities mapping correct
- [ ] reindex handles updates and orphan cleanup
- [ ] exact entity lookup works
- [ ] alias lookup works
- [ ] case-insensitive lookup works
- [ ] unknown entity query does not hallucinate hit
- [ ] entity -> chunk reverse lookup works
- [ ] entity + chunk fusion retrieval works
- [ ] fusion context limit protection works
- [ ] duplicate results deduped
- [ ] exact entity query beats or matches baseline
- [ ] alias query beats baseline
- [ ] semantic query does not regress significantly

---

## 最後結論

如果你做完 Phase 2，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只讀得懂 `.ctxfst.md`，還能把 entity layer 真的用在索引與查詢裡，而且它對 exact entity query、alias query 至少有明顯幫助，對 semantic query 沒有明顯傷害。

這句話成立，Phase 2 才算真的完成。
