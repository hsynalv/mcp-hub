# Brain Plugin

AI yetenekleri ve bellek yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/brain/skills/:name/invoke` | POST | Yetenek çalıştır |
| `/brain/chat` | POST | Chat with context |
| `/brain/planner` | POST | Plan oluştur |
| `/brain/memory` | POST | Belleğe kaydet |
| `/brain/memory` | GET | Bellekten al |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `brain_invoke_skill` | Yetenek çalıştır |
| `brain_chat` | AI ile chat |
| `brain_plan` | Görev planı oluştur |
| `brain_remember` | Bilgi kaydet |
| `brain_recall` | Bilgi al |

## Konfigürasyon

```env
OPENAI_API_KEY=sk-...
BRAIN_DEFAULT_MODEL=gpt-4
```
