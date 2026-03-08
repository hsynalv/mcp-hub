# n8n Workflows Plugin

n8n workflow yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/n8n/workflows` | GET | Tüm workflow'ları listele |
| `/n8n/workflows/:id` | GET | Workflow detayı |
| `/n8n/workflows/search` | POST | Workflow ara |

## Özellikler

- Workflow JSON export/import
- Node tipi bazlı arama
- Execution history
- Webhook URL'leri

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `n8n_list_workflows` | Workflow'ları listele |
| `n8n_get_workflow` | Workflow detayı al |
| `n8n_search_workflows` | İsme göre ara |
| `n8n_find_by_node` | Node tipine göre ara |

## Konfigürasyon

```env
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=n8n_api_xxx
ALLOW_N8N_WRITE=true
```
