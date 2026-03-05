# MCP Client Configuration Examples

This directory contains example configurations for connecting MCP clients to MCP Hub.

## Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "mcp-hub-local": {
      "command": "npx",
      "args": ["mcp-hub-stdio", "--api-key", "your-api-key", "--scope", "write"],
      "env": {
        "HUB_PROJECT_ID": "my-project",
        "HUB_ENV": "development"
      }
    }
  }
}
```

## Cursor

Add to your Cursor settings (`.cursor/mcp.json` in your project or user settings):

```json
{
  "mcpServers": [
    {
      "name": "mcp-hub",
      "type": "command",
      "command": "npx mcp-hub-stdio --api-key your-api-key --scope write"
    }
  ]
}
```

## HTTP Transport (for custom clients)

```javascript
// Connect to HTTP endpoint
const response = await fetch('http://localhost:8787/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-key',
    'X-Project-Id': 'my-project',
    'X-Env': 'development'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  })
});

const tools = await response.json();
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HUB_API_KEY` | API key for authentication | - |
| `HUB_SCOPE` | Default scope (read/write/admin) | read |
| `HUB_PROJECT_ID` | Project ID for context | - |
| `HUB_ENV` | Environment (development/staging/production) | development |
| `HUB_AUTH_ENABLED` | Enable authentication | false |
| `GITHUB_TOKEN` | GitHub personal access token | - |
| `NOTION_TOKEN` | Notion integration token | - |
| `SLACK_BOT_TOKEN` | Slack bot token | - |

## Testing the Connection

```bash
# List available tools
npx mcp-hub-stdio --help

# Start with specific scope
npx mcp-hub-stdio --api-key secret123 --scope write --project-id myproj
```
