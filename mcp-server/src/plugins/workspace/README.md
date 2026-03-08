# Workspace Plugin

Güvenli dosya sistemi erişimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/workspace/files` | GET | Dosya listesi |
| `/workspace/files/:path` | GET | Dosya oku |
| `/workspace/files/:path` | POST | Dosya yaz |
| `/workspace/files/:path` | DELETE | Dosya sil |

## Güvenlik

- Whitelist klasör sınırı
- Path traversal koruması
- Göreceli path'ler sadece

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `workspace_read_file` | Dosya oku |
| `workspace_write_file` | Dosya yaz |
| `workspace_list_files` | Dosyaları listele |
| `workspace_delete_file` | Dosya sil |

## Konfigürasyon

```env
WORKSPACE_PATH=/path/to/allowed/workspace
```
