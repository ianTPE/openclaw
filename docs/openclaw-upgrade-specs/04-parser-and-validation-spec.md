# Parser And Validation Spec

## 目標

讓 OpenClaw 可以正確 ingest `.ctxfst.md`，並把它還原成可被 index / retrieval 使用的 canonical model。

---

## 輸入格式

Parser 至少要支援：

1. YAML frontmatter
2. `entities[]`
3. `chunks[]`
4. body 內的 `<Chunk id="..."> ... </Chunk>`

---

## Canonical Output Model

### Document

```text
DocumentRecord {
  id
  title
  source_path
  format
  source_hash
  document_version
  metadata
}
```

### Entity

```text
EntityRecord {
  id
  name
  type
  aliases[]
  preconditions[]
  postconditions[]
  related_skills[]
  metadata
}
```

### Chunk

```text
ChunkRecord {
  id
  context
  content
  tags[]
  entities[]
  state_refs[]
  priority
  version
  created_at
  dependencies[]
  metadata
}
```

---

## 必要驗證規則

### Rule 1: Entity ID uniqueness

- `entities[].id` 不可重複

### Rule 2: Chunk ID uniqueness

- `chunks[].id` 不可重複

### Rule 3: Chunk body mapping

- 每個 frontmatter chunk 都必須有對應 `<Chunk id="...">`
- body 出現的 `<Chunk id="...">` 也必須存在於 frontmatter

### Rule 4: Entity reference integrity

- `chunks[].entities[*]` 必須存在於 `entities[].id`

### Rule 5: State reference integrity

- `chunks[].state_refs[*]` 應存在於 `entities[].id`
- 若存在，最好是 `type = state`

### Rule 6: Enum validation

- `priority` 必須為 `low`, `medium`, `high`, `critical`
- `type` 必須落在支援的 entity type 集合

---

## Canonicalization

Parser 除了 validation，也應做 canonicalization。

### 建議 canonicalization 行為

- **entity ID 嚴格正規化**：務必使用 Regex 卡死並統一轉換為 lowercase kebab-case（例如將 `entity:OpenClaw` 或 `entity:open_claw` 全部統一轉為 `entity:open-claw`）。這是防呆的最重要防線，否則會產生大量重複的幽靈節點導致 Graph 斷裂。
- aliases 去重
- tags 去重
- 空陣列欄位標準化
- 缺失選填欄位補預設值
- relation names 正規化成 uppercase enum

---

## `<Chunk>` Tag Syntax

### 支援語法

MVP parser 只需要支援：

```html
<Chunk id="chunk-id">
...markdown content...
</Chunk>
```

### 規則

- `id` 為必要屬性
- 不支援 nested `<Chunk>` tags
- `<Chunk>` 內文視為原始 Markdown content
- 允許一般 Markdown 內嵌 HTML，但不允許另一個 `<Chunk>`

### Error handling

- unclosed `<Chunk>` 視為 fatal parse error
- nested `<Chunk>` 視為 fatal validation error
- 缺少 `id` 視為 fatal parse error

---

## Error Policy

### Fatal errors

- frontmatter parse failure
- duplicate entity ID
- duplicate chunk ID
- malformed or unclosed `<Chunk>` tag
- nested `<Chunk>` tag
- chunk body/frontmatter mapping mismatch
- chunk 引用不存在 entity

### Non-fatal warnings

- 未知 top-level key
- 未知 entity extension field
- `state_refs` 指到非 `state` type entity
- aliases 為空或重複
- 缺少推薦欄位如 `preconditions` / `postconditions`

---

## Parser Output Expectations

Index layer 不應再重新猜測文件語意。

Parser 應保證：

- body content 已與 chunk metadata 對齊
- entities 已完成基本清洗
- 所有 cross-reference 至少可被可靠查詢

---

## MVP parser scope

第一版至少做到：

1. `.ctxfst.md` detection
2. frontmatter parse
3. `<Chunk>` extraction
4. entity/chunk cross-reference validation
5. canonical document model output
