# Notion Plugin

Notion API entegrasyonu.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/notion/setup-project` | POST | Proje + görev oluştur |
| `/notion/templates/apply` | POST | Template uygula |
| `/notion/templates/pages` | POST | Sayfa oluştur (template'den) |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `notion_setup_project` | Proje ve görevler oluştur |
| `notion_apply_template` | Template uygula |
| `notion_create_task` | Görev oluştur |
| `notion_search` | Notion'da ara |

## Konfigürasyon

```env
NOTION_API_KEY=secret_xxx
NOTION_ROOT_PAGE_ID=xxx
NOTION_PROJECTS_DB_ID=xxx
NOTION_TASKS_DB_ID=xxx
```
