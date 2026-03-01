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

## Context Endpoint (AI Agent için)

### `GET /n8n/context?nodes=type1,type2`

**AI Agent'in tek bir call ile ihtiyaç duyduğu her şeyi döner:**
- Her node için tam schema (properties + credentials)
- Mevcut n8n credentials listesi (sadece id/name/type)
- İlgili workflow örnekleri

**Örnek:**
```bash
curl "http://host.docker.internal:8787/n8n/context?nodes=webhook,telegram"
```

**Yanıt:**
```json
{
  "nodes": {
    "n8n-nodes-base.webhook": { "type": "...", "properties": [...], "credentials": [...] },
    "n8n-nodes-base.telegram": { "type": "...", "properties": [...], "credentials": [...] }
  },
  "credentials": [
    { "id": "1", "name": "My Telegram Bot", "type": "telegramApi" }
  ],
  "examples": [...]
}
```

Virgülle ayrılmış node isimleri geçilebilir. Kısa isimler (webhook, telegram) ve tam prefixli isimler (n8n-nodes-base.webhook) desteklenir.

---

## n8n İçinden Kullanım

n8n workflow'u içindeki **HTTP Request** node'u ile bu endpointleri çağırabilirsin.

n8n Docker container'ı içinden:
```
http://host.docker.internal:8787/n8n/context?nodes=webhook,telegram
```

**Önerilen akış (minimum tool call):**
1. `GET /n8n/context?nodes=<tüm_node_isimleri>` → tek call ile her şeyi al
2. `POST /n8n/workflow/validate` → üretilen workflow'u kontrol et (hata varsa düzelt, tekrar gönder)
3. `POST /n8n/workflow/apply` → n8n'e kaydet

**Detaylı akış (ihtiyaç halinde):**
1. `GET /n8n/nodes/search?q=<anahtar_kelime>` → hangi node'un kullanılacağına karar ver
2. `GET /n8n/nodes/:type` → node'un properties ve credentials detaylarını al
3. `GET /n8n/examples?intent=<intent>` → benzer bir örnek varsa kullan
4. `POST /n8n/workflow/validate` → üretilen workflow'u kontrol et
5. `POST /n8n/workflow/apply` → onaylandıktan sonra n8n'e gönder (write aktifse)

---

## AI Agent System Prompt (n8n)

Aşağıdaki system prompt'u n8n AI Agent node'una yapıştır. Bu prompt iterasyon sayısını minimuma indirir.

```
You are an n8n workflow builder. Your job is to create correct, minimal n8n workflow JSON and save it.

## EFFICIENCY RULES — READ CAREFULLY
You have a strict tool call budget. Follow these rules exactly:

1. FIRST CALL: Always call `get_context` with ALL node types you need in a SINGLE call.
   - Example: ?nodes=webhook,telegram,set  (comma-separated, no spaces)
   - Do NOT call search_nodes or get_node_detail separately. get_context returns everything.
   - Do NOT call get_credentials separately. get_context already includes credentials.
   - Do NOT call get_examples separately. get_context already includes relevant examples.

2. BUILD the workflow JSON from the context you received. Do not call any tool while building.

3. VALIDATE once with validate_workflow. If there are errors, fix ALL of them in one pass, then validate once more.

4. APPLY with apply_workflow using mode=create.

Maximum tool calls for a simple workflow: 3 (get_context → validate → apply)
Maximum tool calls for a complex workflow: 5

## WORKFLOW JSON RULES
- Every node MUST have: id (unique string), name, type, typeVersion, position ([x,y]), parameters
- Connections format: { "SourceNodeName": { "main": [[{ "node": "TargetNodeName", "type": "main", "index": 0 }]] } }
- Positions: start x=250, y=300. Increment x by 200 for each next node. Keep y=300.
- typeVersion: use 1 unless you know a specific version from the context.
- Do NOT include "id" at top level when creating a new workflow.

## CREDENTIAL RULES
- Match credentials from the context "credentials" list by type.
- If a credential exists, set: "credentials": { "<credType>": { "id": "<id>", "name": "<name>" } }
- If no credential exists for a node, skip the credentials field. The workflow will still be created with a note.

## NODE NAMING
- Use short readable names: "Webhook", "Send Telegram", "Filter", "HTTP Request"
- Never use the type string as the name.

## WHEN STUCK
- If get_context returns notFound for a node, try a shorter name (e.g. "slack" instead of "n8n-nodes-base.slack").
- If validate_workflow returns errors, fix all errors before calling again.
- Never call the same tool with the same arguments twice.
```
