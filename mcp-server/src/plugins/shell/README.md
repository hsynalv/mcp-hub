# Shell Plugin

Güvenli shell komut çalıştırma.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/shell/execute` | POST | Komut çalıştır |
| `/shell/allowed-commands` | GET | İzinli komutlar listesi |

## Güvenlik

- Whitelist komut sınırı
- Timeout limiti
- Output truncation
- Path sanitization

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `shell_execute` | İzinli komut çalıştır |
| `shell_list_commands` | Mevcut izinli komutları listele |

## Örnek

```json
{
  "command": "ls",
  "args": ["-la", "/workspace"]
}
```
