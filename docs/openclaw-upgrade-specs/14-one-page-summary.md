# OpenClaw CtxFST Upgrade One-Page Summary

## 一句話

這個升級的目標，是把 OpenClaw 的記憶層從「文字片段檢索」升級成「`chunk + entity + state + relation` 四層模型」。

---

## 為什麼要做

目前 chunk-only memory 的問題是：

- 找得到相似文字，不等於理解概念結構
- 專有名詞、alias、canonical entity 召回不穩
- `preconditions` / `postconditions` / `state_refs` 沒有 runtime 可承接
- prompt 只能塞扁平文字，難以表達 world model

而 `CtxFST` 的真正價值在於它不只描述 chunks，還描述：

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- 多種 relation edges

---

## 升級後會變成什麼

從：

```text
markdown -> chunks -> vector/fts -> prompt
```

變成：

```text
.ctxfst.md
  -> parser + validator
  -> documents / chunks / entities / edges
  -> entity-aware retrieval
  -> graph expansion
  -> runtime state
  -> prompt adapter
```

---

## 核心模組

### 1. Parser Layer

- 讀 `.ctxfst.md`
- parse frontmatter 與 `<Chunk>`
- 驗證 entity/chunk references

### 2. Index Layer

- 儲存 `documents`
- 儲存 `chunks`
- 儲存 `entities`
- 儲存 `entity_edges`

### 3. Retrieval Layer

- entity name / alias match
- entity -> chunk reverse lookup
- vector / keyword chunk retrieval
- graph expansion

### 4. Runtime / State Layer

- 維護 `goal`
- 維護 `active_states`
- 處理 `preconditions` / `postconditions`
- 寫入 `COMPLETED` / `BLOCKED_BY`

### 5. Prompt Adapter Layer

- 不直接 dump schema
- 只輸出模型真正需要的世界模型摘要

---

## MVP 先做什麼

MVP 只做這四件事：

1. 可 ingest `.ctxfst.md`
2. 可索引 `entities` 與 `chunk_entities`
3. query 時同時利用 entity 與 chunk retrieval
4. prompt 組裝時同時輸出 relevant entities 與 supporting chunks

做到這裡，就可以說：

> OpenClaw 已原生初步支援 `CtxFST`

---

## 先不要太早做什麼

第一版先不要急著：

- 做完整 planner
- 做複雜多跳 graph expansion
- 把所有 runtime 決策都塞進 prompt

原因是這樣會讓範圍失控，也很難驗證基礎層有沒有真的做好。

---

## 怎麼驗證這件事有沒有價值

至少要做三種比較：

1. chunk-only retrieval
2. chunk + entity retrieval
3. chunk + entity + graph expansion

重點要看：

- exact entity query 表現有沒有提升
- alias query 表現有沒有提升
- semantic query 有沒有退化
- graph expansion 是不是只增加噪音

---

## 專案成功的標誌

如果以下幾件事成立，這個升級就算成功：

1. `.ctxfst.md` ingestion 穩定
2. entity exact / alias hit rate 提升
3. prompt context 能穩定包含 relevant entities + supporting chunks
4. relation-sensitive query 品質提升
5. 後續 runtime state 可以自然接上

---

## 推薦閱讀

如果要快速進入細節，建議看：

1. `01-architecture-overview.md`
2. `03-data-schema.md`
3. `05-retrieval-runtime-spec.md`
4. `10-implementation-tasks-checklist.md`
