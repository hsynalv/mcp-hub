# mcp-hub

> A plugin-based HTTP knowledge service that gives AI agents structured access to external tools and platforms — starting with n8n.

**mcp-hub** acts as the "brain bridge" between an AI agent (running inside n8n, Cursor, or any LLM environment) and the services it needs to interact with. It exposes clean, fast REST endpoints so the AI can search node catalogs, fetch schemas, manage credentials, inspect workflows, and apply generated workflows — all without making LLM calls itself.

---

## Why mcp-hub?

When an AI agent builds an n8n workflow, it needs to:
- Know which nodes exist and what their parameters are
- Know which credentials are available
- Validate the workflow before sending it
- Apply the final result to n8n

Without a dedicated service, the agent has to guess — and gets it wrong. **mcp-hub provides ground truth.**

---

## Architecture

```
┌─────────────────────────────────────────┐
│              AI Agent (n8n)             │
│  - Calls mcp-hub tools via HTTP         │
│  - Receives structured JSON responses   │
└────────────────┬────────────────────────┘
                 │ HTTP
┌────────────────▼────────────────────────┐
│               mcp-hub                   │
│  Express · Plugin System · Disk Cache   │
│                                         │
│  ┌──────────┐ ┌────────────┐ ┌────────┐ │
│  │   n8n    │ │n8n-creds   │ │n8n-wf  │ │
│  │ plugin   │ │ plugin     │ │ plugin │ │
│  └──────────┘ └────────────┘ └────────┘ │
└─────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│              n8n Instance               │
│  - Workflow execution                   │
│  - Credential storage                   │
└─────────────────────────────────────────┘
```

**Key design principles:**
- No LLM calls — mcp-hub is a pure knowledge + action service
- Plugin-based — drop a folder in `src/plugins/`, it auto-loads
- Disk-cached — node catalog and credential lists are cached locally with configurable TTLs
- Fail-safe — missing credentials or unavailable n8n never crash the server

---

## Plugins

| Plugin | Prefix | Description |
|--------|--------|-------------|
| [n8n](./src/plugins/n8n/README.md) | `/n8n` | Node catalog, search, context, workflow validation & write |
| [n8n-credentials](./src/plugins/n8n-credentials/README.md) | `/credentials` | Credential metadata from n8n (no secrets) |
| [n8n-workflows](./src/plugins/n8n-workflows/README.md) | `/n8n/workflows` | Workflow list, detail, and search |

> More plugins planned: `openapi`, `github`, `notion`, `jira`, `linear`, `snippets`

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-username/mcp-hub.git
cd mcp-hub
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=8787
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=your_n8n_api_key
ALLOW_N8N_WRITE=false
```

### 3. Run

```bash
npm run dev     # development (auto-reload)
npm start       # production
```

### 4. Build node catalog

On first run, the node catalog is empty. Populate it:

```bash
curl -X POST http://localhost:8787/n8n/catalog/refresh
```

This reads directly from the installed `n8n-nodes-base` package — no n8n instance needed.

---

## Docker

```bash
docker build -t mcp-hub .
docker run -p 8787:8787 --env-file .env mcp-hub
```

### Docker Compose (with n8n)

```yaml
services:
  mcp-hub:
    build: .
    ports:
      - "8787:8787"
    env_file: .env
    volumes:
      - ./cache:/app/cache
    restart: unless-stopped

  n8n:
    image: n8nio/n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=password
    volumes:
      - n8n_data:/home/node/.n8n
    restart: unless-stopped

volumes:
  n8n_data:
```

When n8n runs in Docker, reach mcp-hub at:
```
http://host.docker.internal:8787
```

---

## API Overview

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/plugins` | List all loaded plugins |

### n8n Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/n8n/context` | **Main AI tool** — node schemas + credentials + examples in one call |
| `GET` | `/n8n/nodes/search` | Search node catalog |
| `GET` | `/n8n/nodes/:type` | Get full node schema |
| `GET` | `/n8n/examples` | Workflow examples |
| `POST` | `/n8n/workflow/validate` | Validate workflow JSON |
| `POST` | `/n8n/workflow/apply` | Create or update workflow in n8n |
| `GET` | `/n8n/catalog/status` | Catalog cache status |
| `POST` | `/n8n/catalog/refresh` | Rebuild node catalog |

### Credentials Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/credentials` | List all credentials (metadata only) |
| `GET` | `/credentials/:type` | Filter credentials by type |
| `POST` | `/credentials/refresh` | Refresh from n8n |

### Workflows Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/n8n/workflows` | List all workflows |
| `GET` | `/n8n/workflows/:id` | Get workflow JSON |
| `POST` | `/n8n/workflows/search` | Search workflows by name or node type |

---

## Using with n8n AI Agent

### Tool Configuration

Add these HTTP Request Tools to your n8n AI Agent node:

| Tool Name | Method | URL |
|-----------|--------|-----|
| `get_context` | POST | `http://host.docker.internal:8787/n8n/context` |
| `validate_workflow` | POST | `http://host.docker.internal:8787/n8n/workflow/validate` |
| `apply_workflow` | POST | `http://host.docker.internal:8787/n8n/workflow/apply` |
| `get_workflow` | GET | `http://host.docker.internal:8787/n8n/workflows/{id}` |

See [`system_prompt.md`](./system_prompt.md) for the AI Agent system prompt that minimizes tool call iterations.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Server port |
| `N8N_BASE_URL` | `http://n8n:5678` | n8n instance URL |
| `N8N_API_BASE` | `/api/v1` | n8n REST API base path |
| `N8N_API_KEY` | — | n8n API key (required for write ops) |
| `ALLOW_N8N_WRITE` | `false` | Enable workflow create/update endpoints |
| `CATALOG_CACHE_DIR` | `./cache` | Directory for disk cache files |
| `CATALOG_TTL_HOURS` | `24` | Node catalog cache TTL |
| `CREDENTIALS_TTL_MINUTES` | `60` | Credentials cache TTL |
| `WORKFLOWS_TTL_MINUTES` | `10` | Workflows cache TTL |

---

## Plugin Development

Each plugin is a folder in `src/plugins/` that exports:

```javascript
// src/plugins/my-plugin/index.js
export const name = "my-plugin";
export const version = "1.0.0";

export function register(app) {
  app.get("/my-plugin/hello", (req, res) => {
    res.json({ ok: true, message: "Hello from my plugin" });
  });
}
```

The plugin loader discovers and mounts it automatically on server start.

---

## License

MIT
