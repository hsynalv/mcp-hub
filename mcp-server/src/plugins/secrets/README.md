# Secrets Plugin

Güvenli credential referans sistemi — secret değerleri asla expose edilmez.

## Endpoints

| Endpoint | Method | Açıklama | Scope |
|----------|--------|----------|-------|
| `/secrets` | GET | Secret isimlerini listele (değer yok) | read |
| `/secrets` | POST | Secret adı register et | danger |
| `/secrets/:name` | DELETE | Secret unregister et | danger |
| `/secrets/resolve` | POST | Template içindeki secret referanslarını çözümle | write |
| `/secrets/audit` | GET | Audit log görüntüle | read |
| `/secrets/health` | GET | Plugin health | read |

## Güvenlik Modeli

### 1. Secret Value Exposure Protection
**Secret değerleri ASLA expose edilmez:**
- `GET /secrets` sadece metadata döner (name, description, hasValue boolean)
- Secret değerleri sadece server-side `process.env` den okunur
- `POST /secrets/resolve` sadece çözümleme durumu döner, gerçek değerleri değil
- Masked preview: çözümlenen değerler `[RESOLVED]` ile maskelenir
- Audit log'larda secret değeri asla yer almaz

### 2. Workspace Isolation
Multi-tenant ortamlar için minimum isolation:
- **Format:** `<cache>/secrets-registry-<workspaceId>.json`
- **Aktivasyon:** `SECRETS_WORKSPACE_ISOLATION=true`
- **Strict Mode:** `SECRETS_WORKSPACE_STRICT=true` (workspaceId olmadan erişim engellenir)
- workspaceId path traversal karakterlerinden sanitize edilir
- Her workspace kendi registry dosyasında çalışır
- Farklı workspace'ler birbirinin secret'larına erişemez

### 3. Audit Logging
Tüm secret operasyonları loglanır:
- `timestamp` - ISO format
- `operation` - register/unregister/resolve/list
- `secretName` - İşlem yapılan secret adı
- `actor` - Kullanıcı kimliği
- `workspaceId` - Workspace context
- `projectId` - Project context
- `correlationId` - Trace ID
- `durationMs` - İşlem süresi
- `allowed` - true/false
- `reason` - Deny nedeni (varsa)
- `error` - Hata mesajı (varsa)

**ASLA loglanmaz:**
- Secret değerleri
- Önceki/sonraki değerler
- Headers veya token'lar

### 4. Scope / Governance
- `read` scope: list ve audit görüntüleme
- `write` scope: template resolve
- `danger` scope: register/unregister (en yüksek risk)

### 5. Naming Validation
Secret isimleri UPPER_SNAKE_CASE formatında olmalı:
- Regex: `/^[A-Z0-9_]+$/`
- Örnek: `API_KEY`, `DATABASE_URL`, `NOTION_TOKEN`
- Geçersiz: `api_key`, `API-KEY`, `secret.name`

### 6. Error Handling
Standardized error format:
- `invalid_name` - Geçersiz secret adı
- `not_found` - Secret bulunamadı
- `workspace_required` - Strict mode'da workspaceId gerekli
- `invalid_request` - Validation hatası

## Konfigürasyon

```env
# Workspace Isolation
SECRETS_WORKSPACE_ISOLATION=false  # true = enable per-workspace registry
SECRETS_WORKSPACE_STRICT=false     # true = require workspaceId for all ops

# Cache Directory
CATALOG_CACHE_DIR=./cache
```

## Örnek Kullanım

### Secret Listeleme (metadata only)
```bash
curl -X GET "/secrets" \
  -H "Authorization: Bearer TOKEN"
# Response: { ok: true, secrets: [{ name: "API_KEY", hasValue: true, ... }] }
# Secret değeri DÖNMEZ
```

### Secret Register
```bash
curl -X POST "/secrets" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: workspace-a" \
  -d '{
    "name": "NOTION_API_KEY",
    "description": "Notion integration API key"
  }'
# Secret değeri environment'tan (process.env.NOTION_API_KEY) okunur
```

### Template Resolve (server-side only)
```bash
curl -X POST "/secrets/resolve" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "Bearer {{secret:NOTION_API_KEY}}"
  }'
# Response: { ok: true, refs: { found: ["NOTION_API_KEY"], missing: [] }, preview: "Bearer [RESOLVED]" }
# Gerçek değer DÖNMEZ, sadece çözümleme durumu
```

### Audit Log Görüntüleme
```bash
curl -X GET "/secrets/audit?limit=50" \
  -H "Authorization: Bearer TOKEN"
# Secret değerleri asla loglanmaz
```

## Production Checklist

- [ ] Secret değerleri process.env'de tanımlı
- [ ] `SECRETS_WORKSPACE_ISOLATION=true` (multi-tenant için)
- [ ] `SECRETS_WORKSPACE_STRICT=true` (strict mode için)
- [ ] `danger` scope sadece admin/güvenilir aktörlere verilmiş
- [ ] Audit log monitoring aktif
- [ ] `CATALOG_CACHE_DIR` güvenli ve persistent bir lokasyonda
- [ ] Secret registry dosyaları backup ediliyor
