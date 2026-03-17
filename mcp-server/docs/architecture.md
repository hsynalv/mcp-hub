# MCP-Hub Architecture

## Plugin Loading

The server uses a single plugin loading system: **`src/core/plugins.js`**.

### Plugin Loading Flow

```
Server startup (src/index.js)
    → createServer() (src/core/server.js)
    → loadPlugins(app)
```

### Lifecycle Stages

1. **Discovery** — `readdirSync(PLUGINS_DIR)` scans `src/plugins/*/` for plugin directories
2. **Validation** — `validatePluginMeta(pluginDir, dir)` validates `plugin.meta.json` and folder structure
3. **Load** — Dynamic `import(url)` of each plugin's `index.js`
4. **Register** — `plugin.register(app)` mounts Express routes
5. **Tool Registration** — For each `plugin.tools`, `registerTool({ ...tool, plugin })` adds MCP tools to the tool registry
6. **Cleanup** — Not used by default; plugins can export `cleanup` for graceful shutdown

### Plugin Contract

Each plugin must export:

- `name` (string) — plugin identifier
- `version` (string) — semver
- `register(app)` (function) — mounts Express routes and endpoints

Optional:

- `tools` — array of `{ name, description, inputSchema, handler, tags }` for MCP tools
- `description`, `capabilities`, `endpoints`, `requires`, `examples` — for manifest/API docs

### Validation

- **Metadata:** `plugin.meta.json` validated by `validatePluginMeta()` (from `plugin-meta.js`)
- **Structure:** `index.js` must exist
- **Contract:** `register` must be a function

### Configuration

Plugin toggles via env vars:

- `ENABLE_N8N_PLUGIN=false` — disable n8n plugin
- `ENABLE_N8N_CREDENTIALS=false` — disable n8n-credentials
- `ENABLE_N8N_WORKFLOWS=false` — disable n8n-workflows
- `PLUGIN_STRICT_MODE=true` — fail startup if any plugin fails to load

### Deprecated

- **`src/core/registry/`** — Alternative plugin registry not used during startup. Kept for backward compatibility with registry tests only.
- **`src/core/tools/tool.discovery.js`** — Uses deprecated registry. Observability uses `getToolStats()` from `tool-registry.js`.
- **`src/core/tools/tool.registry.js`** — Deprecated; MCP tools are in `tool-registry.js`.
