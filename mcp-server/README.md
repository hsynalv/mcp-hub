# mcp-server

**n8n knowledge service for AI inside n8n.**

Provides node catalog, workflow examples, and schema information so the AI running inside an n8n workflow can generate and validate n8n workflows correctly.

> **No LLM calls.** This server is pure knowledge + optional apply.  
> The AI lives in n8n (AI Agent node). This server is what it calls.

---

## Quick start

```bash
cp .env.example .env   # edit N8N_BASE_URL at minimum
npm install
npm run dev            # watch mode, restarts on changes
```

Server starts at `http://localhost:8787` (override with `PORT=`).

---

## Docker Compose

```yaml
services:
  n8n:
    image: n8nio/n8n
    ports: ["5678:5678"]
    environment:
      - N8N_API_KEY=your-key   # enable if you want write access

  mcp-server:
    build: .
    ports: ["8787:8787"]
    environment:
      - N8N_BASE_URL=http://n8n:5678
      - N8N_API_BASE=/api/v1
      - N8N_API_KEY=your-key
      - ALLOW_N8N_WRITE=false      # set true to allow workflow create/update
      - CATALOG_CACHE_DIR=/data/cache
      - CATALOG_TTL_HOURS=24
    volumes:
      - mcp_cache:/data/cache
    depends_on: [n8n]

volumes:
  mcp_cache:
```

---

## How to use from n8n

All calls use the **HTTP Request** node. Set `Base URL` to `http://mcp-server:8787` (or whatever your instance address is).

### 1. Search for nodes

```
GET /n8n/nodes/search?q=slack&group=action&limit=10
```

Returns an array of `NodeSummary` objects the AI can use to pick the right node type.

```json
[
  {
    "type": "n8n-nodes-base.slack",
    "displayName": "Slack",
    "group": ["output"],
    "description": "Sends data to Slack",
    "credentialsRequired": true
  }
]
```

### 2. Get a node's full schema

```
GET /n8n/nodes/n8n-nodes-base.httpRequest
```

Returns the node summary plus trimmed `properties` (name, type, required, default, options) and `credentials` when available.

```json
{
  "ok": true,
  "node": {
    "type": "n8n-nodes-base.httpRequest",
    "properties": [
      { "name": "method", "type": "options", "default": "GET", "options": [...] },
      { "name": "url",    "type": "string",  "required": true }
    ]
  }
}
```

### 3. Get workflow examples

```
GET /n8n/examples
```

Lists all intent names and descriptions.

```
GET /n8n/examples?intent=webhook_to_slack
```

Returns a ready-to-adapt workflow plan with `nodes`, `connections`, and `notes`.

Available intents: `cron_http_post`, `webhook_to_slack`, `webhook_set_respond`,  
`if_branch`, `merge_branches`, `telegram_send_message`, `code_transform`.

### 4. Validate an AI-generated workflow

```
POST /n8n/workflow/validate
Content-Type: application/json

{ "workflowJson": { ...the workflow the AI generated... } }
```

Returns errors (hard problems) and warnings (soft issues) without touching n8n.

```json
{ "ok": true,  "warnings": [...] }
{ "ok": false, "errors":   [...] }
```

Each item has `{ code, path, message }` so the AI knows exactly what to fix.

### 5. Apply a workflow (write, optional)

Requires `ALLOW_N8N_WRITE=true` and `N8N_API_KEY` set in environment.

```
POST /n8n/workflow/apply
Content-Type: application/json

{
  "workflowJson": { ...validated workflow... },
  "mode": "create"
}
```

`mode` can be:
- `"create"` — always POST a new workflow (id stripped if present)
- `"update"` — PATCH an existing workflow (requires `workflowJson.id`)
- `"upsert"` — PATCH if id present, fall back to POST on 404

Returns `{ ok: true, workflow: { id, ... } }` or a structured error.

---

## All endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | `{status:"ok"}` |
| GET | `/plugins` | — | Loaded plugins + version |
| POST | `/n8n/catalog/refresh` | — | Fetch node catalog from n8n and cache |
| GET | `/n8n/catalog/status` | — | Cache state: ok, count, fresh, updatedAt |
| GET | `/n8n/nodes/search` | — | Search nodes (`q`, `group`, `limit`) |
| GET | `/n8n/nodes/:type` | — | Full node schema |
| GET | `/n8n/examples` | — | List or get workflow example by `intent` |
| POST | `/n8n/workflow/validate` | — | Validate workflow JSON (no n8n call) |
| POST | `/n8n/workflow/apply` | write | Create/update/upsert workflow in n8n |
| POST | `/n8n/workflow/execute` | write | Trigger a workflow execution |
| POST | `/n8n/execution/get` | write | Fetch execution result by ID |

**write** = requires `ALLOW_N8N_WRITE=true` + `N8N_API_KEY`

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Server port |
| `N8N_BASE_URL` | `http://n8n:5678` | n8n instance URL |
| `N8N_API_BASE` | `/api/v1` | n8n REST API base path |
| `N8N_API_KEY` | — | API key (required for write operations) |
| `ALLOW_N8N_WRITE` | `false` | Enable workflow write endpoints |
| `CATALOG_CACHE_DIR` | `./cache` | Directory for cached node catalog |
| `CATALOG_TTL_HOURS` | `24` | Hours before catalog is considered stale |
