# Boundaries And Integration Contracts

## 模組邊界

本文件定義每個模組該做什麼，以及不該做什麼。

---

## Parser Layer

### 責任

- 檔案讀取與格式辨識
- frontmatter parse
- `<Chunk>` body parse
- 基本一致性驗證
- canonicalization

### 不負責

- 向量化
- relation inference scoring
- query-time retrieval
- runtime state mutation

### 契約

輸入：

- `.ctxfst.md` file content

輸出：

- canonical in-memory document model

---

## Index Layer

### 責任

- canonical model persistence
- version tracking
- source hash tracking
- chunk/entity/edge materialization

### 不負責

- LLM prompt formatting
- precondition execution policy
- agent planning strategy

### 契約

輸入：

- canonical document model

輸出：

- persistent indexed records

---

## Retrieval Layer

### 責任

- entity candidate generation
- direct entity match
- chunk vector retrieval
- graph expansion
- rerank / fusion

### 不負責

- 修改 source document
- 寫入 runtime completion edges
- 長期 state 決策

### 契約

輸入：

- user query
- indexed entities / chunks / edges
- optional session state

輸出：

- context pack

---

## Runtime / State Layer

### 責任

- state snapshot management
- precondition checking
- execution writeback
- runtime edge updates

### 不負責

- source document parsing
- chunk embedding retrieval
- final prompt wording

### 契約

輸入：

- execution result
- skill metadata
- current world state

輸出：

- updated world state
- runtime edges

---

## Prompt Adapter Layer

### 責任

- 將結構化 retrieval + runtime state 轉為 prompt context
- 控制 token budget
- 去重與排序

### 不負責

- schema validation
- index persistence
- edge computation

### 契約

輸入：

- context pack
- world state snapshot

輸出：

- prompt-ready structured summary

---

## 關鍵 integration contracts

### Contract 1: Parser -> Index

Parser 必須保證：

- chunk IDs 唯一
- entity IDs 唯一
- `chunks[].entities` 皆可解析
- body chunk 與 frontmatter chunk 一一對應

### Contract 2: Index -> Retrieval

Index 必須保證：

- entities 可直接 by-id / by-name / by-alias lookup
- chunks 可直接做 vector / FTS / metadata lookup
- edges 可直接以 relation filter 查詢

### Contract 3: Retrieval -> Prompt Adapter

Retrieval 必須輸出明確分層結果，而不是單一扁平文字串：

- relevant entities
- supporting chunks
- expanded relations
- missing states
- candidate next actions

### Contract 4: Runtime -> Retrieval

Runtime state 必須能影響 retrieval 排序，例如：

- active states 提高相關 state chunks 權重
- blocked entities 降權或標記
- completed skills 避免重複推薦
