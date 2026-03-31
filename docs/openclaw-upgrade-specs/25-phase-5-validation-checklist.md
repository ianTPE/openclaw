# Phase 5 Validation Checklist

## 目的

本文件定義 `Phase 5: Prompt Adapter` 完成後，應如何驗證 OpenClaw 是否已經能把 `CtxFST` 的 retrieval 結果整理成模型真正可用的世界模型摘要，而不是把 raw schema 或零散 snippets 直接塞進 prompt。

如果 Phase 4 的核心是：

> graph expansion 是否受控且有價值

那 Phase 5 的核心就是：

> retrieval + graph 結果能不能被整理成穩定、可控、可閱讀、可被模型有效利用的 prompt context。

---

## 對應範圍

本文件對應 `06-phased-rollout-plan.md` 的：

- `Phase 5: Prompt Adapter`

這一階段預期已完成：

- structured prompt context builder
- token budget rules
- dedupe / ranking logic

Phase 5 仍不涵蓋：

- runtime state writeback
- execution policy
- planner / routing

---

## 前置條件

開始驗證 Phase 5 前，應先滿足：

1. `Phase 2` 已通過：indexing + lookup 正常
2. `Phase 3` 已通過：entity-aware retrieval + fusion 正常
3. `Phase 4` 已通過：graph expansion 正常
4. context pack 已能穩定輸出：
   - relevant entities
   - supporting chunks
   - expanded edges

---

## 驗收標準總表

當以下 8 點都成立時，可視為 Phase 5 完成：

1. prompt adapter 輸出穩定且結構化
2. prompt 不再依賴 raw schema dump
3. relevant entities、supporting chunks、relation summary 都能被正確整理
4. token budget 可控
5. 重複 entities / chunks 可被去重
6. ordering 合理，重要資訊優先
7. expansion 開啟時不會造成 prompt 爆量
8. 對回答品質有可觀察的正向影響

---

## A. Prompt Envelope Shape 驗證

### Case A1: Structured output exists

要驗證：

- prompt adapter 輸出的不是單一拼接字串
- 至少有明確分區，例如：
  - active user states
  - relevant entities
  - retrieved chunks
  - missing preconditions
  - suggested next actions

### Case A2: Stable shape across runs

要驗證：

- 相同 query、相同 index、相同設定下，多次輸出的 prompt envelope shape 應一致

### Case A3: No raw frontmatter/schema dump

要驗證：

- prompt 中不直接包含未整理的 YAML frontmatter
- prompt 中不直接 dump 整份 `.ctxfst.md`

---

## B. Content Selection 驗證

### Case B1: Relevant entities included

查詢例：

- `FastAPI parsing workflow`

要驗證：

- relevant entities summary 正確反映 retrieval 結果
- entity 名稱、type、必要 relation 有被保留

### Case B2: Supporting chunks included

要驗證：

- supporting chunks 出現在 prompt 中
- chunk 內容有被保留到足夠回答問題的程度

### Case B3: Graph summary included when expansion is on

查詢例：

- `What is required before Analyze Resume`

要驗證：

- expansion 結果不只是變成更多 chunks
- relation summary 能以人類可讀方式進入 prompt

---

## C. Ordering 驗證

### Case C1: State / entity summary before chunks

要驗證：

- state / entity summary 應先於長 chunks 出現

### Case C2: High-signal chunks before low-signal chunks

要驗證：

- ranking 高的 chunks 應優先出現在 prompt
- 低相關 chunks 不應搶到前面

### Case C3: Missing preconditions surfaced early

查詢例：

- `What do I need before Analyze Resume`

要驗證：

- 若系統已有 missing-preconditions 區塊，應放在 prompt 中較前位置

---

## D. Dedupe 驗證

### Case D1: Duplicate chunk dedupe

要驗證：

- 同一個 chunk 即使來自 entity、vector、graph 多個來源，也只出現一次

