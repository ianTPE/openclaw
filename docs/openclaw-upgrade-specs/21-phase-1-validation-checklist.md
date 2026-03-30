# Phase 1 Validation Checklist

## 目的

本文件定義 `Phase 1: Parser MVP` 完成後，應如何驗證 OpenClaw 對 `.ctxfst.md` 的初步支援是否真的成立。

Phase 1 的驗證重點不是 retrieval quality，也不是 runtime world state。

重點只有一件事：

> 系統能不能穩定地把 `.ctxfst.md` 讀成正確的 canonical document model，並在格式錯誤時正確報錯。

---

## 驗收範圍

Phase 1 驗證只涵蓋：

- format detection
- parser
- validator
- canonicalization
- ingestion routing

Phase 1 驗證不涵蓋：

- entity-aware retrieval
- graph expansion
- runtime state
- prompt adapter

---

## 驗收標準總表

當以下 6 點都成立時，可視為 Phase 1 完成：

1. `minimal.ctxfst.md` 可 parse 成功
2. `full.ctxfst.md` 可 parse 成功
3. 常見 fatal cases 會正確失敗
4. canonical output shape 穩定
5. 舊 `.md` ingestion path 不受影響
6. `.ctxfst.md` 會被正確分流到新 parser

---

## A. Happy Path 驗證

### Case A1: Minimal fixture

輸入：

- `examples/minimal.ctxfst.md`

要驗證：

- parse 成功
- `entities[]` 數量正確
- `chunks[]` 數量正確
- chunk body 與 frontmatter mapping 正確

預期結果：

- `ok = true`
- `entity_count = 1`
- `chunk_count = 1`
- `errors = []`

### Case A2: Full fixture

輸入：

- `examples/full.ctxfst.md`

要驗證：

- parse 成功
- `entities[]` / `chunks[]` / `state_refs` 都能正確讀出
- optional fields 不會讓 parser 出錯

預期結果：

- `ok = true`
- entity / chunk counts 正確
- warning 可有，但不應有 fatal error

---

## B. Fatal Error 驗證

### Case B1: Duplicate entity IDs

要驗證：

- validator 正確報錯
- 不產生半套 canonical model

### Case B2: Duplicate chunk IDs

要驗證：

- validator 正確報錯

### Case B3: Missing entity reference

情境：

- `chunks[].entities` 指向不存在的 entity

要驗證：

- validator 正確報錯

### Case B4: Chunk body/frontmatter mismatch

情境：

- frontmatter 有 chunk，但 body 缺少對應 `<Chunk>`
- 或 body 有 `<Chunk>`，但 frontmatter 沒宣告

要驗證：

- validator 正確報錯

### Case B5: Unclosed `<Chunk>` tag

要驗證：

- parser 視為 fatal parse error

### Case B6: Nested `<Chunk>` tag

要驗證：

- parser 或 validator 視為 fatal error

### Case B7: Invalid format or unsupported version

情境：

- frontmatter 缺少 `version` 或宣告了未來不支援的版本（例如 `version: 3.0`），或 `format` 錯誤

要驗證：

- validator 正確攔截並報錯，不向下執行 parser

---

## C. Canonicalization 驗證

### Case C1: aliases dedupe

要驗證：

- 重複 aliases 被去重

### Case C2: tags dedupe

要驗證：

- 重複 tags 被去重

### Case C3: default value injection

要驗證：

- 缺失選填欄位時，canonical output 仍是穩定 shape

### Case C4: enum normalization

要驗證：

- `priority` / relation names 若允許 normalization，會被正規化

### Case C5: Whitespace normalization

情境：

- entity ID 或 tags/aliases 帶有多餘的空白（例如 `id: " entity:fastapi "`）

要驗證：

- canonicalization 階段會自動清理（trim）多餘空白，避免下游產生幽靈 ID 或 mapping 錯誤

---

## D. Canonical Model Shape 驗證

### DocumentRecord

最少應包含：

- `id`
- `source_path`
- `format`
- `source_hash` 或可延後填入的欄位位置

### ChunkRecord

最少應包含：

- `id`
- `context`
- `content`
- `entities`

### EntityRecord

最少應包含：

- `id`
- `name`
- `type`

### 驗證重點

要確認：

- 同一份輸入檔，每次 parse 後輸出結構一致
- 下游 indexer 不需要再猜資料 shape

---

## E. Ingestion Routing 驗證

### Case E1: Existing `.md` path still works

要驗證：

- 舊 `.md` 文件仍走既有 parser / ingestion path
- 不因新增 `CtxFST` parser 而壞掉

### Case E2: `.ctxfst.md` routes to new parser

要驗證：

- `.ctxfst.md` 檔名或內容特徵會觸發新 loader

### Case E3: Mixed repo ingestion

要驗證：

- repo 同時存在 `.md` 與 `.ctxfst.md` 時，兩者都能被正確辨識

---

## 建議的驗收輸出格式

若要做一個簡單 CLI 驗收入口，建議輸出格式至少包含：

```json
{
  "ok": true,
  "format": "ctxfst",
  "entity_count": 4,
  "chunk_count": 2,
  "warnings": [],
  "errors": []
}
```

---

## 建議驗收指令

如果 OpenClaw 願意加一個最小驗收命令，建議形式像：

```bash
openclaw memory validate examples/minimal.ctxfst.md
openclaw memory validate examples/full.ctxfst.md
```

如果暫時沒有 CLI，也至少要有可在 test suite 內重複跑的 validator entrypoint。

---

## 最小測試清單

Phase 1 至少要有以下測試：

- [ ] minimal fixture success
- [ ] full fixture success
- [ ] duplicate entity IDs fail
- [ ] duplicate chunk IDs fail
- [ ] missing entity reference fail
- [ ] body/frontmatter mismatch fail
- [ ] unclosed `<Chunk>` fail
- [ ] nested `<Chunk>` fail
- [ ] invalid format/version fail
- [ ] canonicalization works
- [ ] whitespace normalization works
- [ ] legacy `.md` ingestion not broken
- [ ] `.ctxfst.md` routing works

---

## 最後結論

如果你做完 Phase 1，卻還不能回答下面這句話，那就代表還沒驗完：

> 我現在已經能穩定地把合法 `.ctxfst.md` 轉成 canonical model，並且對常見格式錯誤做出正確且可重複的失敗行為。

這句話成立，Phase 1 才算真的完成。
