# RAG Ingestion Plugin

Document ingestion pipeline for MCP-Hub. Prepares documents for high-quality retrieval by chunking and enriching before indexing.

## Overview

The `rag-ingestion` plugin processes documents into retrieval-optimized chunks and indexes them via the existing RAG plugin. It **extends** the system without replacing it.

## Pipeline Architecture

The pipeline has six stages:

```
loader → normalizer → chunker → metadata enricher → embedding (optional) → indexer
```

| Stage | Purpose |
|-------|---------|
| **Loader** | Load raw content from markdown, text, or PDF (with OCR abstraction) |
| **Normalizer** | Normalize whitespace, line endings, collapse extra newlines |
| **Chunker** | Split into chunks using configurable strategy |
| **Metadata Enricher** | Add documentId, sourceType, custom metadata to chunks |
| **Embedding** | Placeholder; RAG plugin embeds at index time |
| **Indexer** | Send chunks to RAG via `rag_index_batch` |

## Chunking Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed` | Fixed-size chunks with optional overlap | Uniform text |
| `heading` | Split at markdown headings (# ## ###) | Structured docs |
| `sliding` | Sliding window with overlap | General text |
| `semantic` | Placeholder: heading if structure, else sliding | Mixed content |

Strategy is configurable per request via `chunkStrategy`.

## Example Ingestion Flow

### Sync ingest (small document)

```bash
curl -X POST http://localhost:8787/rag-ingestion/ingest \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-1" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "# Introduction\n\nThis is the content.",
    "format": "markdown",
    "chunkStrategy": "heading"
  }'
```

### Async ingest (large document)

```bash
curl -X POST http://localhost:8787/rag-ingestion/ingest \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-1" \
  -d '{"content": "...", "async": true}'
# Returns: { "jobId": "uuid", "state": "queued" }

curl http://localhost:8787/rag-ingestion/status/{jobId}
```

### Preview chunks (no indexing)

```bash
curl -X POST http://localhost:8787/rag-ingestion/preview-chunks \
  -H "Content-Type: application/json" \
  -d '{"content": "# A\n\nSection 1.\n\n## B\n\nSection 2.", "chunkStrategy": "heading"}'
```

## Supported Sources

| Format | Loader | Notes |
|--------|--------|-------|
| Markdown | `loadMarkdown` | Structure-aware |
| Plain text | `loadText` | Simple trim |
| PDF | `loadPdf` | Text-based via pdf-parse; scanned needs OCR |

## PDF and OCR Abstraction

- **Text-based PDFs**: Uses `pdf-parse`.
- **Scanned PDFs**: Register an OCR provider; no hardcoded provider.

```javascript
import { registerOcrProvider } from "./ocr/index.js";
registerOcrProvider("my-ocr", new MyOcrProvider(config));
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/rag-ingestion/ingest` | Ingest document (sync or async) |
| POST | `/rag-ingestion/ingest-markdown` | Ingest markdown |
| POST | `/rag-ingestion/preview-chunks` | Preview chunks without indexing |
| POST | `/rag-ingestion/reindex` | Reindex document with new strategy |
| GET | `/rag-ingestion/status/:jobId` | Get async job status |
| GET | `/rag-ingestion/health` | Plugin health |

## MCP Tools

- `ingest_document` — Ingest document (markdown, text, PDF)
- `ingest_markdown` — Ingest markdown with heading-aware chunking
- `preview_chunks` — Preview chunking without indexing
- `reindex_document` — Reindex existing RAG document
- `get_ingestion_status` — Get async ingestion job status

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_INGESTION_MAX_DOCUMENT_SIZE` | 5MB | Max document size |
| `RAG_INGESTION_CHUNK_SIZE` | 1500 | Default chunk size |
| `RAG_INGESTION_CHUNK_OVERLAP` | 150 | Chunk overlap |
| `RAG_INGESTION_MAX_CHUNKS` | 100 | Max chunks per document |
| `RAG_INGESTION_TIMEOUT_MS` | 60000 | Pipeline timeout |

## Integration

- **Workspace**: `x-workspace-id` header; all operations scoped
- **Job queue**: `rag.ingestion` job type for async
- **Audit**: All operations logged
- **Observability**: Uses audit-based metrics
