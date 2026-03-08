# RAG Plugin

Belge indeksleme ve semantik arama.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/rag/index` | POST | Belge indeksle |
| `/rag/search` | POST | Semantik arama |
| `/rag/stats` | GET | İndeks istatistikleri |

## Özellikler

- In-memory vektör deposu
- Embedding desteği
- Metin bölme (chunking)

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `rag_index_document` | Belge indeksle |
| `rag_search` | Semantik arama yap |
| `rag_stats` | İndeks durumunu al |
