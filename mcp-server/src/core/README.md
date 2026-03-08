# Core Module

Core modülleri plugin sistemi için temel altyapı sağlar.

## Modüller

| Modül | Açıklama |
|-------|----------|
| `auth.js` | API key auth ve scope yönetimi |
| `config.js` | Çevre değişkenleri ve config |
| `errors.js` | Hata sınıfları (AppError, NotFoundError) |
| `jobs.js` | Job kuyruğu ve runner yönetimi |
| `plugins.js` | Plugin loader ve discovery |
| `server.js` | Express server ve middleware |
| `tool-registry.js` | MCP tool kayıt ve yönetimi |
| `tool-hooks.js` | Hook registration sistemi |
| `audit.js` | Audit log ve istatistikler |

## Auth Scopes

- `read` - Okuma operasyonları
- `write` - Yazma/değişiklik operasyonları  
- `admin` - Yönetim operasyonları

## Tool Registration

```javascript
import { registerTool } from "./tool-registry.js";

registerTool({
  name: "my_tool",
  description: "Tool açıklaması",
  tags: ["READ"],
  handler: async (args) => {
    return { result: "ok" };
  }
});
```

## Hook Sistemi

```javascript
import { registerBeforeExecutionHook } from "./tool-hooks.js";

registerBeforeExecutionHook("my-hook", (toolName, args) => {
  // Tool çalışmadan önce
  return { allowed: true };
});
```
