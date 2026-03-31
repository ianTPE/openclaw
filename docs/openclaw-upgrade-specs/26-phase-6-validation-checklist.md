# Phase 6 Validation Checklist

## 目的

本文件定義 `Phase 6: Runtime State` 完成後，應如何驗證 OpenClaw 是否已經把 `CtxFST` 從靜態 knowledge format 推進成具備 operational value 的 runtime memory system。

如果 Phase 5 的核心是：

> retrieval 結果能不能被整理成模型容易使用的 prompt context

那 Phase 6 的核心就是：

> `preconditions`、`postconditions`、`state_refs` 是否真的進入 session-scoped runtime state，並影響系統行為。

---

## 對應範圍

本文件對應 `06-phased-rollout-plan.md` 的：

- `Phase 6: Runtime State`

這一階段預期已完成：

- world state persistence
- execution precheck
- execution writeback
- runtime edges / events

Phase 6 仍不涵蓋：

- planner / routing
- lookahead planning
- human critique loop

---

## 前置條件

開始驗證 Phase 6 前，應先滿足：

1. `Phase 2` 已通過：indexing + lookup 正常
2. `Phase 3` 已通過：entity-aware retrieval + fusion 正常
3. `Phase 4` 已通過：graph expansion 正常（推薦但不嚴格必要；runtime state 本身不依賴 graph expansion，但 prompt adapter 整合時會用到）
4. `Phase 5` 已通過：prompt adapter 正常
5. state entities、preconditions、postconditions 已能從 `.ctxfst.md` 正確 ingest

---

## 驗收標準總表

當以下 8 點都成立時，可視為 Phase 6 完成：

1. session-scoped world state 可建立與讀回
2. precondition checking 正常運作
3. missing preconditions 會被正確 surfaced
4. successful execution 會寫入 postconditions
5. runtime events / edges 會被正確寫入
6. 不同 session 間的 state 不會互相污染
7. retrieval / prompt 可讀取 runtime state 並反映在輸出中
8. runtime state 對實際任務流程有可觀察價值

---

## A. World State Persistence 驗證

### Case A1: Create new session state

要驗證：

- 新 session 啟動時可建立空的 `world_state`
- 至少包含：
  - `session_id`
  - `goal`
  - `active_states[]`
  - `completed_skills[]`
  - `blocked_by[]`

### Case A2: Load existing session state

要驗證：

- 同一 session 可在後續步驟正確讀回先前 state

### Case A3: State persists across retrieval calls

要驗證：

- world state 不會只存在單次 request memory 中
- retrieval / prompt 再次執行時仍能讀到先前狀態

---

## B. Precondition Checking 驗證

### Case B1: Preconditions satisfied

情境：

- `entity:analyze-resume` 的 `preconditions` 已存在於 active states

要驗證：

- `checkPreconditions()` 回傳 `ok = true`
- `missing[] = []`

### Case B2: Missing preconditions surfaced

情境：

- `state:resume-uploaded` 尚未 active

要驗證：

- `checkPreconditions()` 回傳 `ok = false`
- `missing[]` 內正確列出缺失 state

### Case B3: Multiple missing preconditions

要驗證：

- 當 action 需要多個 states 時，missing list 完整且穩定

---

## C. Postcondition Writeback 驗證

### Case C1: Successful execution updates active states

情境：

- 成功執行 `entity:analyze-resume`

要驗證：

- `postconditions` 被加入 `active_states`
- `state:resume-parsed` 出現在當前 session state 中

### Case C2: Completed skill recorded

要驗證：

- `completed_skills[]` 中新增一筆 `CompletedSkillRecord`
- 包含：
  - `entityId`
  - `timestamp`
  - `resultSummary` 或 status

### Case C3: Idempotent writeback behavior

要驗證：

- 同一成功事件重放時，不應無限制重複灌爆 active states

---

## D. Failure / Blocked Writeback 驗證

### Case D1: Failed execution writes blocked event

情境：

- action 執行失敗或 preconditions 不滿足

要驗證：

- 寫入 `BLOCKED_BY` runtime event 或 edge

### Case D2: blocked_by surfaced in session state

要驗證：

- 當前 session 可讀到 `blocked_by[]`
- 後續 retrieval / prompt 可使用這個資訊

