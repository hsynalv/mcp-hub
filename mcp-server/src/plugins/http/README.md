# HTTP Plugin

Güvenli HTTP proxy ve rate limiting.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/http/request` | POST | HTTP isteği yap |
| `/http/cache/clear` | POST | Cache temizle |

## Özellikler

- Rate limiting (RPM bazlı)
- Caching
- Domain whitelist/blacklist
- Max response size limit

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `http_request` | HTTP isteği yap (rate limited) |

## Konfigürasyon

```env
HTTP_RATE_LIMIT_RPM=60
HTTP_MAX_RESPONSE_SIZE_KB=512
HTTP_CACHE_TTL_SECONDS=300
HTTP_ALLOWED_DOMAINS=api.github.com,api.notion.com
HTTP_BLOCKED_DOMAINS=internal.company.com
```
