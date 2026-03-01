# n8n Plugin

n8n node kataloğunu sunan ve isteğe bağlı olarak workflow oluşturma/güncelleme işlemleri yapan plugin.

Tüm endpointler `/n8n` prefix'i altında çalışır.

---

## Katalog Yönetimi

### `GET /n8n/catalog/status`

Cache'deki katalog hakkında bilgi döner.

**Yanıt:**
```json
{
  "ok": true,
  "updatedAt": "2026-03-01T01:35:26.210Z",
  "source": "n8n-nodes-base-package",
  "count": 423,
  "fresh": true
}
```

| Alan | Açıklama |
|------|----------|
| `ok` | Katalog mevcut mu |
| `updatedAt` | Son yenileme zamanı |
| `source` | `n8n-nodes-base-package` veya `n8n-api` |
| `count` | Yüklü node sayısı |
| `fresh` | TTL süresi dolmadı mı (`CATALOG_TTL_HOURS`) |

---

### `POST /n8n/catalog/refresh`

Kataloğu `n8n-nodes-base` paketinden okuyarak yeniler ve diske yazar.
İlk çalıştırmada ~10-20 saniye sürebilir; sonraki istekler cache'den gelir.

**Yanıt (başarılı):**
```json
{
  "ok": true,
  "updatedAt": "2026-03-01T01:35:26.210Z",
  "source": "n8n-nodes-base-package",
  "count": 423
}
```

**Yanıt (hata):**
```json
{ "ok": false, "reason": "n8n-nodes-base is not installed" }
```

---

## Node Arama

### `GET /n8n/nodes/search`

Katalogdaki node'ları arar. `type`, `displayName` ve `description` alanlarında case-insensitive arama yapar.

**Query parametreleri:**

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|-----------|----------|
| `q` | string | — | Arama terimi |
| `group` | string | — | Grup filtresi (`trigger`, `transform`, `output` vb.) |
| `limit` | number | 20 | Maksimum sonuç sayısı |

**Örnekler:**
```bash
# Tüm node'ları listele
GET /n8n/nodes/search?limit=500

# "slack" içeren node'lar
GET /n8n/nodes/search?q=slack

# Trigger grubundaki node'lar
GET /n8n/nodes/search?group=trigger&limit=100

# "http" içeren trigger node'lar
GET /n8n/nodes/search?q=http&group=trigger
```

**Yanıt:** `NodeSummary` dizisi
```json
[
  {
    "type": "n8n-nodes-base.slack",
    "displayName": "Slack",
    "name": "slack",
    "group": ["output"],
    "description": "Send messages to Slack",
    "version": 2,
    "defaults": { "name": "Slack" },
    "inputs": ["main"],
    "outputs": ["main"],
    "propertiesCount": 12,
    "credentialsRequired": true
  }
]
```

---

## Node Detayı

### `GET /n8n/nodes/:type`

Belirtilen node tipinin tam şemasını döner. Properties ve credentials bilgilerini içerir.

**Parametreler:**

| Parametre | Açıklama |
|-----------|----------|
| `type` | Node tipi (örn: `n8n-nodes-base.slack`) |

**Örnekler:**
```bash
GET /n8n/nodes/n8n-nodes-base.slack
GET /n8n/nodes/n8n-nodes-base.webhook
GET /n8n/nodes/n8n-nodes-base.httpRequest
GET /n8n/nodes/n8n-nodes-base.scheduleTrigger
```

**Yanıt:**
```json
{
  "type": "n8n-nodes-base.slack",
  "displayName": "Slack",
  "group": ["output"],
  "description": "Send messages to Slack",
  "version": 2,
  "propertiesCount": 12,
  "credentialsRequired": true,
  "properties": [
    { "name": "resource", "type": "options", "required": false, "default": "message", "options": [...] },
    { "name": "operation", "type": "options", "required": false, "default": "post" }
  ],
  "credentials": [
    { "name": "slackApi", "required": true }
  ]
}
```

**Hata (404):**
```json
{ "ok": false, "error": "node_not_found" }
```

---

## Workflow Örnekleri

### `GET /n8n/examples`

Hazır workflow örneklerini listeler veya belirli bir örneği döner.

**Query parametreleri:**

| Parametre | Açıklama |
|-----------|----------|
| `intent` | (opsiyonel) Belirli bir örneği getir |

**Mevcut `intent` değerleri:**

| Intent | Açıklama |
|--------|----------|
| `cron_http_post` | Cron → HTTP Request |
| `webhook_to_slack` | Webhook → Slack |
| `webhook_set_respond` | Webhook → Set → Respond to Webhook |
| `if_branch` | IF ile dallanma |
| `merge_branches` | İki dalı Merge ile birleştirme |
| `telegram_send_message` | Webhook → Telegram mesajı |
| `code_transform` | Code node ile veri dönüştürme |

