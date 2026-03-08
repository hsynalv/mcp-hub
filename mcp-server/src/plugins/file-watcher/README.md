# File Watcher Plugin

Dosya değişiklik izleme.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/file-watcher/watch` | POST | Dizin izlemeye al |
| `/file-watcher/unwatch` | POST | İzlemeyi bırak |
| `/file-watcher/list` | GET | İzlenen dizinler |
| `/file-watcher/events` | GET | Son olaylar (SSE/WebSocket) |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `file_watcher_watch` | Dizin izlemeye al |
| `file_watcher_unwatch` | İzlemeyi bırak |
| `file_watcher_get_events` | Son değişiklikleri al |

## Özellikler

- Recursive izleme
- Ignore pattern desteği (.gitignore)
- Debounced events
- WebSocket/SSE real-time updates
