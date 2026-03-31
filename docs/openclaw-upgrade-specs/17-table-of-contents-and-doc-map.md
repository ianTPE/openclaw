# Table Of Contents And Doc Map

本文件用來幫不同角色快速找到最適合自己的閱讀路徑。

如果你不想從頭一路翻完整包 spec，可以從這裡開始。

---

## 全部文件總覽

### Core Spec

- `00-purpose-and-goals.md`
- `00.5-openclaw-current-state-analysis.md`
- `01-architecture-overview.md`
- `02-boundaries-and-integration-contracts.md`
- `03-data-schema.md`
- `04-parser-and-validation-spec.md`
- `05-retrieval-runtime-spec.md`
- `06-phased-rollout-plan.md`

### Engineering Execution

- `07-file-and-module-blueprint.md`
- `08-api-and-interface-spec.md`
- `09-migration-guide.md`
- `10-implementation-tasks-checklist.md`

### Validation And Evaluation

- `11-test-plan.md`
- `12-benchmark-plan.md`

### Product And Communication

- `13-openclaw-prd.md`
- `14-one-page-summary.md`
- `14-one-page-summary.en.md`
- `15-blog-draft-openclaw-native-ctxfst.md`
- `16-slides-outline.md`

### Phase Validation Checklists

- `21-phase-1-validation-checklist.md`
- `22-phase-2-validation-checklist.md`
- `23-phase-3-validation-checklist.md`
- `24-phase-4-validation-checklist.md`
- `25-phase-5-validation-checklist.md`
- `26-phase-6-validation-checklist.md`
- `27-phase-7-validation-checklist.md`

### Examples

- `examples/minimal.ctxfst.md`
- `examples/full.ctxfst.md`
- `examples/retrieval-test.ctxfst.md`

### Maintenance And Upgrade Strategy

- `18-fork-maintenance-strategy.md`

### Architecture Options

- `19-plugin-architecture-option.md`

### Pre-Fork Checklist

- `20-gap-checklist-before-fork.md`

---

## 路徑 1：先看版

適合：

- 第一次接觸這個提案的人
- 想先快速理解這到底在做什麼的人

建議順序：

1. `14-one-page-summary.md`
2. `14-one-page-summary.en.md`
3. `00-purpose-and-goals.md`
4. `00.5-openclaw-current-state-analysis.md`
5. `01-architecture-overview.md`

預期收穫：

- 看懂升級目的
- 看懂五層架構
- 知道 MVP 先做什麼

---

## 路徑 2：實作版

適合：

- backend engineer
- search / retrieval engineer
- implementation owner

建議順序：

1. `03-data-schema.md`
2. `04-parser-and-validation-spec.md`
3. `05-retrieval-runtime-spec.md`
4. `07-file-and-module-blueprint.md`
5. `08-api-and-interface-spec.md`
6. `10-implementation-tasks-checklist.md`
7. `09-migration-guide.md`
8. `18-fork-maintenance-strategy.md`
9. `19-plugin-architecture-option.md`
10. `20-gap-checklist-before-fork.md`

預期收穫：

- 看懂該加哪些 schema
- 看懂要新增哪些模組與 interface
- 看懂實作順序與切 task 方式

---

## 路徑 3：驗證版

適合：

- QA
- research engineer
- PM 想看是否真的有成效

建議順序：

1. `11-test-plan.md`
2. `12-benchmark-plan.md`
3. `10-implementation-tasks-checklist.md`
4. `05-retrieval-runtime-spec.md`
5. `21-phase-1-validation-checklist.md`（以此類推，每個 phase 對應一份）

預期收穫：

- 看懂要怎麼測 parser / retrieval / runtime
- 看懂怎麼比較 chunk-only 與 entity-aware retrieval
- 看懂什麼才算「真的有提升」
- 每個 phase 有明確的驗收清單可照著跑

---

## 路徑 4：提案版

適合：

- PM
- tech lead
- 對外溝通或提案使用

建議順序：

1. `14-one-page-summary.md`
2. `13-openclaw-prd.md`
3. `12-benchmark-plan.md`
4. `16-slides-outline.md`
5. `15-blog-draft-openclaw-native-ctxfst.md`
6. `18-fork-maintenance-strategy.md`
7. `19-plugin-architecture-option.md`

預期收穫：

- 有一頁式摘要可先對齊
- 有 PRD 可做正式提案
- 有簡報與 blog 草稿可做對外輸出

---

## 如果你只有 5 分鐘

只看：

1. `14-one-page-summary.md`
2. `16-slides-outline.md`

---

## 如果你只有 15 分鐘

看：

1. `14-one-page-summary.md`
2. `00.5-openclaw-current-state-analysis.md`
3. `01-architecture-overview.md`
4. `05-retrieval-runtime-spec.md`
5. `10-implementation-tasks-checklist.md`

---

## 如果你準備真的開工

fork 前先確認 gap：

1. `20-gap-checklist-before-fork.md`

再看核心 spec：

2. `03-data-schema.md`
3. `04-parser-and-validation-spec.md`
4. `05-retrieval-runtime-spec.md`
5. `07-file-and-module-blueprint.md`
6. `08-api-and-interface-spec.md`
7. `10-implementation-tasks-checklist.md`

然後補齊驗證與維護策略：

8. `11-test-plan.md`
9. `12-benchmark-plan.md`
10. `21-phase-1-validation-checklist.md` 到 `27-phase-7-validation-checklist.md`（每做完一個 phase 就看對應的）
11. `18-fork-maintenance-strategy.md`
12. `19-plugin-architecture-option.md`

---

## 如果你要對外講這件事

建議順序：

1. `14-one-page-summary.md`
2. `14-one-page-summary.en.md`
3. `15-blog-draft-openclaw-native-ctxfst.md`
4. `16-slides-outline.md`
5. `00.5-openclaw-current-state-analysis.md`
6. `20-gap-checklist-before-fork.md`

---

## 最後建議

若你是這個專案的 owner，最推薦的工作節奏是：

1. 先用 `14-one-page-summary.md` 和團隊對齊方向
2. 再用 `13-openclaw-prd.md` 確認範圍
3. 用 `10-implementation-tasks-checklist.md` 排期
4. 用 `11-test-plan.md` 與 `12-benchmark-plan.md` 定義驗收

這樣比較不容易發生：

- 文件很多但沒人知道先看哪個
- 工程先做了，但 benchmark 還沒設計
- 提案寫完了，但 implementation 還沒被拆清楚
