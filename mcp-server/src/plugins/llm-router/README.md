# LLM Router Plugin

Çoklu LLM sağlayıcı yönlendirme.

## Desteklenen Sağlayıcılar

- OpenAI
- Anthropic (Claude)
- Local models (Ollama, vb.)

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/llm/chat` | POST | Chat completion |
| `/llm/models` | GET | Mevcut modeller |
| `/llm/route` | POST | Sağlayıcı seç ve çalıştır |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `llm_chat` | LLM ile chat |
| `llm_route` | Uygun sağlayıcıyı seç ve çalıştır |

## Konfigürasyon

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_BASE_URL=http://localhost:11434
```
