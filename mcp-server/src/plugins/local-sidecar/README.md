# Local Sidecar Plugin

Yerel dosya sistemi whitelist erişimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/local/files` | GET | Whitelist içindeki dosyaları listele |
| `/local/read` | GET | Dosya oku (whitelist kontrolü) |
| `/local/write` | POST | Dosya yaz (whitelist kontrolü) |

## Güvenlik

- Strict whitelist klasör sınırı
- Absolute path engelleme
- Path traversal koruması

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `local_read_file` | Whitelist içinden dosya oku |
| `local_write_file` | Whitelist içine dosya yaz |
| `local_list_files` | Whitelist dosyalarını listele |

## Konfigürasyon

```env
LOCAL_SIDECAR_WHITELIST=/home/user/projects,/home/user/documents
```
