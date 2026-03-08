# n8n Credentials Plugin

n8n credential metadata erişimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/credentials` | GET | Tüm credential'ları listele |
| `/credentials/:type` | GET | Belirli tip credential'ları listele |
| `/credentials/refresh` | POST | n8n'den yenile |

## Not

Secret değerler döndürülmez, sadece metadata:
- Credential tipi
- İsim
- Node uyumluluğu

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `credentials_list` | Mevcut credential'ları listele |
| `credentials_refresh` | n8n'den yenile |

## Konfigürasyon

```env
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=n8n_api_xxx
```
