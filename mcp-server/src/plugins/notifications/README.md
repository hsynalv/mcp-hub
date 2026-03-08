# Notifications Plugin

Cross-platform bildirimler.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/notifications/send` | POST | Bildirim gönder |
| `/notifications/channels` | GET | Mevcut kanallar |

## Desteklenen Kanallar

- macOS Notification Center
- Windows Toast
- Linux notify-send
- System tray

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `notifications_send` | Sistem bildirimi gönder |
| `notifications_list_channels` | Mevcut kanalları listele |

## Örnek

```json
{
  "title": "Build Complete",
  "message": "Project built successfully",
  "urgency": "normal"
}
```
