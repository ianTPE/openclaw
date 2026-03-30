# Blog Draft: 如何讓 OpenClaw 原生理解 CtxFST

## 標題備選

- 如何讓 OpenClaw 原生理解 `CtxFST`：從 chunk-only memory 到 semantic world model
- OpenClaw 不只要讀 Markdown：為什麼它需要 `chunk + entity + state + relation`
- 讓 OpenClaw 真正吃懂 `CtxFST`，核心不是換格式，而是升級記憶層

---

## 開場

如果你今天已經有一套 agent memory system，而且它能做 chunking、vector retrieval、全文搜尋，看起來其實已經很完整了。

但只要你開始接觸 `CtxFST` 這種格式，你很快就會發現一件事：

> **讓系統讀得懂 `.ctxfst.md`，不等於讓它真正理解 `CtxFST`。**

因為 `CtxFST` 的價值，從來不只在文字內容本身。

它真正提供的是一組更高階的知識結構：

- `entities`
- `chunks[].entities`
- `preconditions`
- `postconditions`
- `state_refs`
- multi-relation edges

也就是說，如果一個系統最後仍然只把文件當成一堆文字片段來索引，那它即使「支援」了 `CtxFST`，也還只是格式層面的支援，而不是語意層面的支援。

這也是為什麼，我認為如果要讓 OpenClaw 原生理解 `CtxFST`，核心不是把 `.md` 換格式，而是把記憶層從：

> **text chunk retrieval**

升級成：

> **chunk + entity + state + relation**

四層模型。

---

## 為什麼 chunk-only memory 不夠

傳統的 chunk-based memory 有幾個很實際的限制。

第一，它擅長找相似文字，但不一定擅長找穩定概念。

第二，它通常缺少 canonical entity 層，所以遇到 alias、縮寫、專有名詞時，召回品質會很不穩定。

第三，它通常沒有 runtime state 可以承接 operational metadata。這代表像 `preconditions`、`postconditions`、`state_refs` 這些欄位，就算你寫進文件，也很難真正被系統利用。

第四，它通常沒有 relation-aware graph layer，所以系統看到的是「這段文字和 query 很像」，卻很難回答：

- 這個技能需要什麼前置條件？
- 這個狀態接下來會 lead to 什麼？
- 目前卡住的原因是什麼？
- 下一步最合理的 action 是哪個？

這些問題，不是單靠 chunk retrieval 就能自然長出來的。

---

## `CtxFST` 真正想提供什麼

`CtxFST` 的核心設計，其實是在把知識從「文章」整理成「世界模型」。

最前面的版本，你可以把它理解成一種結構化 Markdown：它把 `chunks` 和 `entities` 拆開，讓 chunk 成為內容載體，讓 entity 成為語意索引。

再往後走，它開始承接更多 operational metadata：

- `preconditions`
- `postconditions`
- `state_refs`
- `REQUIRES`
- `LEADS_TO`
- `COMPLETED`
- `BLOCKED_BY`

到了這一步，`CtxFST` 已經不只是給 GraphRAG 用的 ingestion format，而是一種可以支撐 retrieval、planning、writeback、memory debug 的 semantic world model format。

所以，如果 OpenClaw 只 ingest `CtxFST` 的 chunk content，而不 ingest entity、state、relation 這些層，那它其實只吃到了最表面的那一層。

---

## 如果要升級 OpenClaw，應該怎麼切

我認為最穩的方式，不是一次大改，而是拆成五個模組。

### 1. Parser Layer

先讓 OpenClaw 真正讀得懂 `.ctxfst.md`。

這裡要做的不是單純 parse YAML，而是要把文件還原成 canonical document model，至少包含：

- `document`
- `chunks[]`
- `entities[]`

同時還要做基本一致性驗證，例如：

- `chunks[].entities` 是否都存在於 `entities[].id`
- body 裡的 `<Chunk id="...">` 是否和 frontmatter 內的 `chunks[].id` 對得起來

### 2. Index Layer

接著要把 storage schema 從 chunk-only 擴成至少四類：

