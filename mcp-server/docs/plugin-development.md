# Plugin Geliştirme

## Başlangıç

`src/plugins/<name>/index.js` oluşturun:

```javascript
export const name = "my-plugin";
export const version = "1.0.0";
export const description = "Açıklama";

export function register(app) {
  app.get("/my-plugin/hello", (req, res) => {
    res.json({ message: "Hello" });
  });
}
```

## Export Gereksinimleri

| Export | Tip | Zorunlu | Açıklama |
|--------|-----|---------|----------|
| `name` | string | ✅ | Plugin ID |
| `version` | string | ✅ | Semver |
| `register` | function | ✅ | Express route'ları |
| `description` | string | ❌ | Açıklama |
| `endpoints` | array | ❌ | API endpoint tanımları |
| `tools` | array | ❌ | MCP araçları |
| `examples` | array | ❌ | Örnek kullanımlar |

## Endpoint Tanımı

```javascript
export const endpoints = [
  {
    path: "/my-plugin/resource",
    method: "GET",
    description: "Resource'ları listele",
    scope: "read",  // "read", "write", "admin"
    requestSchema: { ... },
    responseSchema: { ... }
  }
];
```

## MCP Aracı

```javascript
import { ToolTags } from "../../core/tool-registry.js";

export const tools = [
  {
    name: "my_tool",
    description: "Araç açıklaması",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        param: { type: "string" }
      },
      required: ["param"]
    },
    handler: async (args) => {
      return { result: args.param };
    }
  }
];
```

## Auth Scope'ları

- `read` - Okuma operasyonları
- `write` - Yazma/Değişiklik operasyonları
- `admin` - Yönetim operasyonları

## Tool Tag'leri

- `ToolTags.READ` - Sadece okuma
- `ToolTags.WRITE` - Durum değiştirir
- `ToolTags.NETWORK` - Ağ isteği yapar
- `ToolTags.EXTERNAL_API` - Dış API çağrısı
- `ToolTags.GIT` - Git operasyonu
- `ToolTags.LOCAL_FS` - Yerel dosya sistemi
- `ToolTags.BULK` - Toplu işlem

## Hook Registration

```javascript
import { registerBeforeExecutionHook } from "../../core/tool-hooks.js";

export function register(app) {
  registerBeforeExecutionHook("my-plugin", async (toolName, args) => {
    // Tool çalışmadan önce
    return { allowed: true };
  });
}
```

## Best Practices

1. **Error handling** - Her zaman try/catch kullan
2. **Validation** - Input'ları doğrula (Zod önerilir)
3. **Logging** - `console.log` yerine audit sistemini kullan
4. **Config** - `config.js`'ten ayarları oku
5. **Test** - Plugin için unit test yaz

## Örnek Tam Plugin

```javascript
import { ToolTags } from "../../core/tool-registry.js";

export const name = "hello";
export const version = "1.0.0";
export const description = "Hello world plugin";

export const endpoints = [
  {
    path: "/hello/:name",
    method: "GET",
    description: "Hello mesajı döndür",
    scope: "read"
  }
];

export const tools = [
  {
    name: "hello_greet",
    description: "İsimle selamla",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" }
      },
      required: ["name"]
    },
    handler: async ({ name }) => {
      return { message: `Hello, ${name}!` };
    }
  }
];

export function register(app) {
  app.get("/hello/:name", (req, res) => {
    res.json({ message: `Hello, ${req.params.name}!` });
  });
}
```
