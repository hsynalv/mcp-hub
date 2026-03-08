# Email Plugin

SMTP email gönderimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/email/send` | POST | Email gönder |
| `/email/templates` | GET | Template listesi |
| `/email/send-template` | POST | Template ile email gönder |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `email_send` | Email gönder |
| `email_send_template` | Template ile email gönder |

## Konfigürasyon

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
SMTP_FROM=noreply@example.com
```
