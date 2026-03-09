# Plugin Registry

Central plugin management system for MCP-Hub platform.

## Overview

The Plugin Registry provides:
- **Plugin Discovery** - Automatic discovery from `src/plugins`
- **Lifecycle Management** - Enable/disable/reload plugins
- **Health Monitoring** - Health checks for all plugins
- **Tool Aggregation** - Centralized tool inventory
- **Metadata Management** - Plugin metadata access

## Architecture

```
src/core/registry/
├── plugin.registry.js       # Main registry class
├── plugin.loader.js         # Plugin loading/unloading
├── plugin.discovery.js      # Plugin discovery
├── plugin.lifecycle.js      # Lifecycle management
├── registry.types.js        # Type definitions
├── index.js                 # Main exports
└── registry.test.js         # Test suite
```

## Quick Start

### Basic Usage

```javascript
import { PluginRegistry, createRegistry, getRegistry } from "./core/registry/index.js";

// Create registry
const registry = createRegistry({
  autoDiscover: true,  // Auto-discover plugins on init
});

// Initialize with Express app
await registry.init(app);

// Enable a plugin
await registry.enable("shell");

// Get all enabled plugins
const enabled = registry.getEnabled();
```

### Global Registry Instance

```javascript
import { getRegistry, setRegistry } from "./core/registry/index.js";

// Get or create global instance
const registry = getRegistry();

// Set custom instance
setRegistry(new PluginRegistry());
```

## Registry Data Model

```javascript
{
  name: "shell",
  version: "1.0.0",
  status: "stable",
  enabled: true,
  metadata: { /* PluginMetadata */ },
  health: "ok",  // "ok" | "degraded" | "failed"
  tools: ["execute", "stream"],
  scopes: ["read", "write", "admin"],
  capabilities: ["execute", "shell"],
  pluginPath: "/path/to/shell",
  instance: { /* Plugin module */ },
  healthCheck: Function  // Optional health check
}
```

## API Reference

### PluginRegistry Class

#### Constructor

```javascript
const registry = new PluginRegistry({
  pluginsDir: "./src/plugins",  // Plugin directory
  autoDiscover: true,           // Auto-discover on init
  lazyLoad: false,              // Load on first use
  exclude: ["test-plugin"],     // Exclude plugins
});
```

#### Methods

**Initialization**
```javascript
// Initialize registry
await registry.init(app);
```

**Plugin Discovery**
```javascript
// Discover and load all plugins
await registry.discoverAndLoad();

// Load specific plugin
await registry.load("plugin-name");
```

**Lifecycle**
```javascript
// Enable plugin
await registry.enable("plugin-name");

// Disable plugin
await registry.disable("plugin-name");

// Reload plugin
await registry.reload("plugin-name");
```

**Queries**
```javascript
// Get single plugin
const plugin = registry.get("plugin-name");

// Get all plugins
const all = registry.getAll();

// Get enabled plugins
const enabled = registry.getEnabled();

// Check existence
const exists = registry.has("plugin-name");

// Check enabled status
const isEnabled = registry.isEnabled("plugin-name");

// Get by capability
const dbPlugins = registry.getByCapability("database");

// Get by scope
const adminPlugins = registry.getByScope("admin");
```

**Status & Health**
```javascript
// Get registry status
const status = registry.getStatus();
// {
//   total: 10,
//   enabled: 5,
//   loaded: 10,
//   healthy: 9,
//   failed: 1,
//   pluginNames: ["shell", "database", ...]
// }

// Check plugin health
const health = await registry.checkHealth("plugin-name");
// {
//   name: "plugin-name",
//   status: "ok",
//   message: "Healthy",
//   timestamp: 1234567890
// }

// Check all health
const allHealth = await registry.checkAllHealth();
```

**Tools**
```javascript
// Get all tools
const tools = registry.getAllTools();
// [
//   { name: "shell.execute", plugin: "shell", tool: "execute", scopes: [...] },
//   { name: "rag.search", plugin: "rag", tool: "search", scopes: [...] }
// ]

// Get plugin tools
const pluginTools = registry.getPluginTools("plugin-name");
```

## Plugin Discovery

### Automatic Discovery

Registry automatically scans `src/plugins` directory:

