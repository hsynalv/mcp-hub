# Projects Plugin

Proje yapılandırma yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/projects` | GET | Projeleri listele |
| `/projects` | POST | Yeni proje oluştur |
| `/projects/:id` | GET | Proje detayı |
| `/projects/:id/config` | GET/POST | Proje config'i |

## Config Yapısı

Her proje kendi:
- Notion DB ID'leri
- GitHub repo mapping
- Slack kanalları
- Özel env var'ları

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `projects_list` | Projeleri listele |
| `projects_create` | Yeni proje oluştur |
| `projects_get_config` | Proje config'i al |
| `projects_set_config` | Proje config'i güncelle |

## Proje Context Header'ları

```
x-project-id: my-project
x-env: development
```
