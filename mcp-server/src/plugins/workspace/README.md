# Workspace Plugin

Güvenli dosya sistemi erişimi — audit logging ve context extraction ile.

## Endpoints

| Endpoint | Method | Açıklama | Scope |
|----------|--------|----------|-------|
| `/workspace/read` | GET | Dosya oku | read |
| `/workspace/write` | POST | Dosya yaz | write |
| `/workspace/list` | GET | Dizin listele | read |
| `/workspace/search` | GET | Dosya ara | read |
| `/workspace/patch` | POST | Dosyaya patch uygula | write |
| `/workspace/audit` | GET | Audit log görüntüle | read |

## Güvenlik Özellikleri

### 1. Path Traversal Koruması
- `..` pattern'leri engellenir
- Absolute path'ler sadece workspace root içine izin verilir
- `~` (home) expansion kontrollü şekilde yapılır
- Tüm path'ler normalize edilir ve kontrol edilir

### 2. Context Extraction
Her istekten actor ve workspace/project bilgisi çıkarılır:
- `actor`: `req.user.id` veya `req.user.email` veya `anonymous`
- `workspaceId`: `x-workspace-id` header'ı
- `projectId`: `x-project-id` header'ı

### 3. Audit Logging
Tüm dosya operasyonları loglanır:
- `timestamp` - ISO format
- `operation` - read/write/list/search/patch
- `path` - İşlem yapılan path
- `actor` - Kullanıcı kimliği
- `workspaceId` - Workspace context
- `projectId` - Project context
- `correlationId` - Trace ID
- `durationMs` - İşlem süresi
- `allowed` - true/false
- `reason` - Deny nedeni (varsa)
- `error` - Hata mesajı (varsa)
- `metadata` - Boyut, bytesWritten vb (content asla loglanmaz)

### 4. File Size Limitleri
- **Max dosya boyutu:** 10MB (config: `WORKSPACE_MAX_FILE_SIZE`)
- **Max read boyutu:** 1MB (opsiyonel query param)
- Search sonuçları: 100 ile sınırlandırılmış

### 5. Scope Governance
- `read` scope: read, list, search, audit görüntüleme
- `write` scope: write, patch

## Konfigürasyon

```env
# Workspace Root
WORKSPACE_ROOT=/path/to/allowed/workspace

# File Size Limits
WORKSPACE_MAX_FILE_SIZE=10485760  # 10MB default

# Allowed Extensions (opsiyonel)
WORKSPACE_ALLOWED_EXTENSIONS=.js,.ts,.json,.md,.txt,.yml,.yaml,.html,.css
```

## Örnek Kullanım

### Dosya Okuma
```bash
curl -X GET "/workspace/read?path=src/index.js" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-workspace-id: project-a"
```

### Dosya Yazma
```bash
curl -X POST "/workspace/write" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: project-a" \
  -d '{
    "path": "src/new-file.js",
    "content": "console.log(\"hello\");",
    "createDirs": true
  }'
```

### Dizin Listeleme
```bash
curl -X GET "/workspace/list?path=src" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-workspace-id: project-a"
```

### Dosya Arama
```bash
curl -X GET "/workspace/search?pattern=*.js&root=src" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-workspace-id: project-a"
```

### Patch Uygulama
```bash
curl -X POST "/workspace/patch" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: project-a" \
  -d '{
    "path": "src/index.js",
    "search": "oldText",
    "replace": "newText"
  }'
```

### Audit Log Görüntüleme
```bash
curl -X GET "/workspace/audit?limit=50" \
  -H "Authorization: Bearer TOKEN"
```

## Production Checklist

- [ ] `WORKSPACE_ROOT` güvenli ve izole bir dizin
- [ ] `WORKSPACE_MAX_FILE_SIZE` uygun değerde
- [ ] `WORKSPACE_ALLOWED_EXTENSIONS` gereksinimlere göre ayarlandı
- [ ] `write` scope sadece güvenilir aktörlere verilmiş
- [ ] Audit log monitoring aktif
- [ ] Path traversal test edildi
- [ ] File size limit test edildi
- [ ] Context extraction header'ları yapılandırıldı

## Hata Kodları

| Kod | Açıklama |
|-----|----------|
| `invalid_path` | Geçersiz veya traversal içeren path |
| `path_traversal` | `..` pattern tespit edildi |
| `file_not_found` | Dosya bulunamadı |
| `directory_not_found` | Dizin bulunamadı |
| `not_a_file` | Path bir dosya değil |
| `not_a_directory` | Path bir dizin değil |
| `file_too_large` | Dosya boyutu limiti aşıldı |
| `missing_path` | Path parametresi eksik |
| `missing_fields` | Gerekli alanlar eksik |
| `missing_pattern` | Arama pattern'i eksik |
| `parent_not_found` | Üst dizin bulunamadı |
| `invalid_patch` | Patch formatı geçersiz |
| `read_error` | Okuma hatası |
| `write_error` | Yazma hatası |
| `list_error` | Listeleme hatası |
| `search_error` | Arama hatası |
| `patch_error` | Patch hatası |
