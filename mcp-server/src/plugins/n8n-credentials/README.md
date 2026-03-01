# n8n-credentials Plugin

n8n'deki credential meta verilerini sunar.
**Sadece `id`, `name`, `type` döner — token, şifre, secret asla döndürülmez.**

Tüm endpointler `/credentials` prefix'i altında çalışır.

---

## Endpointler

### `GET /credentials`

Tüm credential'ları listeler.

```bash
curl http://localhost:8787/credentials
```

**Yanıt:**
```json
[
  { "id": "1", "name": "Slack - Şirket", "type": "slackApi" },
  { "id": "2", "name": "Gmail - Kişisel", "type": "gmailOAuth2" }
]
```

---

### `GET /credentials/:type`

Belirli bir tipe göre filtreler.

```bash
curl http://localhost:8787/credentials/slackApi
curl http://localhost:8787/credentials/gmailOAuth2
curl http://localhost:8787/credentials/httpBasicAuth
```

**Yanıt:**
```json
[
  { "id": "1", "name": "Slack - Şirket", "type": "slackApi" }
]
```

---

### `POST /credentials/refresh`

Cache'i yok sayarak n8n'den yeniden çeker.

```bash
curl -X POST http://localhost:8787/credentials/refresh
```

**Yanıt:**
```json
{ "ok": true, "count": 8, "updatedAt": "2026-03-01T10:00:00.000Z" }
```

---

## Hata Yanıtları

| HTTP | `error` | Açıklama |
|------|---------|----------|
| 401 | `missing_api_key` | `N8N_API_KEY` tanımlı değil |
| 401 | `n8n_auth_error` | API key geçersiz |
| 502 | `network_error` | n8n'e ulaşılamıyor |
| 502 | `n8n_api_not_supported` | Endpoint bu n8n sürümünde yok |

---

## Env Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `N8N_API_KEY` | — | n8n API key (zorunlu) |
| `N8N_BASE_URL` | `http://n8n:5678` | n8n adresi |
| `N8N_API_BASE` | `/api/v1` | API path prefix |
| `CREDENTIALS_TTL_MINUTES` | `60` | Cache geçerlilik süresi |
| `CATALOG_CACHE_DIR` | `./cache` | Cache klasörü kökü |

Cache dosyası: `<CATALOG_CACHE_DIR>/n8n-credentials/credentials.json`
