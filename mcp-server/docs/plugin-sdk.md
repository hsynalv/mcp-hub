# Plugin SDK

The Plugin SDK provides reusable utilities to simplify MCP-Hub plugin development. Use it for consistent tool registration, config loading, validation, audit logging, and metrics.

## Plugin Lifecycle

1. **Discovery** – Plugins are loaded from `src/plugins/<name>/index.js`
2. **Validation** – `plugin.meta.json` is validated (optional; defaults used if missing)
3. **Registration** – `register(app)` is called to mount routes
4. **Tool Registration** – `tools` array is registered with the tool registry

## Plugin Structure

Recommended folder structure:

```
src/plugins/my-plugin/
├── index.js          # Main plugin entry (required)
├── plugin.meta.json  # Metadata (optional, recommended)
└── ...              # Additional modules as needed
```

### Required Exports

| Export | Type | Description |
|--------|------|-------------|
| `register` | `function(app)` | Mounts routes and registers tools |
| `name` or `metadata.name` | `string` | Plugin identifier |
| `version` or `metadata.version` | `string` | Semver version |

### Optional Exports

| Export | Type | Description |
|--------|------|-------------|
| `metadata` | `object` | Full metadata (from `createMetadata`) |
| `tools` | `array` | MCP tool definitions |
| `endpoints` | `array` | API endpoint descriptions |
| `description` | `string` | Plugin description |
| `capabilities` | `string[]` | e.g. `["read", "write"]` |

## Tool Registration

### Using createTool

```js
import { createTool, ToolTags } from "../../core/plugin-sdk/index.js";

const tools = [
  createTool({
    name: "my_plugin_do_something",
    description: "Does something useful",
    inputSchema: {
      properties: {
        input: { type: "string", description: "Input value" },
      },
      required: ["input"],
    },
    handler: async (args, context) => {
      return { ok: true, data: { result: args.input } };
    },
    tags: [ToolTags.READ_ONLY],
  }),
];
```

### Using registerTools

```js
import { registerTools } from "../../core/plugin-sdk/index.js";

export function register(app) {
  registerTools("my-plugin", tools);
  // ...
}
```

### Tool Tags

| Tag | Purpose |
|-----|---------|
| `ToolTags.READ_ONLY` | Read-only, low risk |
| `ToolTags.WRITE` | Modifies state |
| `ToolTags.DESTRUCTIVE` | Destructive operation |
| `ToolTags.NETWORK` | Makes network requests |
| `ToolTags.LOCAL_FS` | Accesses local filesystem |
| `ToolTags.EXTERNAL_API` | Calls external APIs |

## Config Loading

Load plugin-specific config from environment variables:

```js
import { loadPluginConfig } from "../../core/plugin-sdk/index.js";

const config = loadPluginConfig("MY_PLUGIN", {
  enabled: true,
  timeoutMs: 10000,
  maxRetries: 3,
});

// Reads: MY_PLUGIN_ENABLED, MY_PLUGIN_TIMEOUT_MS, MY_PLUGIN_MAX_RETRIES
```

With Zod validation:

```js
import { loadPluginConfig, createConfigSchema } from "../../core/plugin-sdk/index.js";

const schema = createConfigSchema({
  enabled: z.boolean(),
  timeoutMs: z.number().min(100).max(60000),
});

const config = loadPluginConfig("MY_PLUGIN", { enabled: true, timeoutMs: 5000 }, schema);
```

## Error Handling

Use `createPluginErrorHandler` for consistent errors:

```js
import { createPluginErrorHandler } from "../../core/plugin-sdk/index.js";

const handleError = createPluginErrorHandler("my-plugin");

// In route/tool:
throw handleError.validation("Invalid input", details);
throw handleError.external("ExternalService", err.message);
throw handleError.timeout("fetch");
```

## Audit Logging

```js
import { createAuditHelper } from "../../core/plugin-sdk/index.js";

const audit = createAuditHelper("my-plugin");

await audit.log({
  operation: "do_something",
  actor: context.actor,
  workspaceId: context.workspaceId,
  success: true,
  durationMs: 150,
  metadata: { itemCount: 10 },
});

const entries = await audit.getRecent({ limit: 50 });
```

## Validation

### Inline validation (validateBodySync)

When you need to validate inside a route handler:

```js
import { validateBodySync } from "../../core/plugin-sdk/index.js";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1) });

router.post("/action", (req, res) => {
  const data = validateBodySync(schema, req.body, res, "my-plugin");
  if (!data) return; // Response already sent
  // use data
});
```

### Middleware validation

For route-level validation:

```js
import { validateBody } from "../../core/plugin-sdk/index.js";

router.post("/action", validateBody(schema), (req, res) => {
  const data = req.validatedBody;
  // ...
});
```

## Request Context

Extract standard context from requests:

```js
import { extractRequestContext } from "../../core/plugin-sdk/index.js";

router.get("/data", (req, res) => {
  const ctx = extractRequestContext(req);
  // ctx.actor, ctx.workspaceId, ctx.projectId, ctx.correlationId
});
```

## Best Practices

1. **Use createMetadata** – Ensures consistent metadata structure
2. **Use createTool** – Standardizes tool definitions
3. **Audit important operations** – Use `createAuditHelper` for write/destructive ops
4. **Validate inputs** – Use Zod + `validateBodySync` or `validateBody` middleware
5. **Handle errors** – Use `createPluginErrorHandler` for standardized errors
6. **Add plugin.meta.json** – Enables quality checks and documentation
7. **Use requireScope** – Protect routes with `requireScope("read")` or `requireScope("write")`

## Creating a New Plugin

### Using the generator

```bash
npm run create-plugin my-plugin "My plugin description"
```

This creates `src/plugins/my-plugin/` with `index.js` and `plugin.meta.json`.

### Manual setup

1. Create `src/plugins/<name>/index.js`
2. Export `register`, `metadata` (or `name`/`version`), and optionally `tools`
3. Add `plugin.meta.json` for metadata validation
4. Restart the server – plugins load automatically

## Migration from Existing Plugins

Existing plugins continue to work without changes. To adopt the SDK:

1. Replace manual tool definitions with `createTool` and `registerTools`
2. Replace custom audit logic with `createAuditHelper`
3. Replace manual validation with `validateBodySync` or `validateBody`
4. Use `loadPluginConfig` for env-based config
5. Use `extractRequestContext` for request context

No breaking changes – SDK utilities wrap existing core APIs.
