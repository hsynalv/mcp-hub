# File Storage Plugin

S3, Google Drive ve lokal depolama için birleşik dosya işlemleri API'si.

## Backend'ler

| Backend | Açıklama | Gerekli env |
|---------|----------|-------------|
| `s3` | AWS S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` |
| `gdrive` | Google Drive | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` |
| `local` | Lokal dosya sistemi | `FILE_STORAGE_LOCAL_ROOT` (default: `./cache/files`) |

## Endpoint'ler

- `GET /file-storage/list?backend=&path=` — Dosya/klasör listesi
- `GET /file-storage/read?backend=&path=` — Dosya içeriği (base64)
- `POST /file-storage/write` — `{ backend, path, content, contentType? }`
- `DELETE /file-storage/delete?backend=&path=`
- `POST /file-storage/copy` — `{ backend, sourcePath, destPath }`
- `POST /file-storage/move` — `{ backend, sourcePath, destPath }`
- `GET /file-storage/health`

## Google Drive OAuth2

Refresh token almak için OAuth2 flow kullanılmalıdır. Google Cloud Console'da Drive API etkinleştirilip OAuth2 credentials oluşturulmalıdır.
