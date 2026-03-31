# Phase 7 Validation Checklist

## 目的

本文件定義 `Phase 7: Planner And Routing` 完成後，應如何驗證 OpenClaw 是否已經從 state-aware runtime 正式進入可規劃、可解釋、可持續寫回的 `CtxFST semantic world model runtime`。

如果 Phase 6 的核心是：

> runtime state 是否真的進入系統行為

那 Phase 7 的核心就是：

> 系統能不能利用 goals、states、relations、completed skills 與 blocked conditions，產生更合理的下一步，而不是只做 retrieval。

---

## 對應範圍

本文件對應 `06-phased-rollout-plan.md` 的：

- `Phase 7: Planner And Routing`

這一階段預期已完成：

- goal-aware routing
- relation-aware weighting
- explainable next action suggestions

Phase 7 不再只是 retrieval 驗證，而是 runtime decision 層的驗證。

---

## 前置條件

開始驗證 Phase 7 前，應先滿足：

1. `Phase 3` 已通過：entity-aware retrieval 正常
2. `Phase 4` 已通過：graph expansion 正常
3. `Phase 5` 已通過：prompt adapter 正常
4. `Phase 6` 已通過：runtime state / preconditions / postconditions 正常
5. system 已可從 session state 讀到：
   - `goal`
   - `active_states`
   - `completed_skills`
   - `blocked_by`

---

## 驗收標準總表

當以下 8 點都成立時，可視為 Phase 7 完成：

1. planner 能根據 goal 選擇更合理的下一步
2. relation-aware weighting 會影響 routing 結果
3. completed skills 不會被反覆推薦
4. blocked conditions 會影響 routing
5. next action suggestions 可解釋
6. 規劃結果能隨 world state 變化而更新
7. 規劃品質優於純 retrieval-only baseline
8. planner 不會被純 `SIMILAR` 鄰居帶偏

---

## A. Goal-Aware Routing 驗證

### Case A1: Goal changes route

情境：

- 相同 session memory，不同 `goal`

要驗證：

- planner 產生不同的 next action suggestions
- route 不是固定死的 top retrieval result

### Case A2: Goal-relevant action ranked higher

查詢例：

- `goal = state:analysis-complete`

要驗證：

- 更接近 goal 的 actions / states 會被排前面

### Case A3: Irrelevant but semantically similar nodes do not dominate

情境：

- `entity:resume-template` 語意與 resume 相關，但不在 workflow chain 上

要驗證：

- planner 不應把 `entity:resume-template` 排在 `entity:generate-report` 前面
- 與 goal 無關但語意相近的 nodes，不應搶走 operationally relevant routes

---

## B. Relation-Aware Weighting 驗證

### Case B1: `REQUIRES` beats `SIMILAR`

查詢例：

- `What should happen before Analyze Resume?`

要驗證：

- planner 偏好 prerequisite path，而不是純 similarity neighbor

### Case B2: `LEADS_TO` beats `SIMILAR`

查詢例：

- `What should happen after Resume Parsed?`

要驗證：

- planner 偏好 causal / successor edges

### Case B3: Weight changes are observable

要驗證：

- relation weights 調整後，routing 結果會有可觀察變化

---

## C. State-Aware Decision 驗證

### Case C1: Missing preconditions alter next action

情境：

- `state:resume-uploaded` 尚未 active

要驗證：

- planner 不應直接推薦需要該 state 才能成功的 action
- 或至少要把缺失 state surfaced 成下一步需求

### Case C2: Active states unlock new actions

情境：

- `state:resume-uploaded` 變為 active

要驗證：

- planner 會開始推薦 `entity:analyze-resume`

### Case C3: Completed skills are deprioritized

情境：

- `entity:analyze-resume` 已完成

要驗證：

- planner 不應持續把同一 action 當作最佳下一步

---

## D. Blocked / Failure-Aware Routing 驗證

### Case D1: Blocked action deprioritized

情境：

- 某 action 剛剛因缺失 state 或 runtime error 被標記 blocked

要驗證：

- planner 對 blocked action 降權或先推薦解除 blockage 的步驟

### Case D2: Block reason appears in explanation

要驗證：

- planner explanation 中能指出該 action 為何被阻擋

### Case D3: Routing recovers after state fix

情境：

- 缺失 state 後來被補齊

要驗證：

- planner route 會更新，不會永遠卡在舊 blocked 狀態

---

## E. Explainability 驗證

