# mcp-hub

> A plugin-based HTTP service for AI agents with REST APIs and MCP (Model Context Protocol) support.
> 
> **Phase 4: AI Enhancement** — Tech detection, multi-LLM routing, code review, image/video generation
> 
> **Developer Tools** — CLI, hot reload, debug mode, plugin generator

📐 **[Architecture Documentation (ARCHITECTURE.md)](./ARCHITECTURE.md)** — Diagrams, plugin structure, data flow

**mcp-hub** bridges the gap between AI agents (n8n, Cursor, Claude Desktop, or any LLM environment) and external services. It exposes clean REST endpoints **and** MCP tools so the AI can analyze GitHub repos, manage Notion projects, run tests, index documents for RAG, orchestrate tasks, detect tech stacks, route to specialized LLMs, review code, generate images/videos — with consistent authentication, caching, policy enforcement, and resilience patterns.

---

## Features

- **Dual Interface**: REST API + MCP Tools
- **Tool Registry**: Tagged tools with policy enforcement (`READ`, `WRITE`, `NETWORK`, etc.)
- **MCP Transport**: Stdio and Streamable HTTP endpoints
- **Policy Engine**: Approval workflows, rate limiting, dry-run mode
- **Job Queue**: Async task execution with status tracking
- **Plugin System**: Auto-discovery and loading
- **Resilience Patterns**: Retry with exponential backoff, circuit breaker
- **Observability**: Prometheus metrics, structured JSON logging, health checks
- **AI Enhancement**: Tech detection, multi-LLM routing, code review, image/video generation
- **Developer Tools**: CLI, hot reload, debug mode, plugin generator

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent / LLM Client                     │
│         - Claude Desktop, Cursor, n8n, custom apps          │
├─────────────────────────────────────────────────────────────┤
│  MCP Protocol                    REST API                   │
│  - tools/list                     - /github/analyze        │
│  - tools/call                     - /notion/setup-project  │
└────────────────┬────────────────────────────┬─────────────────┘
                 │                          │
┌────────────────▼────────────┐  ┌──────────▼─────────────────┐
│      MCP Gateway            │  │    Express REST Server     │
│   - Tool registry           │  │  - Plugin routes            │
│   - Policy checks           │  │  - Auth middleware          │
│   - Stdio transport         │  │  - Validation               │
└────────────────┬────────────┘  └──────────┬─────────────────┘
                 └──────────────┬─────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│                      Plugin System                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ github  │ │ notion  │ │  git    │ │  tests  │ │ brain │ │
│  ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├───────┤ │
│  │ analyze │ │ project │ │ commit  │ │   run   │ │ skills│ │
│  │   PRs   │ │  tasks  │ │  push   │ │  lint   │ │  chat │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │   rag   │ │workspace│ │ policy  │ │  jobs   │ │  n8n  │ │
│  ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├───────┤ │
│  │  index  │ │  files  │ │  rules  │ │  queue  │ │nodes  │ │
│  │ search  │ │  tree   │ │approve  │ │ status  │ │workflows│ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │
└─────────────────────────────────────────────────────────────┘
```

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
│  ┌────────────┐ ┌──────────┐ ┌────────────┐ │
│  │file-storage│ │ database │ │   notion   │ │
│  └────────────┘ └──────────┘ └────────────┘ │
└─────────────────────────────────────────────┘
```

**Key design principles:**
- No LLM calls — mcp-hub is a pure knowledge + action service
- Plugin-based — drop a folder in `src/plugins/`, it auto-loads
- Disk-cached — node catalog and credential lists are cached locally with configurable TTLs
- Fail-safe — missing credentials or unavailable services never crash the server

---

## Plugins

### Core Plugins

| Plugin | Prefix | Description |
|--------|--------|-------------|
| [github](./src/plugins/github/README.md) | `/github` | Repos, PRs, branches, analysis |
| [notion](./src/plugins/notion/README.md) | `/notion` | Pages, databases, tasks, templates |
| [git](./src/plugins/git/README.md) | `/git` | Repository operations |
| [tests](./src/plugins/tests/README.md) | `/tests` | Test runner (Vitest, Jest, Mocha) |
| [brain](./src/plugins/brain/README.md) | `/brain` | LLM skills, chat, planning |
| [rag](./src/plugins/rag/README.md) | `/rag` | Document indexing, semantic search |
| [workspace](./src/plugins/workspace/README.md) | `/workspace` | File operations |
| [policy](./src/plugins/policy/README.md) | `/policy` | Approval rules, rate limits |
| [tech-detector](./src/plugins/tech-detector/README.md) | `/tech` | **NEW:** Auto-detect project technologies |
| [llm-router](./src/plugins/llm-router/README.md) | `/llm` | **NEW:** Multi-LLM task routing |
| [code-review](./src/plugins/code-review/README.md) | `/code-review` | **NEW:** Automated PR reviews |
| [image-gen](./src/plugins/image-gen/README.md) | `/image` | **NEW:** AI image generation (DALL-E, Stability) |
| [video-gen](./src/plugins/video-gen/README.md) | `/video` | **NEW:** AI video generation (Runway, Pika) |

