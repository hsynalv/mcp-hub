# n8n-workflows Plugin

n8n'deki workflow'ları listeler, tekil workflow JSON'larını sunar ve arama yapar.
AI agent bu endpoint'leri template ve bağlam kaynağı olarak kullanır.

Tüm endpointler `/n8n/workflows` prefix'i altında çalışır.

---

## Endpointler

### `GET /n8n/workflows`

Tüm workflow'ları hafif liste olarak döner: `[{ id, name, active, updatedAt }]`
Cache (TTL: `WORKFLOWS_TTL_MINUTES`, varsayılan 10 dk) dolmadıysa diskten okur.

```bash
curl http://localhost:8787/n8n/workflows
```

**Yanıt:**
```json
[
  { "id": "101", "name": "Slack Bildirim", "active": true, "updatedAt": "2026-02-28T..." },
  { "id": "102", "name": "Cron → HTTP", "active": false, "updatedAt": "2026-02-25T..." }
]
```

---

### `GET /n8n/workflows/:id`

Belirli bir workflow'un tam JSON'ını döner.
AI bu JSON'ı template olarak kullanabilir.

```bash
curl http://localhost:8787/n8n/workflows/101
```

**Yanıt:** n8n'in döndürdüğü workflow nesnesi (nodes, connections, settings dahil).

**Hata (404 benzeri):**
```json
{ "ok": false, "error": "n8n_api_not_supported", "details": { "status": 404 } }
```

---

### `POST /n8n/workflows/search`

Workflow'ları ada ve/veya node tipine göre arar.

**Body:**
```json
{ "q": "slack", "nodeType": "n8n-nodes-base.slack" }
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `q` | string | Workflow adında aranacak kelime (case-insensitive) |
| `nodeType` | string | Bu node tipini içeren workflow'ları bul |

En az biri zorunludur.

```bash
# Ada göre ara
curl -X POST http://localhost:8787/n8n/workflows/search \
  -H "Content-Type: application/json" \
  -d '{"q": "slack"}'

# Node tipine göre ara
curl -X POST http://localhost:8787/n8n/workflows/search \
  -H "Content-Type: application/json" \
  -d '{"nodeType": "n8n-nodes-base.httpRequest"}'

# İkisini birden
curl -X POST http://localhost:8787/n8n/workflows/search \
  -H "Content-Type: application/json" \
  -d '{"q": "bildirim", "nodeType": "n8n-nodes-base.slack"}'
```

**Yanıt (`q` ile):**
```json
[
  { "id": "101", "name": "Slack Bildirim", "active": true, "updatedAt": "...", "matches": { "nodes": 0 } }
]
```

**Yanıt (`nodeType` ile):**
```json
{
  "results": [
    { "id": "101", "name": "Slack Bildirim", "active": true, "matches": { "nodes": 2 } }
  ],
  "note": "3 workflow(s) not in cache — call GET /n8n/workflows/:id to cache them before searching by nodeType"
}
```

> **Not:** `nodeType` araması sadece daha önce cache'lenmiş workflow'larda çalışır.
> Cache'lenmemiş workflow'lar `note` alanında bildirilir.
> `GET /n8n/workflows/:id` çağırarak istediğin workflow'u önce cache'leyebilirsin.

---

## Hata Yanıtları

| HTTP | `error` | Açıklama |
|------|---------|----------|
| 400 | `invalid_request` | Geçersiz body veya parametre |
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
| `WORKFLOWS_TTL_MINUTES` | `10` | Liste cache geçerlilik süresi |
| `CATALOG_CACHE_DIR` | `./cache` | Cache klasörü kökü |

Cache dosyaları:
- Liste: `<CATALOG_CACHE_DIR>/n8n-workflows/list.json`
- Tekil: `<CATALOG_CACHE_DIR>/n8n-workflows/wf-<id>.json`
