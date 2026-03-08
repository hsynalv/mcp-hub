# MCP Hub Plugin SDK

Complete developer guide for creating MCP Hub plugins.

## Table of Contents

1. [Plugin Folder Structure](#1-plugin-folder-structure)
2. [Required Exports](#2-required-exports)
3. [Plugin Manifest Format](#3-plugin-manifest-format)
4. [Tool Schema Requirements](#4-tool-schema-requirements)
5. [Plugin Lifecycle](#5-plugin-lifecycle)
6. [Error Handling Standard](#6-error-handling-standard)
7. [Testing Requirements](#7-testing-requirements)

---

## 1. Plugin Folder Structure

Every plugin must follow this directory structure:

```
src/plugins/my-plugin/
├── index.js              # Main entry point (required)
├── manifest.json         # Plugin metadata (required)
├── schema.json           # Tool schemas (optional)
├── README.md             # Documentation (required)
├── tests/                # Test files (required)
│   ├── unit.test.js
│   └── smoke.test.js
└── my-plugin.core.js     # Business logic (optional)
```

### File Purposes

| File | Purpose | Required |
|------|---------|----------|
| `index.js` | Main exports and route registration | Yes |
| `manifest.json` | Plugin metadata and configuration | Yes |
| `README.md` | Usage documentation and examples | Yes |
| `tests/` | Unit and smoke tests | Yes |
| `schema.json` | JSON schemas for tools | No |
| `*.core.js` | Internal business logic | No |

---

## 2. Required Exports

Every plugin must export the following from `index.js`:

### Basic Exports

```javascript
// Required exports
export const name = "my-plugin";           // Must match folder name
export const version = "1.0.0";            // SemVer format
export const description = "What this plugin does";

// Required function
export function register(app, ctx) {
  // Register Express routes
  app.get("/my-plugin/resource", handler);
}
```

### Register Function

The `register` function is called during plugin initialization:

```javascript
export async function register(app, ctx) {
  // app: Express application instance
  // ctx: Plugin context object
  
  // Register routes
  app.get("/my-plugin/items", async (req, res) => {
    const items = await getItems(ctx);
    res.json({ ok: true, data: items });
  });
  
  // Use context for logging
  ctx.logger.info("MyPlugin registered");
}
```

### Plugin Context

The `ctx` object provides:

```javascript
{
  workspaceId: string,      // Current workspace ID
  projectId: string,        // Current project ID
  env: string,              // Environment (dev/prod)
  config: Object,           // Plugin configuration
  logger: Logger,           // Structured logger
  registerHook: Function    // Event hook registration
}
```

---

## 3. Plugin Manifest Format

Create `manifest.json` with these fields:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "capabilities": ["read", "write"],
  "requiresAuth": true,
  "status": "beta",
  "requires": ["ENV_VAR_NAME"],
  "endpoints": [
    {
      "path": "/my-plugin/resource",
      "method": "GET",
      "description": "List resources",
      "scope": "read"
    }
  ],
  "tools": [
    {
      "name": "my-plugin_tool",
      "description": "Tool description",
      "tags": ["read"]
    }
  ]
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Plugin identifier (must match folder) |
| `version` | string | Yes | SemVer version |
| `description` | string | Yes | Short description |
| `capabilities` | array | Yes | ["read", "write", "admin"] |
| `requiresAuth` | boolean | No | Requires API key |
| `status` | string | Yes | "stable", "beta", "experimental" |
| `requires` | array | No | Required env vars |
| `endpoints` | array | No | HTTP endpoints |
| `tools` | array | No | MCP tools |

### Status Values

- `stable` - Production ready
- `beta` - Functional but testing
- `experimental` - Early development

---

## 4. Tool Schema Requirements

### Input Schema

Define tool input parameters using JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "limit": {
      "type": "number",
      "default": 10,
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": ["query"]
}
```

### Output Schema

Standard tool response format:

```json
{
  "type": "object",
  "properties": {
    "ok": { "type": "boolean" },
    "data": { "type": "object" },
    "error": {
      "type": "object",
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" }
      }
    },
    "meta": {
      "type": "object",
      "properties": {
        "correlationId": { "type": "string" }
      }
    }
  },
  "required": ["ok"]
}
```

### Error Schema

Standardized error structure:

```json
{
  "type": "object",
  "properties": {
    "code": { "type": "string" },
    "category": {
      "type": "string",
      "enum": [
        "validation",
        "authentication",
        "authorization",
        "not_found",
        "external_error",
        "internal_error"
      ]
    },
    "message": { "type": "string" },
    "userSafeMessage": { "type": "string" },
    "retryable": { "type": "boolean" },
    "details": { "type": "object" }
  },
  "required": ["code", "message"]
}
```

---

## 5. Plugin Lifecycle

### Initialization

1. Plugin folder discovered
2. `manifest.json` validated
3. `index.js` loaded
4. `register(app, ctx)` called
5. Routes registered with Express
6. Tools registered with MCP

```javascript
export async function register(app, ctx) {
  // Setup code runs once at startup
  await initializeDatabase();
  
  // Register routes
  app.get("/my-plugin/health", healthHandler);
  
  // Register hooks
  ctx.registerHook("before:request", async (req) => {
    ctx.logger.debug("Request started", { path: req.path });
  });
}
```

### Request Handling

Each request flows through:

1. Auth middleware (if required)
2. Rate limiting
3. Policy check (approval if needed)
4. Plugin handler execution
5. Response formatting
6. Audit logging

```javascript
app.get("/my-plugin/items", async (req, res) => {
  try {
    const items = await fetchItems(req.query);
    res.json({ ok: true, data: items });
  } catch (err) {
    // Errors handled by standardized error system
    throw err;
  }
});
```

### Cleanup

Optional cleanup function for graceful shutdown:

```javascript
export async function cleanup() {
  // Close database connections
  await db.close();
  
  // Clear caches
  cache.clear();
  
  // Release resources
  client.disconnect();
}
```

---

## 6. Error Handling Standard

Plugins must use the core error system:

```javascript
import { Errors, createPluginErrorHandler } from "../core/error-standard.js";

// Create plugin-specific error handler
const pluginError = createPluginErrorHandler("my-plugin");

export function register(app, ctx) {
  app.get("/my-plugin/resource", async (req, res) => {
    try {
      const data = await fetchData();
      res.json({ ok: true, data });
    } catch (err) {
      // Wrap any error into standardized format
      throw pluginError.wrap(err, "fetchData");
    }
  });
}
```

### Error Categories

Use appropriate error types:

```javascript
// Validation errors
throw Errors.validation("Invalid parameter", { field: "query" });

// External service errors
throw Errors.externalError("GitHub", "API rate limit exceeded");

// Not found
throw Errors.notFound("Resource");

// Timeout
throw Errors.timeout("database-query");

// Generic plugin error
throw pluginError.wrap(err, "operation-name");
```

### Error Response Format

All errors automatically serialize to:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "validation",
    "message": "Invalid parameter",
    "userSafeMessage": "Invalid parameter",
    "retryable": false
  },
  "meta": {
    "correlationId": "req-1234567890",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

---

## 7. Testing Requirements

### Minimum Test Coverage

Every plugin must have:

1. **Unit Tests** - Test individual functions
2. **Smoke Tests** - Test basic functionality

### Unit Test Example

```javascript
// tests/unit.test.js
import { describe, it, expect } from "vitest";
import { parseQuery, validateInput } from "../my-plugin.core.js";

describe("parseQuery", () => {
  it("should parse valid query", () => {
    const result = parseQuery("search term");
    expect(result).toEqual({ term: "search term", filters: [] });
  });
  
  it("should handle empty query", () => {
    const result = parseQuery("");
    expect(result).toBeNull();
  });
});

describe("validateInput", () => {
  it("should reject invalid input", () => {
    expect(() => validateInput({})).toThrow("query is required");
  });
});
```

### Smoke Test Example

```javascript
// tests/smoke.test.js
import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import * as plugin from "../index.js";

async function createTestApp() {
  const app = express();
  const ctx = {
    workspaceId: "test-workspace",
    projectId: "test-project",
    env: "test",
    config: {},
    logger: console,
    registerHook: () => {}
  };
  
  await plugin.register(app, ctx);
  return app;
}

describe("Plugin Smoke Tests", () => {
  it("GET /my-plugin/health should return 200", async () => {
    const app = await createTestApp();
    const res = await request(app).get("/my-plugin/health");
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
  
  it("GET /my-plugin/items should return array", async () => {
    const app = await createTestApp();
    const res = await request(app).get("/my-plugin/items");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
```

### Test Commands

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:plugin:my-plugin": "vitest run tests/plugins/my-plugin"
  }
}
```

Run tests:

```bash
# All tests
npm run test:run

# Specific plugin
npm run test:plugin:my-plugin
```

---

## Quick Start Template

Use the CLI to scaffold a new plugin:

```bash
npm run create-plugin my-plugin
```

This creates:
- `index.js` with proper exports
- `manifest.json` with template
- `README.md` with documentation
- `tests/` folder with examples

---

## Best Practices

1. **Naming** - Plugin name matches folder name
2. **Versioning** - Use semantic versioning
3. **Errors** - Always use standardized errors
4. **Validation** - Validate all inputs with Zod
5. **Logging** - Use `ctx.logger`, not console
6. **Cleanup** - Always implement cleanup for resources
7. **Tests** - 100% coverage for critical paths
8. **Docs** - Include examples in README

## See Also

- [Plugin Maturity Matrix](./plugin-maturity-matrix.md)
- [Architecture Overview](../mcp-server/ARCHITECTURE.md)
- [Error Standard](../mcp-server/src/core/error-standard.js)
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
