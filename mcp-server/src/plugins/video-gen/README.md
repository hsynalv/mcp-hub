# Video Generation Plugin

AI video oluşturma.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/video/generate` | POST | Video oluştur |
| `/video/status/:id` | GET | Oluşturma durumu |

## Desteklenen Sağlayıcılar

- Runway ML
- Pika Labs
- Stable Video Diffusion

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `video_generate` | Prompt veya görselden video oluştur |
| `video_get_status` | Video oluşturma durumunu kontrol et |

## Konfigürasyon

```env
RUNWAY_API_KEY=xxx
PIKA_API_KEY=xxx
```
