# Image Generation Plugin

AI görsel oluşturma.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/image/generate` | POST | Görsel oluştur |
| `/image/variations` | POST | Mevcut görselden varyasyonlar oluştur |

## Desteklenen Sağlayıcılar

- DALL-E (OpenAI)
- Stability AI

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `image_generate` | Prompt ile görsel oluştur |
| `image_create_variation` | Mevcut görselden varyasyon |

## Konfigürasyon

```env
OPENAI_API_KEY=sk-...
STABILITY_API_KEY=sk-...
```
