# Legacy Plugin/Tool Loading

**Deprecated.** This folder contains the previous plugin registry and tool discovery system. It is not used during server startup.

## Canonical Runtime Path

- **Plugin loading:** `src/core/plugins.js` — used by `createServer()` in `server.js`
- **Tool registry:** `src/core/tool-registry.js` — MCP tools, `registerTool`, `callTool`, `getToolStats`

## Contents

| Path | Purpose |
|------|---------|
| `legacy/registry/` | PluginRegistry, plugin discovery, lifecycle — replaced by plugins.js |
| `legacy/tools/` | Tool discovery from registry, ToolRegistry class — replaced by tool-registry.js |

## Tests

- `legacy/registry/registry.test.js` — PluginRegistry, discovery, loader
- `legacy/tools/tools.test.js` — Tool schema, validation, presenter, ToolRegistry

These tests verify legacy behavior. The runtime does not depend on this code.
