# Test Plan

## 目的

本文件定義 OpenClaw 升級為 `CtxFST` 原生支援後的測試策略。

目標不是只驗 parser 能跑，而是驗證整條鏈路：

- parser
- validation
- indexing
- retrieval
- prompt adapter
- runtime state

---

## 測試原則

1. 每一層都要可獨立測試。
2. 每一層都要可做 integration 測試。
3. retrieval 改進要可被 benchmark 與 regression 測試驗證。
4. runtime state 不能只靠人工 demo 驗證。

---

## Test Pyramid

### Unit Tests

聚焦：

- parser
- validator
- canonicalizer
- ranking / fusion
- precondition checker

### Integration Tests

聚焦：

- parser -> indexer
- index -> retrieval
- retrieval -> prompt adapter
- runtime writeback -> retrieval

### End-to-End Tests

聚焦：

- ingest `.ctxfst.md`
- query retrieval
- assemble prompt
- apply runtime state update

---

## Parser Tests

### Case P1: minimal valid document

驗證：

- parser 可成功讀取最小合法 `.ctxfst.md`

### Case P2: full valid document

驗證：

- parser 可成功讀取包含 `entities`, `chunks`, `state_refs`, metadata 的完整文檔

### Case P3: duplicate entity IDs

驗證：

- validator 回傳 fatal error

### Case P4: duplicate chunk IDs

驗證：

- validator 回傳 fatal error

### Case P5: missing entity reference

驗證：

- `chunks[].entities` 指到不存在 entity 時報錯

### Case P6: body/frontmatter mismatch

驗證：

- `<Chunk id="...">` 與 frontmatter mapping 不一致時報錯

### Case P7: state_refs on non-state entity

驗證：

- 回傳 warning，而非 crash

---

## Canonicalization Tests

### Case C1: alias dedupe

驗證：

- 重複 aliases 被去除

### Case C2: tags dedupe

驗證：

- 重複 tags 被去除

### Case C3: default value injection

驗證：

- 缺失選填欄位時可產生穩定預設值

### Case C4: enum normalization

驗證：

- relation / priority 可被正規化

---

## Indexing Tests

### Case I1: first-time ingest

驗證：

- documents / chunks / entities / mappings 均被正確寫入

### Case I2: reindex same source

驗證：

- 不重複插入
- source_hash 正常比對

### Case I3: update source content

驗證：

- source 改變後可正確重建 index

### Case I4: delete or remove document

驗證：

- document scope 的 entities / mappings 可正確移除或失效

---

## Retrieval Tests

### Case R1: exact entity query

查詢例：

- `FastAPI`

驗證：

- entity direct hit
- 相關 chunks 被召回

### Case R2: alias query

查詢例：

- `K8s`

驗證：

- alias 可命中 canonical entity

### Case R3: semantic-only query

查詢例：

- 沒有直接提 entity 名稱，但描述概念

驗證：

- vector retrieval 仍然可補召回

### Case R4: mixed query

查詢例：

- 同時包含 entity 名稱與抽象需求

驗證：

- entity + vector retrieval 可同時工作

### Case R5: graph-expanded query

查詢例：

- 命中某 entity 後應沿 `REQUIRES` 或 `LEADS_TO` 擴一層

驗證：

- expansion 有被觸發
- 不會超出 budget

---

## Prompt Adapter Tests

### Case A1: context pack completeness

驗證：

- prompt envelope 包含：
  - relevant entities
  - retrieved chunks
  - missing preconditions

### Case A2: dedupe

驗證：

- 重複 chunk / entity 不會重複輸出

### Case A3: token budget

驗證：

- graph expansion 不會讓 prompt context 無限制膨脹

### Case A4: ordering

驗證：

- state / entity summary 出現在 chunks 之前

---

## Runtime Tests

### Case W1: precondition satisfied

驗證：

- `checkPreconditions()` 回傳 `ok = true`

### Case W2: missing preconditions

驗證：

- `missing[]` 被正確列出

### Case W3: successful execution writeback

驗證：

- `postconditions` 被加入 active states
- `COMPLETED` edge 或 event 被寫入

### Case W4: failed execution writeback

驗證：

- `BLOCKED_BY` event 或 edge 被寫入

### Case W5: retrieval reads runtime state

驗證：

- active states 可影響 context pack

---

## End-To-End Scenarios

### E2E 1: CtxFST ingestion to retrieval

流程：

- ingest `.ctxfst.md`
- query exact entity
- verify context pack

### E2E 2: alias query to prompt

流程：

- ingest doc with aliases
- query alias
- verify canonical entity returned in prompt

### E2E 3: state-aware execution loop

流程：

- load world state
- run precondition check
- simulate successful execution
- re-query retrieval

### E2E 4: graph expansion with budget

流程：

- query entity
- expand one hop
- verify max nodes / chunks respected

---

## Regression Suite

每次改動以下元件時，都應跑 regression：

- parser
- validator
- entity matcher
- graph expansion
- rank fusion
- prompt adapter
- world state writeback

---

## 測試資料集建議

至少準備三類 fixtures：

1. descriptive knowledge only
2. entity + relation heavy
3. stateful / operational world model

建議直接以：

- `examples/minimal.ctxfst.md`
- `examples/full.ctxfst.md`

作為 parser / indexing / retrieval integration 的起始 fixtures。

---

## 驗收門檻

MVP 合格線建議：

- parser fatal cases 全通過
- entity-aware retrieval integration tests 全通過
- prompt adapter regression 全通過
- 至少一條 runtime state writeback E2E 全通過
