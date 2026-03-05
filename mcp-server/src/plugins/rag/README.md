# Plugin: rag

Document indexing and semantic search for RAG (Retrieval-Augmented Generation) workflows.

**Primary use cases:**
- AI indexes documentation for quick retrieval
- AI searches indexed content by semantic similarity
- AI stores code snippets with metadata
- AI retrieves relevant context for LLM prompts

---

## Setup

No external dependencies. Uses in-memory vector store with cosine similarity.

Optional: For production, integrate with external vector DB via adapter pattern.

---

## Endpoints

### `POST /rag/index`

Index a single document.

```bash
curl -X POST http://localhost:8787/rag/index \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Authentication uses JWT tokens with 24h expiry...",
    "metadata": { "source": "docs", "topic": "auth" },
    "id": "doc-001"
  }'
```

### `POST /rag/index-batch`

Index multiple documents at once.

```bash
curl -X POST http://localhost:8787/rag/index-batch \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      { "content": "Doc 1...", "metadata": { "id": 1 } },
      { "content": "Doc 2...", "metadata": { "id": 2 } },
      { "content": "Doc 3...", "metadata": { "id": 3 } }
    ]
  }'
```

### `POST /rag/search`

Search indexed documents.

```bash
curl -X POST http://localhost:8787/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "JWT authentication",
    "limit": 5,
    "minScore": 0.1
  }'
```

**Response:**
```json
{
  "ok": true,
  "query": "JWT authentication",
  "total": 3,
  "results": [
    { "id": "doc-001", "score": 0.85, "content": "...", "metadata": {} },
    { "id": "doc-002", "score": 0.72, "content": "...", "metadata": {} }
  ]
}
```

### `GET /rag/documents/:id`

Get a specific document.

```bash
curl "http://localhost:8787/rag/documents/doc-001"
```

### `DELETE /rag/documents/:id`

Delete a document.

```bash
curl -X DELETE "http://localhost:8787/rag/documents/doc-001"
```

### `GET /rag/stats`

Get index statistics.

```bash
curl "http://localhost:8787/rag/stats"
```

### `POST /rag/clear`

Clear all documents (requires approval if policy configured).

```bash
curl -X POST http://localhost:8787/rag/clear
```

---

## MCP Tools

| Tool | Description | Tags |
|------|-------------|------|
| `rag_index` | Index a document | `WRITE`, `LOCAL_FS` |
| `rag_index_batch` | Batch index documents | `WRITE`, `LOCAL_FS`, `BULK` |
| `rag_search` | Semantic search | `READ`, `LOCAL_FS` |
| `rag_get` | Get document by ID | `READ` |
| `rag_delete` | Delete document | `WRITE` |
| `rag_stats` | Get index statistics | `READ` |

---

## Embedding

Uses simple word frequency vectors for similarity. For production:

1. Replace `createEmbedding()` with external service (OpenAI, Hugging Face)
2. Add vector dimension normalization
3. Persist to vector database (Pinecone, Weaviate, pgvector)

---

## Workflow Example

```bash
# 1. Read file from workspace
curl "http://localhost:8787/workspace/files?projectId=myapp&path=docs/api.md"

# 2. Index content in RAG
curl -X POST http://localhost:8787/rag/index \
  -d '{"content":"API docs content...","metadata":{"source":"api.md"}}'

# 3. Search for relevant context
curl -X POST http://localhost:8787/rag/search \
  -d '{"query":"authentication endpoints","limit":3}'

# 4. Use results for LLM prompt via brain plugin...
```
