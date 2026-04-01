# OpenClaw CtxFST Upgrade Specs

本目錄定義 OpenClaw 要原生支援 `CtxFST` 時所需的升級規格。

目標不是把 `.md` 換成另一種 Markdown 而已，而是把 OpenClaw 的記憶層從：

- `text chunk retrieval`

升級成：

- `chunk + entity + state + relation`

四層模型。

---

## 文件清單

- `00-purpose-and-goals.md`
  - 升級目的、非目標、核心價值
- `00.5-openclaw-current-state-analysis.md`
  - 基於官方文件整理的 OpenClaw 當前 memory / plugin / context engine 現況
- `01-architecture-overview.md`
  - 整體架構、資料流、模組切分
- `02-boundaries-and-integration-contracts.md`
  - 各模組邊界、責任分工、介面契約
- `03-data-schema.md`
  - documents / chunks / entities / edges / world state 的資料 schema
- `04-parser-and-validation-spec.md`
  - `.ctxfst.md` parser、驗證規則、canonicalization
- `05-retrieval-runtime-spec.md`
  - entity-aware retrieval、graph expansion、runtime state、prompt adapter
- `06-phased-rollout-plan.md`
  - MVP 與分階段落地策略
- `07-file-and-module-blueprint.md`
  - 建議新增檔案、模組切分、function 命名方向
- `08-api-and-interface-spec.md`
  - parser / index / retrieval / runtime / prompt 的介面規格
- `09-migration-guide.md`
  - 從 chunk-only memory 遷移到四層模型的步驟
- `10-implementation-tasks-checklist.md`
  - 可排期、可分工、可驗收的工程任務清單
- `11-test-plan.md`
  - parser / retrieval / runtime 的測試策略
- `12-benchmark-plan.md`
  - chunk-only vs entity-aware vs graph-aware 的比較計畫
- `13-openclaw-prd.md`
  - 偏產品與專案提案格式的 PRD
- `14-one-page-summary.md`
  - 給 OpenClaw 團隊快速閱讀的一頁式總結
- `14-one-page-summary.en.md`
  - 一頁式摘要英文版
- `15-blog-draft-openclaw-native-ctxfst.md`
  - 對外說明用 blog 草稿
- `16-slides-outline.md`
  - 8 到 10 頁簡報大綱
- `17-table-of-contents-and-doc-map.md`
  - 全部文件的閱讀路徑與導覽地圖
- `18-fork-maintenance-strategy.md`
  - fork OpenClaw 後如何降低與 upstream 同步升級的維護成本
- `19-plugin-architecture-option.md`
  - 為什麼短期先 fork 驗證、長期再收斂成 plugin / hook 架構
- `20-gap-checklist-before-fork.md`
  - 真正 fork 前應先去 upstream repo 確認的 gap 與入口點清單
- `21-phase-1-validation-checklist.md`
  - Phase 1 Parser MVP 驗收清單
- `22-phase-2-validation-checklist.md`
  - Phase 2 Entity-Aware Indexing 驗收清單
- `23-phase-3-validation-checklist.md`
  - Phase 3 Entity-Aware Retrieval 驗收清單
- `24-phase-4-validation-checklist.md`
  - Phase 4 Graph Expansion 驗收清單
- `25-phase-5-validation-checklist.md`
  - Phase 5 Prompt Adapter 驗收清單
- `26-phase-5-cli-smoke-tests.md`
  - Phase 5 CLI Smoke Test 指令清單
- `27-phase-6-validation-checklist.md`
  - Phase 6 Runtime State 驗收清單
- `27.5-phase-6-smoke-tests.md`
  - Phase 6 Validation Smoke Test 指令清單
- `28-phase-7-validation-checklist.md`
  - Phase 7 Planner And Routing 驗收清單
- `examples/minimal.ctxfst.md`
  - 最小合法 `.ctxfst.md` 範例
- `examples/full.ctxfst.md`
  - 含 state / preconditions / postconditions 閉環的完整 `.ctxfst.md` 範例