**Örnekler:**
```bash
# Tüm örnekleri listele
GET /n8n/examples

# Belirli bir örneği getir
GET /n8n/examples?intent=webhook_to_slack
```

**Yanıt (tek örnek):**
```json
{
  "intent": "webhook_to_slack",
  "description": "Webhook tetiklendiğinde Slack'e mesaj gönder",
  "plan": {
    "nodes": [...],
    "connections": [...]
  },
  "notes": ["Slack credential gerekli", "..."]
}
```

---

## Workflow Doğrulama

### `POST /n8n/workflow/validate`

AI tarafından üretilen workflow JSON'ını n8n API'sine göndermeden önce doğrular.
Hiçbir dış istek yapmaz, tamamen statik analiz yapar.

**Body:**
```json
{
  "workflowJson": {
    "name": "My Workflow",
    "nodes": [...],
    "connections": {}
  }
}
```

**Doğrulama kontrolleri:**
- `name`, `nodes`, `connections` alanları mevcut mu
- Her node'da `name`, `type`, `position`, `parameters` var mı
- Node isimleri benzersiz mi
- `connections` içindeki referanslar mevcut node'lara işaret ediyor mu
- En az bir trigger node var mı
- Bağlantısız (orphan) node var mı

**Yanıt (geçerli):**
```json
{
  "ok": true,
  "warnings": ["Node 'Set' has no outgoing connections"]
}
```

**Yanıt (geçersiz):**
```json
{
  "ok": false,
  "errors": [
    { "code": "missing_field", "path": "nodes[0].type", "message": "Node type is required" }
  ]
}
```

---

## Workflow Yazma (Opsiyonel)

> Bu endpointler yalnızca `.env` dosyasında `ALLOW_N8N_WRITE=true` ve `N8N_API_KEY` ayarlandığında çalışır.
> Devre dışıyken tüm write endpointleri `403` döner.

### `POST /n8n/workflow/apply`

n8n'de yeni workflow oluşturur veya mevcutu günceller.

**Body:**
```json
{
  "workflowJson": { "name": "My Workflow", "nodes": [...], "connections": {} },
  "mode": "create"
}
```

| `mode` | Açıklama |
|--------|----------|
| `create` | Her zaman yeni workflow oluşturur |
| `update` | Mevcut workflow'u günceller (`workflowJson.id` gerekli) |
| `upsert` | `id` varsa günceller, yoksa oluşturur |

**Yanıt (başarılı):**
```json
{ "ok": true, "workflow": { "id": "abc123", "name": "My Workflow", ... } }
```

**Hata kodları:**

| HTTP | `error` | Açıklama |
|------|---------|----------|
| 403 | `write_disabled` | `ALLOW_N8N_WRITE=true` değil |
| 401 | `missing_api_key` | `N8N_API_KEY` tanımlı değil |
| 401 | `n8n_auth_error` | API key geçersiz |
| 502 | `network_error` | n8n'e ulaşılamıyor |
| 422 | `n8n_validation_error` | n8n workflow'u reddetti |

---

### `POST /n8n/workflow/execute`

n8n'de mevcut bir workflow'u çalıştırır.

**Body:**
```json
{
  "workflowId": "abc123",
  "inputData": {}
}
```

**Yanıt:**
```json
{ "ok": true, "execution": { "id": "exec456", "status": "running", ... } }
```

---

### `POST /n8n/execution/get`

Belirli bir execution'ın durumunu sorgular.

**Body:**
```json
{ "executionId": "exec456" }
```

**Yanıt:**
```json
{ "ok": true, "execution": { "id": "exec456", "status": "success", "data": {...} } }
```

---

## n8n İçinden Kullanım

n8n workflow'u içindeki **HTTP Request** node'u ile bu endpointleri çağırabilirsin.

n8n Docker container'ı içinden:
```
http://host.docker.internal:8787/n8n/nodes/search?q=slack
```

**Önerilen akış:**
1. `GET /n8n/nodes/search?q=<anahtar_kelime>` → hangi node'un kullanılacağına karar ver
2. `GET /n8n/nodes/:type` → node'un properties ve credentials detaylarını al
3. `GET /n8n/examples?intent=<intent>` → benzer bir örnek varsa kullan
4. `POST /n8n/workflow/validate` → üretilen workflow'u kontrol et
5. `POST /n8n/workflow/apply` → onaylandıktan sonra n8n'e gönder (write aktifse)
