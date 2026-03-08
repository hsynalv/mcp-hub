# File Storage Plugin

S3, Google Drive ve local dosya operasyonları - production-ready güvenlik ile.

## Endpoints

| Endpoint | Method | Açıklama | Scope |
|----------|--------|----------|-------|
| `/file-storage/list` | GET | Dosya/klasör listesi | read |
| `/file-storage/read` | GET | Dosya içeriği (base64) | read |
| `/file-storage/write` | POST | Dosya yaz | write |
| `/file-storage/delete` | DELETE | Dosya sil | write |
| `/file-storage/copy` | POST | Dosya kopyala | write |
| `/file-storage/move` | POST | Dosya taşı | write |
| `/file-storage/audit` | GET | Audit log görüntüle | read |
| `/file-storage/health` | GET | Plugin health | read |

## Desteklenen Depolar

- **AWS S3** - Object storage
- **Google Drive** - Cloud drive storage
- **Local filesystem** - Local disk storage

## Güvenlik Özellikleri

### 1. Path Traversal Koruması
Aşağıdaki path saldırıları engellenir:
- `../` - Relative path traversal
- `%2e%2e%2f` - URL encoded traversal
- `%252e%252e%252f` - Double-encoded traversal
- `/etc/passwd` - Absolute paths
- `C:\Windows` - Windows absolute paths
- Null bytes ve control characters

### 2. Hassas Dosya Bloklama
Aşağıdaki dosya türleri engellenir:
- `.env`, `.env.local`, `.env.*` - Environment files
- `.ssh/id_rsa`, `id_ed25519`, `authorized_keys` - SSH keys
- `*.pem`, `*.key`, `*.p12`, `*.pfx` - Private keys
- `aws/credentials`, `secrets.json` - Credential files
- `/etc/passwd`, `.htpasswd` - System files
- `config.json`, `application.yml` - Config files with secrets

### 3. Dosya Boyut Limiti
- **Default limit:** 50MB
- **Config:** `FILE_STORAGE_MAX_SIZE_BYTES`
- Base64 decode sonrası gerçek boyut kontrolü
- Limit aşımında `413 Payload Too Large`

### 4. Policy Enforcement
Tüm write/delete/move/copy operasyonları execution öncesi policy check:
- Sensitive file kontrolü
- Path traversal kontrolü
- Readonly mode desteği (`FILE_STORAGE_READONLY=true`)

### 5. Symlink Escape Koruması (Local Adapter)
Local filesystem için gerçek symlink kontrolü:
- `lstat()` ile symlink tespiti
- `realpath()` ile hedef path resolve
- Root dışına çıkan symlink'ler reddedilir
- list/read/write/delete/copy/move için symlink escape kontrolü
- Listelemede escape eden symlink'ler `inaccessible` olarak işaretlenir

### 6. Workspace Isolation (Local Adapter)
Minimum tenant isolation modeli:
- **Format:** `<root>/workspaces/<workspaceId>/`
- **Aktivasyon:** `FILE_STORAGE_WORKSPACE_ISOLATION=true`
- **Strict Mode:** `FILE_STORAGE_WORKSPACE_STRICT=true` (workspaceId olmadan erişimi engeller)
- workspaceId path traversal karakterlerinden sanitize edilir
- Her workspace kendi izole dizininde çalışır
- Farklı workspace'ler birbirinin dosyasına erişemez

### 7. Audit Logging
Tüm operasyonlar loglanır:
- `timestamp` - ISO format
- `operation` - read/write/delete/copy/move/list
- `path` - İşlem yapılan path
- `backend` - s3/gdrive/local
- `allowed` - true/false
- `actor` - Kullanıcı kimliği
- `workspaceId` - Workspace context
- `projectId` - Project context
- `correlationId` - Trace ID
- `durationMs` - İşlem süresi
- `sizeBytes` - Dosya boyutu
- `reason` - Deny nedeni (varsa)
- `error` - Hata mesajı (varsa)

## Konfigürasyon

```env
# S3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
S3_BUCKET=my-bucket

# Google Drive
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx

# Local
FILE_STORAGE_LOCAL_ROOT=./storage

# Security
FILE_STORAGE_MAX_SIZE_BYTES=52428800  # 50MB default
FILE_STORAGE_READONLY=false             # true = write operations blocked

# Workspace Isolation (Local Adapter)
FILE_STORAGE_WORKSPACE_ISOLATION=false  # true = enable workspace subdirectories
FILE_STORAGE_WORKSPACE_STRICT=false     # true = require workspaceId for all ops
```

## Hata Kodları

| Kod | HTTP | Açıklama |
|-----|------|----------|
| `path_traversal` | 400 | Path traversal tespit edildi |
| `sensitive_file` | 403 | Hassas dosya erişimi engellendi |
| `file_too_large` | 413 | Dosya boyut limiti aşıldı |
| `readonly_mode` | 403 | Readonly modda yazma engellendi |
| `invalid_backend` | 400 | Geçersiz backend |
| `file_not_found` | 404 | Dosya bulunamadı |
| `symlink_escape` | 403 | Symlink root dışına çıkıyor |
| `invalid_workspace` | 400 | Geçersiz workspaceId |
| `workspace_required` | 403 | Workspace strict mode'da ID gerekli |

## Örnek Kullanım

### Dosya Listeleme
```bash
curl -X GET "/file-storage/list?backend=local&path=documents/" \
  -H "Authorization: Bearer TOKEN"
```

### Dosya Okuma
```bash
curl -X GET "/file-storage/read?backend=s3&path=myfile.txt" \
  -H "Authorization: Bearer TOKEN"
```

### Dosya Yazma
```bash
curl -X POST "/file-storage/write" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backend": "local",
    "path": "documents/report.pdf",
    "content": "base64encodedcontent...",
    "contentType": "application/pdf"
  }'
```

### Workspace Isolation ile Dosya Yazma
```bash
curl -X POST "/file-storage/write" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: workspace-a" \
  -d '{
    "backend": "local",
    "path": "documents/report.pdf",
    "content": "base64encodedcontent...",
    "contentType": "application/pdf"
  }'
# Dosya: <root>/workspaces/workspace-a/documents/report.pdf
```

### Workspace Isolation Aktivasyonu
```env
FILE_STORAGE_WORKSPACE_ISOLATION=true
FILE_STORAGE_WORKSPACE_STRICT=true
```

### Audit Log Görüntüleme
```bash
curl -X GET "/file-storage/audit?limit=50" \
  -H "Authorization: Bearer TOKEN"
```

## Production Checklist

- [ ] `FILE_STORAGE_READONLY=true` (eğer sadece okuma gerekli)
- [ ] `FILE_STORAGE_MAX_SIZE_BYTES` uygun değerde
- [ ] AWS/GCP credentials en az yetkiyle
- [ ] `FILE_STORAGE_LOCAL_ROOT` izole dizin
- [ ] **Symlink koruması aktif** (local adapter'de otomatik)
- [ ] **Workspace isolation** yapılandırıldı (multi-tenant için)
- [ ] Audit log monitoring aktif
- [ ] Sensitive file pattern'leri gözden geçirildi
- [ ] Workspace strict mode gereksinimleri tanımlandı