- `examples/retrieval-test.ctxfst.md`
  - retrieval / graph / runtime / planner 驗收用的豐富 fixture（10 entities、8 chunks、完整 workflow 閉環）

---

## 一句話總結

如果 `CH23` 的 OpenClaw 是「可被外部檢查與修正的 memory backend」，
那這組 spec 要把它推進成「原生理解 semantic world model 的 runtime」。

---

## 設計來源

本目錄依據下列 `CtxFST` 規格與欄位語意整理：

- `/home/iantpe/ctxfst/skill-chunk-md/SKILL.md`
- `/home/iantpe/ctxfst/skill-chunk-md/references/ctxfst-spec.md`

---

## 核心原則

1. `CtxFST` 是 OpenClaw 的原生 memory format 之一，不只是匯入前的中介格式。
2. `chunks` 仍保留向量檢索價值，但不再是唯一語意單位。
3. `entities` 是 graph、routing、explainability、memory debug 的骨架。
4. `preconditions` / `postconditions` / `state_refs` 只有在 runtime state 存在時才有 operational value。
5. Prompt 不直接 dump schema，而是透過 adapter 輸出世界模型摘要。

---

## 建議閱讀順序

### 如果你是第一次看這包文件

建議順序：

1. `17-table-of-contents-and-doc-map.md`
2. `14-one-page-summary.md`
3. `00-purpose-and-goals.md`
4. `00.5-openclaw-current-state-analysis.md`
5. `01-architecture-overview.md`
6. `03-data-schema.md`
7. `05-retrieval-runtime-spec.md`
8. `06-phased-rollout-plan.md`

### 如果你準備開始實作

建議順序：

1. `17-table-of-contents-and-doc-map.md`
2. `20-gap-checklist-before-fork.md`
3. `07-file-and-module-blueprint.md`
4. `08-api-and-interface-spec.md`
5. `10-implementation-tasks-checklist.md`
6. `21-phase-1-validation-checklist.md`（以此類推，每做完一個 phase 就看對應的 validation checklist）
7. `09-migration-guide.md`
8. `18-fork-maintenance-strategy.md`
9. `19-plugin-architecture-option.md`

### 如果你要做提案或和團隊對齊

建議順序：

1. `17-table-of-contents-and-doc-map.md`
2. `14-one-page-summary.md`
3. `13-openclaw-prd.md`
4. `12-benchmark-plan.md`

---

## 不同角色建議看哪幾份

### Engineering Lead

- `14-one-page-summary.md`
- `00.5-openclaw-current-state-analysis.md`
- `01-architecture-overview.md`
- `06-phased-rollout-plan.md`
- `10-implementation-tasks-checklist.md`
- `19-plugin-architecture-option.md`

### Backend / Infrastructure Engineer

- `03-data-schema.md`
- `07-file-and-module-blueprint.md`
- `08-api-and-interface-spec.md`
- `09-migration-guide.md`
- `18-fork-maintenance-strategy.md`
- `19-plugin-architecture-option.md`
- `20-gap-checklist-before-fork.md`

### Retrieval / Search Engineer

- `05-retrieval-runtime-spec.md`
- `08-api-and-interface-spec.md`
- `11-test-plan.md`
- `12-benchmark-plan.md`
- `18-fork-maintenance-strategy.md`
- `19-plugin-architecture-option.md`
- `20-gap-checklist-before-fork.md`

### PM / Product / Research

- `00-purpose-and-goals.md`
- `00.5-openclaw-current-state-analysis.md`
- `13-openclaw-prd.md`
- `12-benchmark-plan.md`

---

## 最短導讀

如果你只有 5 分鐘，先看：

1. `17-table-of-contents-and-doc-map.md`
2. `14-one-page-summary.md`
3. `13-openclaw-prd.md`

如果你只有 15 分鐘，接著再看：

4. `01-architecture-overview.md`
5. `05-retrieval-runtime-spec.md`
6. `19-plugin-architecture-option.md`
7. `20-gap-checklist-before-fork.md`
