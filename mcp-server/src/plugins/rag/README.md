# RAG Plugin

Belge indeksleme ve semantik arama - workspace izolasyonu ve audit logging ile.

## Overview

Bu plugin dokümanları indeksler ve semantik arama yapar. Özellikler:
- Workspace-based izolasyon (cross-workspace sızıntı yok)
- Otomatik chunking with size limits
- Audit logging (içerik loglanmaz)
- **Metadata sanitization** (sadece güvenli alanlar döner)
- **Store abstraction** (memory/pgvector/sqlite/qdrant desteği)

## Endpoints

| Endpoint | Method | Scope | Açıklama |
|----------|--------|-------|----------|
| `/rag/index` | POST | write | Belge indeksle |
| `/rag/index-batch` | POST | write | Toplu belge indeksle (max 100) |
| `/rag/search` | POST | read | Semantik arama |
| `/rag/documents/:id` | GET | read | Belge detayı getir |
| `/rag/documents/:id` | DELETE | write | Belge sil |
| `/rag/stats` | GET | read | Workspace istatistikleri |
| `/rag/clear` | POST | danger | Tüm belgeleri sil |
| `/rag/health` | GET | read | Sağlık kontrolü |
| `/rag/audit` | GET | read | Audit log görüntüle |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `rag_index` | Tek belge indeksle |
| `rag_index_batch` | Toplu indeksleme |
| `rag_search` | Semantik arama |
| `rag_get` | Belge detayı |
| `rag_delete` | Belge sil |
| `rag_stats` | İstatistikler |

## Güvenlik Özellikleri

### 1. Workspace Izolasyonu
- Her workspace kendi indeksine sahip
- Cross-workspace retrieval engellenir
- Workspace ID header (`x-workspace-id`) zorunlu

### 2. Ingestion Safety
- **Max document size:** 10MB (`RAG_MAX_DOCUMENT_SIZE`)
- **Max batch size:** 100 documents
- Content length validasyonu
- Oversize document reject

### 3. Chunking Limits
- **Max chunk size:** 2000 chars (`RAG_MAX_CHUNK_SIZE`)
- **Chunk overlap:** 200 chars (`RAG_CHUNK_OVERLAP`)
- **Max chunks per doc:** 100 (`RAG_MAX_CHUNKS_PER_DOC`)
- Runaway chunking koruması

### 4. Retrieval Safety
- **Max query length:** 10K chars (`RAG_MAX_QUERY_LENGTH`)
- **Max results:** 50 (`RAG_MAX_TOTAL_RESULTS`)
- **Content snippet:** 500 chars (`RAG_CONTENT_SNIPPET_LENGTH`)
- Min score threshold (0.1 default)

### 5. Metadata Sanitization (Allowlist)
Search sonuçlarında metadata filtrelenir:

**Allowlist (dönen alanlar):**
- `sourceName`
- `sourceType`
- `title`
- `language`
- `tags`
- `createdAt`
- `updatedAt`
- `documentId`
- `chunkIndex`
- `totalChunks`

**Bloklanan pattern'lar:**
- `*path*` (absolute path, file system path)
- `*secret*`, `*token*`, `*credential*`, `*password*`, `*api*key*`
- `*internal*id*`, `*_id$`
- `*embedding*`, `*vector*`, `*raw*content*`

Örnek:
```json
// Metadata storage'da:
{
  "title": "API Docs",
  "sourceName": "docs",
  "secretKey": "hidden",
  "absolutePath": "/var/data/file.txt"
}

// Search sonucunda (sanitized):
{
  "title": "API Docs",
  "sourceName": "docs"
}
```

### 6. Context Leakage Protection
- Search sonuçlarında sadece snippet (500 chars)
- Full content sadece `/documents/:id` endpoint'inde
- Metadata'da workspaceId tagging

### 7. Audit Logging (Içerik Loglanmaz)
**Loglanan alanlar:**
- timestamp, operation (index/search/delete)
- workspaceId, projectId, actor
- correlationId, durationMs
- docCount, chunkCount
- queryLength, topK
- success/failure, error

**ASLA loglanmayanlar:**
- Document content
- Query content
- Full chunk text
- Embedding vectors

## Store Abstraction

