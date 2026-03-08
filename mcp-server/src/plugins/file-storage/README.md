# File Storage Plugin

S3, Google Drive ve local dosya operasyonları.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/files/upload` | POST | Dosya yükle |
| `/files/download` | GET | Dosya indir |
| `/files/list` | GET | Dosyaları listele |
| `/files/delete` | DELETE | Dosya sil |

## Desteklenen Depolar

- AWS S3
- Google Drive
- Local filesystem

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `files_upload` | Dosya yükle |
| `files_download` | Dosya indir |
| `files_list` | Dosyaları listele |

## Konfigürasyon

```env
# S3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
S3_BUCKET_NAME=my-bucket

# Google Drive
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx

# Local
FILE_STORAGE_LOCAL_ROOT=./storage
```
