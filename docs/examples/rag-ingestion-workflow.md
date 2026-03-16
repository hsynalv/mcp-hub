# RAG Ingestion Workflow Example

Example configuration for document ingestion and semantic search.

## Prerequisites

- `OPENAI_API_KEY` for real embeddings (or use keyword fallback)
- RAG and rag-ingestion plugins enabled

## Configuration

```env
# Required for semantic search (omit for keyword fallback)
OPENAI_API_KEY=sk-your-key-here

# RAG settings
RAG_MAX_DOCUMENT_SIZE=10485760
RAG_MAX_CHUNK_SIZE=1500
RAG_CHUNK_OVERLAP=150

# Ingestion (optional)
RAG_INGESTION_CHUNK_SIZE=1000
RAG_INGESTION_CHUNK_OVERLAP=150
```

## Workflow

### 1. Ingest a Document (REST)

```bash
curl -X POST http://localhost:8787/rag-ingestion/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -d '{
    "content": "# My Document\n\nThis is sample content for indexing.",
    "format": "markdown",
    "chunkStrategy": "sliding"
  }'
```

### 2. Ingest via MCP Tool

Use the `ingest_document` tool from the rag-ingestion plugin with content and format.

### 3. Search

```bash
curl -X POST http://localhost:8787/tools/rag/rag_search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -d '{
    "query": "sample content",
    "limit": 5,
    "minScore": 0.1
  }'
```

## Chunk Strategies

| Strategy | Best For |
|----------|----------|
| `fixed` | Uniform text, code |
| `heading` | Markdown with headers |
| `sliding` | General purpose (default) |
| `semantic` | Requires embedding model |

## Workspace Isolation

Pass `x-workspace-id` header to scope ingestion and search to a workspace:

```bash
curl -X POST http://localhost:8787/rag-ingestion/ingest \
  -H "x-workspace-id: my-workspace" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"content": "...", "format": "markdown"}'
```

## Evaluation

Use retrieval evals to compare chunk strategies:

```bash
npm run eval:run
npm run eval:compare
```

See [Retrieval Evaluation](../retrieval-evals.md) for details.
