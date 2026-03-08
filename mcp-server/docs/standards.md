# mcp-hub Platform Standartları

Bu doküman tüm plugin ve core endpoint’leri için geçerli platform kurallarını tanımlar.

---

## 1. Tool / Endpoint Contract

### 1.1 Response Envelope (Tek Tip Yanıt)

**Başarılı:**
```json
{
  "ok": true,
  "data": {},
  "meta": { "requestId": "req-..." }
}
```

**Hata:**
```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "İnsan tarafından okunabilir mesaj",
    "details": {}
  },
  "meta": { "requestId": "req-..." }
}
```

### 1.2 Headers

#### `x-request-id`

- Her response header'da `x-request-id` döner
- Hata ayıklama ve trace için kullanılır
- İstemci `x-request-id` gönderirse aynı ID yanıtta korunur

#### `x-project-id`

- Project context için kullanılır
- Write ve destructive aksiyonlarda zorunludur

#### `x-env`

- Environment context (`dev|staging|prod`)
- Write ve destructive aksiyonlarda zorunludur

### 1.3 Error Codes

| Kod | HTTP | Açıklama |
|-----|------|----------|
| `invalid_request` | 400 | Geçersiz istek |
| `validation_error` | 400 | Zod/şema hatası |
| `invalid_path` | 400 | Path traversal vb. |
| `invalid_backend` | 400 | Geçersiz backend/type |
| `not_found` | 404 | Kaynak bulunamadı |
| `unauthorized` | 401 | API key eksik/geçersiz |
| `forbidden` | 403 | Yetki yetersiz |
| `rate_limited` | 429 | Rate limit aşıldı |
| `policy_blocked` | 403 | Policy kararı ile engellendi |
| `approval_required` | 403 | Approval gerekli |
| `dry_run_required` | 403 | Önce dry-run gerekli |
| `connection_failed` | 502 | Harici servis bağlantı hatası |
| `query_failed` | 422 | Sorgu/komut hatası |
| `upstream_error` | 502 | Upstream servis hatası |
| `internal_error` | 500 | Sunucu hatası |

---

## 2. Scopes (RBAC)

- `read`: okuma operasyonları
- `write`: state-changing operasyonlar
- `admin`: yüksek riskli operasyonlar (kodda `danger` ile alias olabilir)

---

## 3. Zod ile Validasyon

- Her endpoint girişi Zod schema ile validate edilir
- Hata: `400` + `{ ok: false, error: "validation_error", details: ZodError.flatten() }`
- Ortak middleware: `validateBody(schema)`, `validateQuery(schema)`
- Hata: `400` + `validation_error`

---

## 4. Tool Tags

| Tag | Anlam |
|-----|------|
| `READ` | Sadece okuma |
| `WRITE` | Yazma/oluşturma |
| `BULK` | Toplu işlem |
| `DESTRUCTIVE` | Silme/archive/move |

---

## 5. Policy Defaults

Varsayılan öneri:

- `READ`: allow
- `WRITE`: dev/staging allow, prod require_approval
- `BULK`: require_approval
- `DESTRUCTIVE`: require_approval

Önerilen özel kurallar:

- `n8n.workflow.apply`: `dry_run_first` + prod approval
- `db write`: default `block`
- `file delete/move`: approval
- `github write`: approval

---

## 6. Observability

### 6.1 Audit Log

Her istek loglanır:
- `timestamp`, `requestId`, `method`, `path`, `plugin`, `duration`, `statusCode`, `status`
- `error` (varsa)
- `body` (maskeli — secret alanlar `[REDACTED]`)

### 6.2 Metrikler

- `tool_requests_total{tool, status}` — istek sayısı
- `tool_duration_ms_bucket{tool}` — süre dağılımı
- Policy: `policy_blocked_total`, `policy_approval_pending_total`

### 6.3 Trace

- `requestId` ile tüm alt çağrılar bağlanır
- Audit log entry'de `requestId` bulunur

---

## 7. Projects-First Konfigürasyon

Config sırası:
1. Request header: `x-project-id`, `x-env`
2. `projects` registry'den base config
3. `secrets` ile env çözümleme

### 7.1 Project Schema

```json
{
  "key": "string",
  "name": "string",
  "envs": {
    "dev": {
      "github": "owner/repo",
      "notionProjectsDb": "uuid",
      "notionTasksDb": "uuid",
      "n8nBaseUrl": "url",
      "openapiSpecId": "id",
      "storage": "local|s3|gdrive",
      "db": "postgres|mssql|mongodb"
    }
  }
}
```

---

## 8. Cache Standardı

- Cache key: `plugin:project:resource:version`
- TTL + stale-while-revalidate (opsiyonel)
- `GET /<plugin>/cache/status`, `POST /<plugin>/cache/clear` (opsiyonel)

---

## 9. Rate Limiting / Backoff

- Notion, GitHub, n8n gibi API'ler için: retry + exponential backoff
- `429` / `5xx` için: max 3 retry, backoff 1s, 2s, 4s

---

## 10. Secret Redaction

- Audit log'da: `password`, `token`, `secret`, `key`, `authorization` vb. → `[REDACTED]`
- Response'larda secret değeri asla dönmez
- `{{secret:NAME}}` sadece server-side resolve edilir
