# MCP Client Config

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-hub": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/mcp/stdio-bridge.js"],
      "env": {
        "MCP_SERVER_URL": "http://localhost:8787"
      }
    }
  }
}
```

## Cursor

Cursor Settings → Tools → Add New Tool:

- **Name**: mcp-hub
- **Command**: `node /path/to/mcp-server/src/mcp/stdio-bridge.js`
- **Env**: `MCP_SERVER_URL=http://localhost:8787`

## Custom LLM

HTTP transport kullanın:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

## Stdio Bridge

Stdio transport için:

```bash
node src/mcp/stdio-bridge.js
```

Environment variables:
- `MCP_SERVER_URL` - HTTP server URL
- `MCP_LOG_LEVEL` - debug, info, warn, error
- `HUB_WORKSPACE_ID` - Workspace for tool execution (see [mcp-context.md](mcp-context.md))
- `HUB_PROJECT_ID` - Project identifier
