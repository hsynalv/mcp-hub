# Slack Plugin

Slack mesajlaşma entegrasyonu.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/slack/message` | POST | Mesaj gönder |
| `/slack/channels` | GET | Kanalları listele |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `slack_send_message` | Kanala veya DM mesaj gönder |
| `slack_list_channels` | Kanalları listele |

## Konfigürasyon

```env
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_SIGNING_SECRET=xxx
```
