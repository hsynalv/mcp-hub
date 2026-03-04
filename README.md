# mcp-hub

> A plugin-based HTTP knowledge service for AI agents — n8n, GitHub, Notion and more.

**mcp-hub** bridges AI agents (running inside n8n, Cursor, or any LLM environment) with the tools and platforms they need. Instead of guessing node parameters, credential names, or API structures, the agent asks mcp-hub and gets ground truth back.

No LLM calls. No hallucinations. Just clean REST endpoints backed by real data.

---

## What it does

| Capability | Description |
|------------|-------------|
| n8n node catalog | 439+ nodes with full schemas, properties, and credential requirements |
| Single-call context | One request returns node details + credentials + examples for workflow generation |
| Workflow validation | Static analysis of AI-generated workflow JSON before applying to n8n |
| Credential metadata | Available credentials from n8n — id, name, type only (no secrets) |
| Workflow management | Read, search, create, and update n8n workflows |
| GitHub integration | List and analyze public + private repos via token |
| Notion integration | Create projects, tasks, pages, and rows in any database |
| Extensible plugins | Drop a folder in `src/plugins/` — it auto-loads |

---

## Plugins

| Plugin | Endpoints | Description |
|--------|-----------|-------------|
| `n8n` | `/n8n/*` | Node catalog, context, validation, workflow apply |
| `n8n-credentials` | `/credentials/*` | Credential metadata from n8n (no secrets) |
| `n8n-workflows` | `/n8n/workflows/*` | Workflow list, detail, search |
| `github` | `/github/*` | Read access to public and private GitHub repos |
| `notion` | `/notion/*` | Pages, databases, projects and tasks in Notion |

---

## Quick Start

```bash
cd mcp-server
npm install
cp .env.example .env
# edit .env with your API keys
npm run dev
```

Then seed the n8n node catalog:

```bash
curl -X POST http://localhost:8787/n8n/catalog/refresh
```

---

## Project Structure

```
mcp-hub/
├── mcp-server/                   # Tek uygulama (port 8787)
│   ├── src/
│   │   ├── core/                 # Server, plugin loader, auth, audit
│   │   └── plugins/
│   │       ├── n8n/              # Node catalog, context, validation, write
│   │       ├── n8n-credentials/  # Credential metadata
│   │       ├── n8n-workflows/    # Workflow list & detail
│   │       ├── github/           # GitHub repo analysis
│   │       ├── notion/           # Notion pages, databases, tasks
│   │       ├── http/             # Kontrollü HTTP istekleri
│   │       ├── openapi/          # OpenAPI spec, kod üretimi
│   │       └── ...
│   ├── cache/                    # Disk cache (gitignored)
│   ├── .env.example
│   ├── Dockerfile
│   ├── project-planner-workflow.json
│   ├── system_prompt.md
│   ├── ARCHITECTURE.md           # Mimari dokümantasyonu
│   └── README.md
└── PLAN.md                       # Plugin roadmap
```

→ See [`mcp-server/README.md`](./mcp-server/README.md) for the full documentation.

---

## n8n AI Agent Tools

Import `mcp-server/project-planner-workflow.json` into n8n for a pre-configured **Project Planner** agent with these tools:

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `list_repos` | `GET /github/repos` | List all repos (public + private) |
| `analyze_repo` | `GET /github/analyze?repo=…` | Deep-analyze a GitHub repo |
| `get_projects` | `GET /notion/projects` | List Notion projects |
| `setup_project` | `POST /notion/setup-project` | Create project + tasks in one call |
| `get_tasks` | `GET /notion/tasks` | List Notion tasks |
| `notion_search` | `GET /notion/search` | Find pages/databases |
| `notion_add_row` | `POST /notion/row` | Add a row to any Notion database |

**Typical flow:**
```
list_repos → user picks → analyze_repo → setup_project → Notion URL
```

For n8n workflow building, see [`system_prompt.md`](./mcp-server/system_prompt.md).

---

## License

MIT