### Case D3: Failure does not wrongly apply postconditions

要驗證：

- 執行失敗時，不應把成功後才有的 state 寫進 active states

---

## E. Runtime Event / Edge 驗證

### Case E1: COMPLETED event written

要驗證：

- 成功執行後有 `COMPLETED` 類 runtime record

### Case E2: BLOCKED_BY event written

要驗證：

- 阻塞情境有 `BLOCKED_BY` 類 runtime record

### Case E3: Provenance present

要驗證：

- runtime event 至少帶有：
  - `session_id`
  - `entity_id`
  - `timestamp`

---

## F. Multi-Session Isolation 驗證

### Case F1: Session A and B remain isolated

情境：

- Session A 完成 `Analyze Resume`
- Session B 尚未完成

要驗證：

- Session A 的 `active_states` 與 Session B 不相互污染

### Case F2: Runtime events do not overwrite other sessions

要驗證：

- 不同 session 的 `COMPLETED` / `BLOCKED_BY` 不互相覆蓋

### Case F3: Retrieval reads correct session state

要驗證：

- session-aware retrieval / prompt 只讀取當前 session 的 world state

---

## G. Retrieval / Prompt Integration 驗證

### Case G1: Missing preconditions appear in prompt

查詢例：

- `What do I need before Analyze Resume?`

要驗證：

- 若 preconditions 缺失，prompt context 中會 surfaced missing states

### Case G2: Active states influence context selection

要驗證：

- 當某 state 已 active，相關 chunks / suggestions 排序有所提升或變化

### Case G3: Completed skills affect suggested next actions

要驗證：

- 已完成 action 不應被一再當作下一步重複推薦

---

## H. End-To-End Runtime Flow 驗證

### Case H1: Upload -> analyze -> parsed state

流程：

1. Session 初始狀態為空
2. 加入 `state:resume-uploaded`
3. 檢查 `entity:analyze-resume` preconditions
4. 模擬成功執行
5. 驗證 `state:resume-parsed` 已寫回

### Case H2: Parsed -> complete state chain

若 fixture 中定義更後續 action，則驗證：

- state chain 能持續往下累積

### Case H3: Failed execution path

流程：

1. Session 缺少必要 state
2. 嘗試執行 action
3. 驗證 `missing preconditions` 與 `blocked_by` 行為正確

---

## 建議驗收輸出格式

若要做最小 CLI 驗收，建議輸出至少包含：

```json
{
  "session_id": "session-123",
  "goal": null,
  "active_states": ["state:resume-uploaded", "state:resume-parsed"],
  "completed_skills": [
    {
      "entityId": "entity:analyze-resume",
      "timestamp": "2026-03-31T10:30:00+08:00",
      "status": "completed"
    }
  ],
  "blocked_by": [],
  "runtime_events": [
    {
      "eventType": "completed",
      "entityId": "entity:analyze-resume"
    }
  ]
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加最小驗收命令，建議形式像：

```bash
openclaw memory state show --session test-session
openclaw memory state precheck --session test-session --entity entity:analyze-resume
openclaw memory state apply-success --session test-session --entity entity:analyze-resume
openclaw memory state apply-failure --session test-session --entity entity:analyze-resume
openclaw memory prompt-preview --session test-session --format ctxfst "What do I need before Analyze Resume?"
```

如果暫時沒有 CLI，也至少應有 integration tests 能覆蓋：

- precondition checking
- postcondition writeback
- failure writeback
- multi-session isolation
- prompt integration

---

## 最小測試清單

Phase 6 至少要有以下測試：

- [ ] world state can be created and loaded
- [ ] precondition checking passes when states are present
- [ ] missing preconditions surfaced when absent
- [ ] successful execution writes postconditions
- [ ] completed skill recorded
- [ ] failed execution writes blocked event
- [ ] failed execution does not apply postconditions
- [ ] runtime events include session provenance
- [ ] sessions remain isolated
- [ ] retrieval/prompt read the correct session state
- [ ] active states and completed skills influence output meaningfully

---

## 最後結論

如果你做完 Phase 6，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只是把 state 存起來，而是真的讓 `preconditions`、`postconditions`、runtime events 與 session world state 進入系統行為，並且它們對 retrieval、prompt 與任務流程有實際影響。

這句話成立，Phase 6 才算真的完成。
