# n8n Plugin

n8n node kataloğu ve workflow yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/n8n/context` | POST | Node + credential + örnekler (birleşik) |
| `/n8n/nodes/search` | GET | Node ara |
| `/n8n/nodes/:type` | GET | Node şeması |
| `/n8n/examples` | GET | Workflow örnekleri |
| `/n8n/workflow/validate` | POST | Workflow doğrula |
| `/n8n/workflow/apply` | POST | Workflow oluştur/güncelle |
| `/n8n/catalog/refresh` | POST | Node kataloğunu yenile |

## Konfigürasyon

```env
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=n8n_api_xxx
ALLOW_N8N_WRITE=true
ENABLE_N8N_PLUGIN=true
```

## Not

`n8n-nodes-base` paketinden doğrudan okur, n8n instance gerekmez.
