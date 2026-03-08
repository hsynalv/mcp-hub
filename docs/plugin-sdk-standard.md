# Plugin SDK Standard

MCP-Hub plugin geliştirme standardı ve kontrat tanımları.

## Plugin Kontratı

Her plugin aşağıdaki yapıyı sağlamalıdır:

```typescript
interface PluginContract {
  // Zorunlu alanlar
  name: string;              // Plugin ID (klasör adı ile aynı)
  version: string;           // SemVer (1.0.0)
  register: (app: Express, ctx: PluginContext) => void | Promise<void>;
  
  // Opsiyonel ama önerilen
  description?: string;
  endpoints?: EndpointDefinition[];
  tools?: MCPToolDefinition[];
  manifest?: PluginManifest;
  schemas?: { input: JSONSchema; output: JSONSchema };
  
  // Lifecycle hooks
  healthcheck?: () => Promise<HealthStatus>;
  cleanup?: () => Promise<void>;
  
  // Capability flags
  capabilities?: string[];
  requiresAuth?: boolean;
  supportsJobs?: boolean;
  supportsStreaming?: boolean;
}

interface PluginContext {
  workspaceId: string;
  projectId: string;
  env: string;
  config: Record<string, any>;
  logger: Logger;
  registerHook: (event: string, handler: Function) => void;
}

interface EndpointDefinition {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  scope: 'read' | 'write' | 'admin';
  requestSchema?: JSONSchema;
  responseSchema?: JSONSchema;
  handler?: (req: Request, res: Response) => void;
}

interface MCPToolDefinition {
  name: string;
  description: string;
  tags: ToolTag[];
  inputSchema: JSONSchema;
  handler: (args: any, context: ToolContext) => Promise<ToolResult>;
}

type ToolResult = {
  ok: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    correlationId: string;
  };
};
```

## Lifecycle Hooks

### 1. register(app, ctx)
**Zorunlu.** Plugin'in Express route'larını kaydettiği fonksiyon.

```javascript
export async function register(app, ctx) {
  // Route tanımları
  app.get('/my-plugin/resource', handler);
  
  // Hook kayıtları
  ctx.registerHook('before:tool', async (toolName, args) => {
    // Tool çalışmadan önce
  });
}
```

### 2. healthcheck()
**Opsiyonel.** Sağlık kontrolü için.

```javascript
export async function healthcheck() {
  return {
    status: 'healthy', // 'healthy' | 'degraded' | 'unhealthy'
    checks: {
      database: { status: 'ok', latency: 10 },
      externalAPI: { status: 'ok', latency: 50 }
    }
  };
}
```

### 3. cleanup()
**Opsiyonel.** Graceful shutdown için.

```javascript
export async function cleanup() {
  // Bağlantıları kapat, cache'i temizle
  await db.close();
  cache.clear();
}
```

## Error Mapping

Tüm plugin'ler standart error envelope kullanmalı:

```javascript
import { Errors, createPluginErrorHandler } from '../core/error-standard.js';

const pluginError = createPluginErrorHandler('my-plugin');

// Handler içinde
async function handler(args) {
  try {
    // İşlem
  } catch (err) {
    throw pluginError.wrap(err, 'operation_name');
  }
}
```

## Capability Flags

Plugin'in yeteneklerini belirtir:

```javascript
export const capabilities = [
  'read',           // Okuma operasyonları
  'write',          // Yazma operasyonları
  'network',        // Ağ isteği yapar
  'external_api',     // Dış API çağrısı
  'local_fs',         // Yerel dosya sistemi
  'dangerous',        // Yüksek risk (shell, db write)
];
```

**Not:** `dangerous` flag'i olan plugin'ler için approval zorunludur.

## CLI Scaffold

Yeni plugin oluşturma:

```bash
npm run create-plugin my-plugin
# veya
npx @mcp-hub/plugin-sdk create my-plugin
```

Bu komut şablon dosyalarını oluşturur:
```
src/plugins/my-plugin/
├── index.js          # Ana export
├── my-plugin.core.js # İş mantığı
├── README.md         # Dokümantasyon
└── plugin.meta.json  # Metadata
```

## Validation

Plugin loader aşağıdaki kontrolleri yapar:

1. **Zorunlu exportlar:** `name`, `version`, `register`
2. **İsim eşleşmesi:** `name` klasör adı ile aynı
3. **SemVer:** `version` geçerli semver olmalı
4. **Register fonksiyonu:** `typeof register === 'function'`
5. **Healthcheck:** Varsa fonksiyon olmalı
6. **Cleanup:** Varsa fonksiyon olmalı

## Best Practices

1. **İsimlendirme:** Plugin klasörü ve `name` aynı olmalı
2. **Versiyon:** Her değişiklikte semver güncellemesi
3. **Error handling:** Her zaman standardized error kullan
4. **Validation:** Input'ları Zod ile doğrula
5. **Logging:** `ctx.logger` kullan, console.log'dan kaçın
6. **Config:** `ctx.config`'ten oku
7. **Cleanup:** Açık bağlantıları kapat
8. **Testing:** Contract test yaz

## Örnek Tam Plugin

```javascript
import { z } from 'zod';
import { ToolTags } from '../../core/tool-registry.js';
import { createPluginErrorHandler } from '../../core/error-standard.js';

const pluginError = createPluginErrorHandler('example');

// Zorunlu exportlar
export const name = 'example';
export const version = '1.0.0';
export const description = 'Example plugin demonstrating SDK standard';
export const capabilities = ['read', 'write'];

// Endpoint tanımları
export const endpoints = [
  {
    path: '/example/resource',
    method: 'GET',
    description: 'List resources',
    scope: 'read'
  },
  {
    path: '/example/resource',
    method: 'POST',
    description: 'Create resource',
    scope: 'write'
  }
];

// MCP araçları
export const tools = [
  {
    name: 'example_greet',
    description: 'Greet a user',
    tags: [ToolTags.READ],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    },
    handler: async ({ name }, context) => {
      return {
        ok: true,
        data: { message: `Hello, ${name}!` },
        meta: { correlationId: context.correlationId }
      };
    }
  }
];

// Lifecycle: Register
export function register(app, ctx) {
  app.get('/example/resource', async (req, res) => {
    try {
      const resources = await getResources(ctx);
      res.json({ ok: true, data: resources });
    } catch (err) {
      throw pluginError.wrap(err, 'getResources');
    }
  });

  app.post('/example/resource', async (req, res) => {
    try {
      const resource = await createResource(req.body, ctx);
      res.json({ ok: true, data: resource });
    } catch (err) {
      throw pluginError.wrap(err, 'createResource');
    }
  });
}

// Lifecycle: Healthcheck
export async function healthcheck() {
  return {
    status: 'healthy',
    checks: {
      memory: { status: 'ok' }
    }
  };
}

// Lifecycle: Cleanup
export async function cleanup() {
  // Cleanup logic
}

// Helper functions
async function getResources(ctx) {
  return [{ id: 1, name: 'Resource 1' }];
}

async function createResource(data, ctx) {
  return { id: Date.now(), ...data };
}
```
