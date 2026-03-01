# n8n MCP Server

HTTP-only MCP service for n8n. Provides **node catalog** and **workflow examples** to help AI create workflows inside n8n. Optionally creates/updates workflows when `ALLOW_N8N_WRITE=true`.

**HARD RULES:**
- No LLM calls — AI runs inside n8n (n8n AI node/workflow)
- MCP is a "knowledge + optional apply" service

## Quick Start

```bash
npm install
npm start
```

Server runs at `http://localhost:3100` (or `PORT` env).

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tools` | List all tools |
| POST | `/tools/call` | Call a tool `{ "name": "...", "arguments": {} }` |
| GET | `/resources` | List all resources |
| GET | `/resources/read?uri=...` | Read resource content |
| GET | `/health` | Health check |

## Tools (V1 - Always Available)

| Tool | Description |
|------|-------------|
| `n8n_get_node_catalog` | Full node catalog, optional `category` filter |
| `n8n_get_node_info` | Detailed info for a node type |
| `n8n_get_examples` | Workflow examples, optional `exampleId` |

## Tools (Optional - When ALLOW_N8N_WRITE=true)

| Tool | Description |
|------|-------------|
| `n8n_create_workflow` | Create workflow in n8n |
| `n8n_update_workflow` | Update existing workflow |

## Resources

| URI | Description |
|-----|-------------|
| `n8n://catalog` | Full node catalog JSON |
| `n8n://examples` | Workflow examples list |
| `n8n://examples/{id}` | Specific example (e.g. `webhook-to-set`) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `ALLOW_N8N_WRITE` | false | Enable workflow create/update |
| `N8N_BASE_URL` | http://localhost:5678 | n8n instance URL |
| `N8N_API_KEY` | - | n8n API key (required for write) |

## Architecture

- **Plugin-based**: n8n plugin first, extensible for future plugins
- **ESM**: Node.js ES modules
- **Express**: HTTP only, no stdio MCP

## Example: Call Tool from n8n

```json
POST /tools/call
{
  "name": "n8n_get_node_catalog",
  "arguments": { "category": "trigger" }
}
```

```json
POST /tools/call
{
  "name": "n8n_get_examples",
  "arguments": { "exampleId": "webhook-to-set" }
}
```
