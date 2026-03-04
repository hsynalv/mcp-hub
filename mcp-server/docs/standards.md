# MCP-Hub Platform Standartları

Bu doküman tüm pluginler için geçerli kuralları tanımlar.

---

## 1. Tool / Endpoint Contract

### 1.1 Standart Yanıt Formatı

**Başarılı:**
```json
{ "ok": true, ...data }
```

**Hata:**
```json
{
  "ok": false,
  "error": "error_code",
  "message": "İnsan tarafından okunabilir mesaj",
  "details": {},
  "requestId": "req-abc123"
}
```

### 1.2 Request ID

- Her response header'da `x-request-id` döner
- Hata ayıklama ve trace için kullanılır
- İstemci `x-request-id` gönderirse aynı ID yanıtta korunur

### 1.3 Hata Kodları

| Kod | HTTP | Açıklama |
|-----|------|----------|
| `invalid_request` | 400 | Validation hatası |
| `validation_error` | 400 | Zod/şema hatası |
| `invalid_path` | 400 | Path traversal vb. |
| `invalid_backend` | 400 | Geçersiz backend/type |
| `not_found` | 404 | Kaynak bulunamadı |
| `unauthorized` | 401 | API key eksik/geçersiz |
| `forbidden` | 403 | Yetki yetersiz |
| `connection_failed` | 502 | Harici servis bağlantı hatası |
| `query_failed` | 422 | Sorgu/komut hatası |
| `internal_error` | 500 | Sunucu hatası |

---

## 2. Zod ile Validasyon

- Her endpoint girişi Zod schema ile validate edilir
- Hata: `400` + `{ ok: false, error: "validation_error", details: ZodError.flatten() }`
- `src/core/validation/` altında ortak `validate(schema, body, res)` helper kullanılır

---

## 3. Observability

### 3.1 Audit Log

Her istek loglanır:
- `timestamp`, `method`, `path`, `plugin`, `duration`, `statusCode`, `status`
- `error` (varsa)
- `body` (maskeli — secret alanlar `[REDACTED]`)

### 3.2 Metrikler

- `tool_requests_total{tool, status}` — istek sayısı
- `tool_duration_ms_bucket{tool}` — süre dağılımı
- Policy: `policy_blocked_total`, `policy_approval_pending_total`

### 3.3 Trace

- `requestId` ile tüm alt çağrılar bağlanır
- Audit log entry'de `requestId` bulunur

---

## 4. Policy Entegrasyonu

### 4.1 Risk Sınıfları

| Sınıf | Açıklama | Varsayılan |
|-------|----------|------------|
| READ | Sadece okuma | İzin |
| WRITE | Yazma/oluşturma | dry_run_first |
| BULK | Toplu işlem | require_approval |
| DESTRUCTIVE | Silme/archive | require_approval |

### 4.2 Preset Kurallar

- Notion bulk archive → `require_approval`
- n8n workflow apply → `dry_run_first`
- file delete/move → `require_approval`
- db write → `block` (default, proje bazlı açılabilir)

### 4.3 Policy Simulate

`POST /policy/evaluate` ile `{ method, path, body?, project? }` gönderilir.
Yanıt: `{ allowed, action, rule, reason?, message? }` — kararın nedenini açıklar.

---

## 5. Projects-First Konfigürasyon

Config sırası:
1. Request header: `x-project-id`, `x-env`
2. `projects` registry'den base config
3. `secrets` ile env çözümleme

### 5.1 Project Schema

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

## 6. Cache Standardı

- Cache key: `plugin:project:resource:version`
- TTL + stale-while-revalidate (opsiyonel)
- `GET /<plugin>/cache/status`, `POST /<plugin>/cache/clear` (opsiyonel)

---

## 7. Rate Limiting / Backoff

- Notion, GitHub, n8n gibi API'ler için: retry + exponential backoff
- `429` / `5xx` için: max 3 retry, backoff 1s, 2s, 4s

---

## 8. Secret Redaction

- Audit log'da: `password`, `token`, `secret`, `key`, `authorization` vb. → `[REDACTED]`
- Response'larda secret değeri asla dönmez
- `{{secret:NAME}}` sadece server-side resolve edilir
