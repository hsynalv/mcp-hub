# Minimal Local Setup

The smallest configuration to run MCP-Hub locally for development or testing.

## Requirements

- Node.js >= 18
- npm >= 9

## Setup

```bash
cd mcp-server
npm install
cp .env.example .env
```

## Minimal .env

For local development without external services, use this minimal configuration:

```env
# Server
PORT=8787
NODE_ENV=development

# Auth — leave blank for open mode (no auth required)
# Set values to enable API key authentication
HUB_READ_KEY=
HUB_WRITE_KEY=
HUB_ADMIN_KEY=

# Optional: disable plugins you don't need
ENABLE_N8N_PLUGIN=false
ENABLE_N8N_CREDENTIALS=false
ENABLE_N8N_WORKFLOWS=false
```

## Run

```bash
npm run dev
```

## Verify

```bash
# Health check
curl http://localhost:8787/health

# List plugins (no auth needed in open mode)
curl http://localhost:8787/plugins
```

## What Works Without API Keys

- Core endpoints: `/health`, `/plugins`, `/whoami`
- Shell plugin (with allowlist)
- RAG plugin (keyword fallback without OpenAI)
- HTTP plugin (read-only methods)
- Workspace plugin (local file ops)
- Git plugin (local repos)

## Adding Integrations

| Integration | Env Variable | Purpose |
|-------------|--------------|---------|
| OpenAI | `OPENAI_API_KEY` | RAG embeddings, LLM routing |
| Notion | `NOTION_API_KEY` | Notion plugin |
| GitHub | `GITHUB_TOKEN` | GitHub plugin |
| n8n | `N8N_API_KEY` | n8n workflows |

See [Environment Variables](../mcp-server/docs/environment-variables.md) for the full list.