```javascript
import { discoverPlugins } from "./core/registry/index.js";

const results = await discoverPlugins("./src/plugins", {
  validate: true,  // Validate contract
});

// Results:
// [
//   { name: "shell", path: "...", valid: true },
//   { name: "test", path: "...", valid: false, errors: [...] }
// ]
```

### Validation

Plugins must:
1. Have `index.js` entry point
2. Export `metadata` object
3. Export `register(app)` function

## Lifecycle Management

### Enable/Disable

```javascript
import { enablePlugin, disablePlugin } from "./core/registry/index.js";

// Enable
const result = await enablePlugin(registryMap, "plugin", app);

// Disable
const result = await disablePlugin(registryMap, "plugin");
```

### Reload

```javascript
// Reload without restarting server
await registry.reload("plugin");
```

## Health Checks

Plugins can optionally export a health check:

```javascript
// In plugin index.js
export async function health() {
  return {
    status: "ok",  // "ok" | "degraded" | "failed"
    message: "Healthy"
  };
}
```

Registry checks:
- Plugin exists
- Plugin enabled
- Health function available
- Health check passes

## Tool Aggregation

### Tool Format

```javascript
{
  name: "shell.execute",      // Fully qualified name
  plugin: "shell",            // Plugin name
  tool: "execute",            // Tool name
  scopes: ["write", "admin"] // Required scopes
}
```

### Usage

```javascript
// Get all available tools
const tools = registry.getAllTools();

// Filter by scope
const adminTools = tools.filter(t => t.scopes.includes("admin"));

// Group by plugin
const byPlugin = tools.reduce((acc, t) => {
  acc[t.plugin] = acc[t.plugin] || [];
  acc[t.plugin].push(t);
  return acc;
}, {});
```

## REST Endpoints

### Setup

```javascript
import { Router } from "express";
import { getRegistry } from "./core/registry/index.js";

const router = Router();
const registry = getRegistry();

// GET /plugins
router.get("/plugins", (_req, res) => {
  const plugins = registry.getAll().map(p => ({
    name: p.name,
    version: p.version,
    status: p.status,
    enabled: p.enabled,
    health: p.health,
    capabilities: p.capabilities,
  }));
  res.json({ plugins });
});

// GET /plugins/:name
router.get("/plugins/:name", (req, res) => {
  const plugin = registry.get(req.params.name);
  if (!plugin) {
    return res.status(404).json({ error: "Plugin not found" });
  }
  res.json({ plugin });
});

// GET /plugins/health
router.get("/plugins/health", async (_req, res) => {
  const health = await registry.checkAllHealth();
  res.json({ health });
});
```

## Integration with Server

### Setup in Server Entry

```javascript
import { getRegistry } from "./core/registry/index.js";

async function setupPlugins(app) {
  const registry = getRegistry({
    autoDiscover: true,
  });

  await registry.init(app);

  // Enable critical plugins
  await registry.enable("shell");
  await registry.enable("database");
  await registry.enable("rag");

  console.log("Plugins loaded:", registry.getStatus());
}
```

## Testing

### Run Tests

```bash
npm test src/core/registry/registry.test.js
```

### Test Coverage

- Plugin discovery
- Plugin loading
- Lifecycle (enable/disable/reload)
- Health checks
- Tool aggregation
- Registry queries

## Best Practices

1. **Always initialize registry** before using
2. **Check plugin existence** before operations
3. **Handle health check failures** gracefully
4. **Use capabilities** for feature detection
5. **Lazy load** plugins for better startup time
6. **Monitor health** in production

## Migration Guide

### Adding Registry to Existing Plugin

1. Ensure plugin exports `metadata` and `register`:
```javascript
export const metadata = createMetadata({...});
export function register(app) {...}
```

2. No other changes required - registry handles the rest

## Troubleshooting

### Plugin Not Found
- Check plugin is in `src/plugins/`
- Verify `index.js` exists
- Check plugin name matches directory

### Failed to Load
- Check `metadata` export
- Check `register` is a function
- Validate with `discoverPlugins()`

### Health Check Fails
- Implement `health()` export
- Return `{ status: "ok" }` for healthy
- Return `{ status: "failed", message: "..." }` for errors

## Related Documentation

- [Plugin Contract](../core/plugins/README.md)
- [Plugin Maturity Matrix](./plugin-maturity-matrix.md)
