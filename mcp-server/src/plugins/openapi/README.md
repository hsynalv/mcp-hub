# OpenAPI Plugin

OpenAPI spec yükleme ve analiz.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/openapi/load` | POST | Spec yükle (URL veya file) |
| `/openapi/analyze` | POST | Spec analiz et |
| `/openapi/operations` | GET | Operation listesi |
| `/openapi/execute` | POST | Spec operation çalıştır |

## Özellikler

- Spec caching
- Operation keşif
- Auto-generated client

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `openapi_load_spec` | Spec yükle ve parse et |
| `openapi_list_operations` | Mevcut operation'ları listele |
| `openapi_execute` | Spec operation çalıştır |

## Konfigürasyon

```env
OPENAPI_CACHE_DIR=./cache/openapi
```
