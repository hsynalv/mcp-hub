# Git Plugin

Git repo operasyonları.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/git/status` | GET | Repo durumu |
| `/git/commit` | POST | Commit yap |
| `/git/push` | POST | Push |
| `/git/branches` | POST | Branch oluştur |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `git_status` | Repo durumunu kontrol et |
| `git_commit` | Değişiklikleri commit et |
| `git_push` | Remote'a push et |
| `git_create_branch` | Yeni branch oluştur |