### Case D2: Duplicate entity dedupe

要驗證：

- 同一 entity 不會在 summary 內重複列出多次

### Case D3: Relation dedupe

要驗證：

- graph summary 內相同 relation 不會重複噴出多次

---

## E. Token Budget 驗證

### Case E1: Hard token limit respected

要驗證：

- prompt adapter 在 expansion 開啟時仍遵守 token limit

### Case E2: Budget allocation is sane

要驗證：

- entities summary 不會吃掉大部分 budget
- chunks 仍保留主要上下文
- graph summary 不會壓掉核心 supporting chunks

### Case E3: Overflow trimming works

要驗證：

- 當內容超量時，低優先資訊會先被裁掉
- 高優先資訊仍保留

---

## F. Answer Quality 驗證

### Case F1: Exact entity question

查詢例：

- `What is FastAPI used for here?`

要驗證：

- prompt adapter 產生的 context 足夠讓模型回答 FastAPI 在該系統中的角色

### Case F2: Prerequisite question

查詢例：

- `What is required before Analyze Resume?`

要驗證：

- 模型回答中應反映 `REQUIRES` / relevant state context

### Case F3: Mixed workflow question

查詢例：

- `How does the system parse an uploaded resume and what backend supports it?`

要驗證：

- prompt 同時包含 workflow chunk 與 FastAPI supporting chunk
- 最終回答不應只答其中一半

---

## G. Before/After Comparison 驗證

至少比較：

- Phase 4 retrieval raw output
- Phase 5 adapted prompt context

### Case G1: Readability improvement

要驗證：

- adapted prompt 明顯比 raw retrieval result 更容易理解

### Case G2: Noise reduction

要驗證：

- adapted prompt 減少重複與雜訊

### Case G3: Coverage retention

要驗證：

- prompt 雖經過壓縮，但沒有丟掉最重要的 entities / chunks / relations

---

## 建議驗收輸出格式

若要做最小 CLI 驗收，建議輸出至少包含：

```json
{
  "query": "What is required before Analyze Resume?",
  "prompt_context": {
    "activeUserStates": [],
    "relevantEntities": [
      {
        "id": "entity:analyze-resume",
        "name": "Analyze Resume",
        "type": "skill"
      }
    ],
    "retrievedChunks": [
      {
        "id": "chunk:resume-workflow",
        "context": "Explains the resume analysis flow...",
        "content": "The resume analysis flow starts after a resume has been uploaded..."
      }
    ],
    "missingPreconditions": ["state:resume-uploaded"],
    "suggestedNextActions": []
  },
  "token_usage": {
    "estimated": 980,
    "limit": 1400
  },
  "errors": []
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加最小驗收命令，建議形式像：

```bash
openclaw memory prompt-preview --format ctxfst "FastAPI parsing workflow"
openclaw memory prompt-preview --format ctxfst --expand-graph "What is required before Analyze Resume?"
openclaw memory prompt-preview --format ctxfst "How does the system parse an uploaded resume and what backend supports it?"
```

如果暫時沒有 CLI，也至少應有 integration tests 對 prompt adapter 輸出做 snapshot 驗證。

---

## 最小測試清單

Phase 5 至少要有以下測試：

- [ ] prompt envelope is structured
- [ ] raw schema is not dumped into prompt
- [ ] relevant entities included
- [ ] supporting chunks included
- [ ] graph summary included when enabled
- [ ] ordering is stable and sane
- [ ] chunk/entity dedupe works
- [ ] hard token limit respected
- [ ] overflow trimming preserves high-signal info
- [ ] prompt quality improves readability without dropping key coverage

---

## 最後結論

如果你做完 Phase 5，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只是拿到 retrieval 結果，而是真的能把 entities、chunks、relations 和狀態摘要整理成模型容易吃、長度可控、排序合理的 prompt context，而且它對回答品質有實際幫助。

這句話成立，Phase 5 才算真的完成。
