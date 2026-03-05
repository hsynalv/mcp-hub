# Claude Desktop MCP Config

> Add MCP Hub to Claude Desktop for AI-powered project orchestration

---

## Quick Setup

### 1. Find the path

```bash
# Get absolute path to the stdio script
cd /Users/beyazskorsky/Documents/mcp/mcp-server
pwd
# Output: /Users/beyazskorsky/Documents/mcp/mcp-server
```

### 2. Edit Claude Desktop Config

**macOS:**
```bash
# Open config
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows:**
```bash
# Config location:
# %APPDATA%\Claude\claude_desktop_config.json
```

### 3. Add MCP Hub

```json
{
  "mcpServers": {
    "mcp-hub": {
      "command": "node",
      "args": [
        "/Users/beyazskorsky/Documents/mcp/mcp-server/bin/mcp-hub-stdio.js"
      ],
      "env": {
        "OPENAI_API_KEY": "sk-your-openai-key",
        "GITHUB_TOKEN": "ghp-your-github-token",
        "NOTION_API_KEY": "secret-your-notion-key",
        "REDIS_URL": "redis://localhost:6379",
        "HUB_SCOPE": "write"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

Kill Claude and reopen. You should see MCP tools available.

---

## Available Tools

Once connected, Claude can use these tools:

| Tool | Description |
|------|-------------|
| `github_analyze_patterns` | Analyze your GitHub repos for coding patterns |
| `github_get_architecture_options` | Generate architecture options |
| `project_create_draft` | Start interactive project planning |
| `project_select_architecture` | Choose architecture approach |
| `project_execute_plan` | Execute approved plan |
| `project_execute_next` | Execute next pending task |
| `notion_create_project` | Create project in Notion |
| `notion_create_task` | Create task in Notion |
| `workspace_create_file` | Create file in workspace |
| `git_commit` | Commit changes |

---

## Test Conversation

After setup, try this in Claude Desktop:

**You:** "Build a URL shortener service"

**Claude:** *(uses tools)*
1. `github_analyze_patterns` - learns your style
2. `github_get_architecture_options` - suggests architectures
3. Presents options: "I see you use Express + BullMQ in api-gateway..."
4. `project_create_draft` - starts planning
5. Shows you the plan: "Faz 1: Setup, Faz 2: Core..."
6. After approval: `project_execute_plan` - creates Notion + code

---

## Troubleshooting

### "command not found: node"

Use full path to node:
```json
{
  "command": "/usr/local/bin/node",
  "args": ["..."]
}
```

### "Cannot find module"

Check path is absolute:
```bash
cd /Users/beyazskorsky/Documents/mcp/mcp-server/bin
ls mcp-hub-stdio.js
# Should exist
```

### "Connection refused" for Redis

Start Redis:
```bash
brew services start redis
# or
redis-server
```

### Claude doesn't see tools

Check logs:
```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp*.log
```

---

## Advanced: Multiple Projects

```json
{
  "mcpServers": {
    "mcp-hub-personal": {
      "command": "node",
      "args": ["/Users/beyazskorsky/Documents/mcp/mcp-server/bin/mcp-hub-stdio.js"],
      "env": {
        "HUB_PROJECT_ID": "personal",
        "WORKSPACE_PATH": "/Users/beyazskorsky/workspace/personal",
        "OPENAI_API_KEY": "..."
      }
    },
    "mcp-hub-work": {
      "command": "node",
      "args": ["/Users/beyazskorsky/Documents/mcp/mcp-server/bin/mcp-hub-stdio.js"],
      "env": {
        "HUB_PROJECT_ID": "work",
        "WORKSPACE_PATH": "/Users/beyazskorsky/workspace/work",
        "OPENAI_API_KEY": "..."
      }
    }
  }
}
```

---

## Ready?

1. Add config
2. Restart Claude
3. Say: "Build a todo app with my preferred stack"

🚀