### Mimarisi
```
┌─────────────────┐
│   RAG Plugin    │
│  (index.js)     │
└────────┬────────┘
         │ uses
         ▼
┌─────────────────┐
│  RagStore       │
│  (interface)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  MemoryStore    │     │ Future:         │
│  (in-memory)    │     │ PgVectorStore   │
└─────────────────┘     └─────────────────┘
```

### Mevcut Store'lar
| Store | Durum | Açıklama |
|-------|-------|----------|
| `MemoryStore` | ✅ Aktif | In-memory, default. Restart sonrası veri kaybolur. |
| `PgVectorStore` | 📋 Planlı | PostgreSQL + pgvector extension |
| `SqliteStore` | 📋 Planlı | SQLite + sqlite-vec extension |
| `QdrantStore` | 📋 Planlı | Qdrant vector database |
| `PineconeStore` | 📋 Planlı | Pinecone managed vector DB |

### Store Interface
Yeni store eklemek için:
```javascript
import { RagStore } from "./stores/store.interface.js";

export class MyStore extends RagStore {
  async upsertDocument(workspaceId, docId, document) { /* ... */ }
  async getDocument(workspaceId, docId) { /* ... */ }
  async deleteDocument(workspaceId, docId) { /* ... */ }
  async searchDocuments(workspaceId, queryEmbedding, options) { /* ... */ }
  async clearWorkspace(workspaceId) { /* ... */ }
  async getStats(workspaceId) { /* ... */ }
}
```

## Konfigürasyon

```env
# Document Limits
RAG_MAX_DOCUMENT_SIZE=10485760  # 10MB default
RAG_MAX_QUERY_LENGTH=10000      # 10K chars

# Chunking
RAG_MAX_CHUNK_SIZE=2000         # chars per chunk
RAG_CHUNK_OVERLAP=200           # overlap between chunks
RAG_MAX_CHUNKS_PER_DOC=100      # max chunks per document

# Retrieval
RAG_MAX_TOTAL_RESULTS=50        # max search results
RAG_CONTENT_SNIPPET_LENGTH=500    # chars returned in search
```

## Kullanım Örnekleri

### Belge Indeksleme
```bash
curl -X POST /rag/index \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-1" \
  -d '{
    "content": "API documentation...",
    "metadata": { "source": "docs", "type": "api" }
  }'
```

### Semantik Arama
```bash
curl -X POST /rag/search \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-1" \
  -d '{
    "query": "authentication flow",
    "limit": 5,
    "minScore": 0.1
  }'
```

### E2E Lifecycle Örneği
```bash
# 1. Belge indeksle
curl -X POST /rag/index \
  -H "x-workspace-id: ws-1" \
  -d '{"content": "Node.js async/await patterns", "metadata": {"title": "Node.js Guide"}}'

# 2. Ara
# Response: {"ok":true,"data":{"results":[{"id":"doc-1","score":0.85,"content":"Node.js async...","metadata":{"title":"Node.js Guide"}}]}}

# 3. Belge detayı getir
# Full content burada

# 4. Sil
curl -X DELETE /rag/documents/doc-1 \
  -H "x-workspace-id: ws-1"

# 5. Clear (tüm workspace)
curl -X POST /rag/clear \
  -H "x-workspace-id: ws-1"
```

## Hata Kodları

| Kod | Açıklama |
|-----|----------|
| `document_too_large` | Belge boyutu limiti aşıyor |
| `query_too_long` | Query uzunluğu limiti aşıyor |
| `not_found` | Belge bulunamadı |
| `invalid_request` | Geçersiz request formatı |

## Production Checklist

- [ ] `RAG_MAX_DOCUMENT_SIZE` uygun değerde
- [ ] `RAG_MAX_CHUNK_SIZE` ve `RAG_CHUNK_OVERLAP` optimize edildi
- [ ] `RAG_MAX_TOTAL_RESULTS` sorgu ihtiyaçlarına göre ayarlandı
- [ ] **Metadata allowlist** kontrol edildi
- [ ] **Workspace izolasyonu** test edildi
- [ ] **Audit log monitoring** aktif
- [ ] **Cross-workspace sızıntı** test edildi
- [ ] **Store abstraction** için persistent backend seçildi (production için pgvector/qdrant önerilir)
- [ ] Content snippet length uygun

## Architecture

```
Request → extractContext → validateLimits
   ↓
Workspace Store → Chunk → Embed → Index
   ↓
Audit Log (metadata only) → Return Result
   ↓
Search → Sanitize Metadata → Return Snippet
```
