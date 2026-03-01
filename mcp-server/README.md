# mcp-hub

> A plugin-based HTTP knowledge service that gives AI agents structured access to external tools and platforms.

**mcp-hub** bridges the gap between an AI agent (running inside n8n, Cursor, or any LLM environment) and the services it needs. It exposes clean REST endpoints so the AI can search node catalogs, manage credentials, inspect workflows, analyze GitHub repos, and document everything in Notion — all without making LLM calls itself.

---

## Why mcp-hub?

When an AI agent builds an n8n workflow or plans a project, it needs reliable, structured information:
- Which n8n nodes exist and what their parameters are
- Which credentials are available (without exposing secrets)
- The current state of a GitHub repository
- Where to create project plans and tasks in Notion

Without a dedicated service, the agent has to guess — and gets it wrong. **mcp-hub provides ground truth.**

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           AI Agent (n8n / Cursor)           │
│  - Calls mcp-hub tools via HTTP             │
│  - Receives structured JSON responses       │
└────────────────┬────────────────────────────┘
                 │ HTTP
┌────────────────▼────────────────────────────┐
│                 mcp-hub                     │
│    Express · Plugin System · Disk Cache     │
│                                             │
│  ┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ n8n  │ │n8n-    │ │n8n-    │ │ github │  │
│  │      │ │creds   │ │workfl. │ │        │  │
│  └──────┘ └────────┘ └────────┘ └────────┘  │
│                           ┌────────────────┐ │
│                           │     notion     │ │
│                           └────────────────┘ │
└─────────────────────────────────────────────┘
```

**Key design principles:**
- No LLM calls — mcp-hub is a pure knowledge + action service
- Plugin-based — drop a folder in `src/plugins/`, it auto-loads
- Disk-cached — node catalog and credential lists are cached locally with configurable TTLs
- Fail-safe — missing credentials or unavailable services never crash the server

---

## Plugins

| Plugin | Prefix | Description |
|--------|--------|-------------|
| [n8n](./src/plugins/n8n/README.md) | `/n8n` | Node catalog, search, context, workflow validation & write |
| [n8n-credentials](./src/plugins/n8n-credentials/README.md) | `/credentials` | Credential metadata from n8n (no secrets) |
| [n8n-workflows](./src/plugins/n8n-workflows/README.md) | `/n8n/workflows` | Workflow list, detail, and search |
| [github](./src/plugins/github/README.md) | `/github` | Read access to public and private GitHub repos |
| [notion](./src/plugins/notion/README.md) | `/notion` | Create and manage pages, databases, and tasks in Notion |

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/hsynalv/mcp-hub.git
cd mcp-hub/mcp-server
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=8787

# n8n
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=your_n8n_api_key
ALLOW_N8N_WRITE=true

# GitHub (required for private repos)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Notion
NOTION_API_KEY=secret_xxxxxxxxxxxxxxxxxxxx
NOTION_ROOT_PAGE_ID=your_root_page_id
NOTION_PROJECTS_DB_ID=your_projects_database_id
NOTION_TASKS_DB_ID=your_tasks_database_id
```

### 3. Run

```bash
npm run dev     # development (auto-reload)
npm start       # production
```

### 4. Build node catalog

On first run, populate the n8n node catalog:

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
| `POST` | `/n8n/context` | **Primary AI tool** — node schemas + credentials + examples in one call |
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
| `GET` | `/credentials` | List all credentials (metadata only, no secrets) |
| `GET` | `/credentials/:type` | Filter credentials by type |
| `POST` | `/credentials/refresh` | Refresh from n8n |

### Workflows Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/n8n/workflows` | List all workflows |
| `GET` | `/n8n/workflows/:id` | Get workflow JSON |
| `POST` | `/n8n/workflows/search` | Search workflows by name or node type |

### GitHub Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/github/repos` | List authenticated user's repos (public + private) |
| `GET` | `/github/users/:username/repos` | List public repos for any user/org |
| `GET` | `/github/analyze?repo=owner/repo` | **Primary AI tool** — full repo snapshot in one call |
| `GET` | `/github/repo/:owner/:repo` | Repo metadata only |
| `GET` | `/github/repo/:owner/:repo/tree` | File tree |
| `GET` | `/github/repo/:owner/:repo/file` | File content |
| `GET` | `/github/repo/:owner/:repo/commits` | Recent commits |
| `GET` | `/github/repo/:owner/:repo/issues` | Open issues and PRs |

### Notion Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notion/search` | Search pages and databases by keyword |
| `GET` | `/notion/sections` | List all pages and databases (for discovery) |
| `POST` | `/notion/setup-project` | **Primary AI tool** — create project + all tasks in one call |
| `POST` | `/notion/row` | Add a row to any Notion database |
| `GET` | `/notion/projects` | List projects from Projeler database |
| `POST` | `/notion/projects` | Create a project in Projeler database |
| `GET` | `/notion/tasks` | List tasks from Yapılacaklar database |
| `POST` | `/notion/tasks` | Create a task in Yapılacaklar database |
| `POST` | `/notion/pages` | Create a page |
| `PATCH` | `/notion/pages/:id/append` | Append blocks to a page |
| `GET` | `/notion/pages/:id/blocks` | Get page content |
| `POST` | `/notion/databases/:id/rows` | Add a row to a specific database |
| `PATCH` | `/notion/databases/rows/:rowId` | Update a row |

---

## n8n AI Agent Setup (Project Planner)

Import `project-planner-workflow.json` into n8n. It configures a **Tools Agent** with the following HTTP Request Tools:

| Tool | Method | Endpoint | Purpose |
|------|--------|----------|---------|
| `list_repos` | GET | `/github/repos` | List all repos (public + private) without entering username |
| `analyze_repo` | GET | `/github/analyze?repo=…` | Deep-analyze a specific repo |
| `get_projects` | GET | `/notion/projects` | Check for duplicate projects |
| `setup_project` | POST | `/notion/setup-project` | Create project + all tasks in Notion in one call |
| `get_tasks` | GET | `/notion/tasks` | List tasks |
| `notion_search` | GET | `/notion/search` | Find pages/databases by keyword |
| `notion_add_row` | POST | `/notion/row` | Add a row to any Notion database |

See [`system_prompt.md`](./system_prompt.md) for the AI Agent system prompt.

### Typical Agent Flow — Existing GitHub Project

```
1. list_repos              → show the user their repos
2. analyze_repo            → deep-analyze the chosen repo
3. get_projects            → check for existing entry in Notion
4. setup_project           → create project + tasks in Notion (one call)
```

### Typical Agent Flow — New Project

```
1. get_projects            → check for duplicate
2. setup_project           → create project + tasks in Notion (one call)
```

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
| `GITHUB_TOKEN` | — | GitHub personal access token (required for private repos) |
| `NOTION_API_KEY` | — | Notion internal integration secret |
| `NOTION_ROOT_PAGE_ID` | — | Default parent page for new pages |
| `NOTION_PROJECTS_DB_ID` | — | Notion database ID for projects (Projeler) |
| `NOTION_TASKS_DB_ID` | — | Notion database ID for tasks (Yapılacaklar) |

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