- `documents`
- `chunks`
- `entities`
- `edges`

如果沒有 entity layer 和 chunk-to-entity mapping，OpenClaw 永遠做不到真正的 entity-aware retrieval。

### 3. Retrieval Layer

查詢流程也要改。

它不應該再只是：

```text
query -> vector search -> top-k chunks
```

而應該變成：

```text
query
  -> entity match
  -> chunk retrieval
  -> graph expansion
  -> fusion / rerank
  -> context pack
```

這樣系統才不只是找到像的文字，而是開始理解 query 指向哪些概念、哪些依賴、哪些下一步。

### 4. Runtime / State Layer

如果你真的想吃到 `preconditions` / `postconditions` 的紅利，就要讓 OpenClaw 維護 world state。

至少要有：

- `goal`
- `active_states`
- `completed_skills`
- `blocked_by`

沒有這層，很多 operational metadata 其實只是靜態 decoration。

### 5. Prompt Adapter Layer

最後，別把整份 `CtxFST` 原文直接塞進 prompt。

比較好的做法，是加一個 adapter，把結構化資料整理成模型真的需要的摘要，例如：

- active user states
- relevant entities
- retrieved chunks
- missing preconditions
- suggested next actions

這樣模型看到的是「世界模型摘要」，不是 raw schema dump。

---

## 最小可行版應該長什麼樣

如果你不想一開始就做太大，我會建議 MVP 只做四件事：

1. OpenClaw 可以 ingest `.ctxfst.md`
2. 系統可索引 `entities` 與 `chunk_entities`
3. query 時同時檢索 entities 與 chunks
4. prompt 組裝時同時輸出 relevant entities 與 supporting chunks

做到這裡，其實就已經足以說：

> **OpenClaw 已原生初步支援 `CtxFST`。**

這個階段最大的價值，不是 planner，而是 retrieval quality 會先明顯提升，尤其在：

- 專有名詞查詢
- alias 查詢
- canonical concept retrieval

這些場景裡，差異通常會很明顯。

---

## 什麼時候再做 runtime state 和 planner

我會把 runtime state 放在第二階段，把 planner / routing 放在更後面。

原因很簡單。

如果 parser、schema、entity-aware retrieval 這三層還沒穩，你太早做 planner，只會讓系統看起來很聰明，但底層資料模型其實還沒站穩。

比較穩的順序是：

1. parser
2. indexing
3. entity-aware retrieval
4. prompt adapter
5. runtime state
6. planner / routing

這樣每一層的責任清楚，也更容易 benchmark 和 debug。

---

## 這和 CH23 的關係是什麼

如果你看過 [`CtxFST CH23`](https://e25a.citrine.top/blog/2026-03-16-ctxfst-ch23-openclaw-memory-debuggable-memory/)（全名：「讓 AI 記憶可以被看見、搜尋、修正：用 OpenClaw 做一個可除錯 memory loop」），你會發現那一章的重點是：

> **把 AI 記憶從黑箱變成可檢查、可搜尋、可修正的 artifact。**

那一章的 OpenClaw，比較像一個可被外部 inspect / repair / reindex 的 memory backend。

而這次升級要做的事情，是再往前推一步：

> **讓 OpenClaw 自己原生理解這些結構，而不是只在外部把它們打開來修。**

所以不是取代 `CH23` 的精神，而是把它從「外部 debug loop」推進成「內建 semantic memory runtime」。

前者強調 debugability。
後者強調 native understanding。

最理想的狀態，是兩者都保留。

---

## 收尾

如果要總結成一句話，我會這樣說：

> **讓 OpenClaw 原生支援 `CtxFST`，不是教它讀另一種 Markdown，而是讓它從 chunk-based memory 升級成真正理解 entity、state、relation 的世界模型 runtime。**

這個升級聽起來像是 memory feature 的擴充，但它的真正影響，其實會一路延伸到 retrieval、routing、prompting、debugging、甚至整個 agent architecture。

而這也是它值得被當成一個完整專案來做的原因。
