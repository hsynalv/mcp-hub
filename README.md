# mcp-hub

> A plugin-based HTTP knowledge service for AI agents — starting with n8n.

**mcp-hub** gives AI agents structured, reliable access to the tools and platforms they need to take action. Instead of guessing node types, credential names, or API structures, the agent asks mcp-hub and gets ground truth back.

No LLM calls. No hallucinations. Just clean REST endpoints backed by real data.

---

## What it does

| Capability | Description |
|------------|-------------|
| Node catalog | 439+ n8n nodes with full schemas, properties, and credential requirements |
| Single-call context | One request returns node details + credentials + examples for the AI to build a workflow |
| Workflow validation | Static analysis of AI-generated workflow JSON before sending to n8n |
| Credential metadata | List of available credentials from n8n — id, name, type only (no secrets) |
| Workflow management | Read, search, create, and update n8n workflows |
| Extensible plugins | Drop a folder in `src/plugins/` — it auto-loads |

---

## Plugins

| Plugin | Endpoints | Description |
|--------|-----------|-------------|
| `n8n` | `/n8n/*` | Node catalog, context, validation, workflow apply |
| `n8n-credentials` | `/credentials/*` | Credential metadata from n8n |
| `n8n-workflows` | `/n8n/workflows/*` | Workflow list, detail, search |

> Planned: `openapi`, `github`, `notion`, `jira`, `linear`

---

## Quick Start

```bash
cd mcp-server
npm install
cp .env.example .env
# edit .env with your n8n URL and API key
npm run dev
```

Then seed the node catalog:

```bash
curl -X POST http://localhost:8787/n8n/catalog/refresh
```

---

## Project Structure

```
mcp-hub/
├── mcp-server/              # Main application
│   ├── src/
│   │   ├── core/            # Server bootstrap, plugin loader, config
│   │   └── plugins/
│   │       ├── n8n/         # Node catalog, context, validation, write
│   │       ├── n8n-credentials/  # Credential metadata
│   │       └── n8n-workflows/    # Workflow list & detail
│   ├── cache/               # Disk cache (gitignored)
│   ├── .env.example
│   ├── Dockerfile
│   ├── system_prompt.md     # AI Agent system prompt
│   └── README.md            # Full documentation
└── PLAN.md                  # Plugin roadmap
```

→ See [`mcp-server/README.md`](./mcp-server/README.md) for the full documentation.

---

## Using with n8n AI Agent

Add these tools to your n8n AI Agent node:

| Tool | Method | URL |
|------|--------|-----|
| `get_context` | POST | `http://host.docker.internal:8787/n8n/context` |
| `validate_workflow` | POST | `http://host.docker.internal:8787/n8n/workflow/validate` |
| `apply_workflow` | POST | `http://host.docker.internal:8787/n8n/workflow/apply` |
| `get_workflow` | GET | `http://host.docker.internal:8787/n8n/workflows/{id}` |

Copy the system prompt from [`mcp-server/system_prompt.md`](./mcp-server/system_prompt.md) into the AI Agent's System Message field.

**Result:** The agent builds complete, validated n8n workflows in 3 tool calls instead of 20.

---

## License

MIT