### Case E1: Explanation names the goal

要驗證：

- next action suggestion 附帶 explanation 時，會提到當前 goal 與相關 state / relation

### Case E2: Explanation references relation semantics

要驗證：

- explanation 可指出：
  - 因為 `REQUIRES`
  - 因為 `LEADS_TO`
  - 因為 preconditions 已滿足或尚未滿足

### Case E3: Explanation is stable and readable

要驗證：

- explanation 不只是 dump internal score
- 對人類可讀且可 debug

---

## F. Replanning 驗證

### Case F1: Replan after state update

流程：

1. planner 先給一組 next actions
2. 更新 session state
3. planner 再次運行

要驗證：

- route 會根據新 state 更新

### Case F2: Replan after completion writeback

流程：

1. 完成一個 action
2. `completed_skills` 更新
3. planner 再次運行

要驗證：

- 下一步與前一步不同，且更接近 goal

### Case F3: Replan after unblock

流程：

1. 某 action blocked
2. 補齊缺失 state
3. planner 再次運行

要驗證：

- blocked path 能重新變成可行候選

---

## G. Baseline Comparison 驗證

至少比較：

- Phase 6: retrieval + runtime state, but no planner
- Phase 7: planner / routing enabled

### Case G1: Better next action quality

要驗證：

- planner-enabled system 提供的 next action 比純 retrieval 更合理

### Case G2: Less repetition

要驗證：

- planner-enabled system 不會反覆推薦已完成 action

### Case G3: Better blocked-state handling

要驗證：

- planner-enabled system 對 blocked conditions 的處理優於純 retrieval

---

## H. Suggested Scenario Set

建議至少準備以下場景：

### Scenario 1: Missing prerequisite

- goal 已設定
- 關鍵 precondition 尚未滿足
- 驗證 planner 會先推薦補 prerequisite

### Scenario 2: Mid-workflow continuation

- 某些 states 已 active
- 某個 action 已完成
- 驗證 planner 會往 workflow 下一步走

### Scenario 3: Blocked recovery

- 某 action blocked
- 後來補齊 state
- 驗證 planner 會重新開路

### Scenario 4: Similarity trap

- fixture 中已包含 `entity:resume-template`（語意與 resume analysis 相近，但不屬於分析 workflow）
- 驗證 planner 不會因語意相似而把 `entity:resume-template` 推薦為下一步
- 驗證 operationally relevant 的 `entity:generate-report` 排序高於 `entity:resume-template`

---

## 建議驗收輸出格式

若要做最小 CLI 驗收，建議輸出至少包含：

```json
{
  "session_id": "session-123",
  "goal": "state:analysis-complete",
  "next_actions": [
    {
      "entity_id": "entity:analyze-resume",
      "score": 0.93,
      "reason": "Leads toward goal and preconditions are satisfied"
    }
  ],
  "blocked_actions": [],
  "explanations": [
    {
      "entity_id": "entity:analyze-resume",
      "text": "Recommended because it leads toward analysis completion and the required uploaded-resume state is active."
    }
  ],
  "errors": []
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加最小驗收命令，建議形式像：

```bash
openclaw memory plan --session test-session --goal state:analysis-complete
openclaw memory plan --session test-session --goal state:analysis-complete --explain
openclaw memory plan --session test-session --goal state:analysis-complete --after-writeback
```

如果暫時沒有 CLI，也至少應有 integration tests 覆蓋：

- goal-aware ranking
- relation-aware weighting
- blocked-aware routing
- explanation output
- replanning after state updates

---

## 最小測試清單

Phase 7 至少要有以下測試：

- [ ] goal changes routing result
- [ ] `REQUIRES` outranks `SIMILAR` in planning
- [ ] `LEADS_TO` outranks `SIMILAR` in planning
- [ ] missing preconditions change next action suggestion
- [ ] completed skills are deprioritized
- [ ] blocked actions are deprioritized or explained
- [ ] planner explanations reference goal/state/relation semantics
- [ ] replanning after writeback works
- [ ] planner beats retrieval-only baseline on next-action quality
- [ ] planner avoids similarity traps

---

## 最後結論

如果你做完 Phase 7，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在不只是有 retrieval 和 runtime state，而是真的能根據 goal、states、relations、completed skills 與 blocked conditions 做出更合理、可解釋、可隨狀態更新的下一步規劃。

這句話成立，Phase 7 才算真的完成。