### Integration Plugins

| Plugin | Prefix | Description |
|--------|--------|-------------|
| [n8n](./src/plugins/n8n/README.md) | `/n8n` | Node catalog, workflows |
| [n8n-credentials](./src/plugins/n8n-credentials/README.md) | `/credentials` | Credential metadata |
| [n8n-workflows](./src/plugins/n8n-workflows/README.md) | `/n8n/workflows` | Workflow management |
| [database](./src/plugins/database/README.md) | `/database` | SQL/NoSQL queries |
| [file-storage](./src/plugins/file-storage/README.md) | `/file-storage` | S3, GCS, local files |
| [slack](./src/plugins/slack/README.md) | `/slack` | Slack integration |

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
| `GET` | `/github/analyze?repo=owner/repo` | Full repo snapshot |
| `POST` | `/github/pulls` | Create PR |
| `GET` | `/github/pulls?repo=owner/repo` | List PRs |
| `POST` | `/github/branches` | Create branch |

### Notion Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/notion/setup-project` | Create project + tasks |
| `POST` | `/notion/templates/apply` | Apply template |
| `POST` | `/notion/templates/pages` | Create from template |

### Git Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/git/status` | Repository status |
| `POST` | `/git/commit` | Commit changes |
| `POST` | `/git/push` | Push to remote |
| `POST` | `/git/branches` | Create branch |

### Brain Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/brain/skills/:name/invoke` | Invoke skill |
| `POST` | `/brain/chat` | Chat with context |
| `POST` | `/brain/planner` | Create plan |

### RAG Plugin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/rag/index` | Index document |
| `POST` | `/rag/search` | Semantic search |
| `GET` | `/rag/stats` | Index statistics |

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

→ See [`docs/integrations/`](./docs/integrations/) for AI agent integration guides.
→ See [`docs/use-cases/`](./docs/use-cases.md) for real-world examples.
→ See [`docs/plugin-development.md`](./docs/plugin-development.md) for building custom plugins.

---

## MCP Usage

### Claude Desktop Config

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

### Available MCP Tools

| Tool | Plugin | Description |
|------|--------|-------------|
| `github_analyze_repo` | github | Analyze repository |
| `github_create_pr` | github | Create pull request |
| `notion_apply_template` | notion | Apply page template |
| `notion_create_task` | notion | Create task in database |
| `git_commit` | git | Commit changes |
| `git_push` | git | Push to remote |
| `tests_run` | tests | Run test suite |
| `brain_invoke_skill` | brain | Use AI skills |
| `brain_chat` | brain | Conversational AI |
| `rag_search` | rag | Semantic search |
| `workspace_read_file` | workspace | Read project files |
| `policy_evaluate` | policy | Check policy rules |

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
| `NOTION_TASKS_DB_ID` | — | Notion database ID for tasks |
| `WORKSPACE_PATH` | — | File storage root |
| `OPENAI_API_KEY` | — | For brain plugin |
| `HUB_ADMIN_KEY` | — | Admin scope for policy |

---

## Plugin Development

Each plugin exports REST routes and MCP tools:

```javascript
// src/plugins/my-plugin/index.js
import { ToolTags } from "../../core/tool-registry.js";

export const name = "my-plugin";
export const version = "1.0.0";
export const description = "...";
export const endpoints = [...];
export const examples = [...];

// REST routes
export function register(app) {
  app.get("/my-plugin/hello", handler);
}

// MCP tools
export const tools = [
  {
    name: "my_tool",
    description: "...",
    tags: [ToolTags.READ],
    inputSchema: { ... },
    handler: async (args) => { ... }
  }
];
```

## Tool Tags

| Tag | Description |
|-----|-------------|
| `READ` | Read-only operations |
| `WRITE` | Modifies state |
| `NETWORK` | Makes HTTP requests |
| `EXTERNAL_API` | Calls external services |
| `GIT` | Git operations |
| `LOCAL_FS` | Local file system |
| `BULK` | Batch operations |

---

## License

MIT
