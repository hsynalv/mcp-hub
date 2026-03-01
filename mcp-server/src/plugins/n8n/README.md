# Plugin: n8n

Provides the AI agent with everything it needs to build and deploy n8n workflows.

This plugin is the core of mcp-hub. It exposes the node catalog, workflow validation, a single-call context endpoint, and optional write operations to a live n8n instance.

---

## Endpoints

### `POST /n8n/context` ⭐ Primary AI Tool

Returns node schemas, available credentials, and relevant examples in **a single HTTP call**. This is the main tool the AI agent should use — it replaces separate calls to search, detail, credentials, and examples.

**Body:**
```json
{ "nodes": "webhook,slack,googleSheets" }
```

Also accepts an array:
```json
{ "nodes": ["webhook", "slack", "googleSheets"] }
```

Short names are resolved automatically — `"telegram"` → `n8n-nodes-base.telegram`.

**Response:**
```json
{
  "nodes": {
    "n8n-nodes-base.webhook": { "type": "...", "properties": [...], "credentials": [...] },
    "n8n-nodes-base.slack": { "type": "...", "properties": [...], "credentials": [...] }
  },
  "credentials": [
    { "id": "1", "name": "My Slack Bot", "type": "slackApi" }
  ],
  "examples": [...]
}
```

---

### `GET /n8n/nodes/search`

Search the node catalog by keyword and/or group.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search term (matches type, displayName, description) |
| `group` | string | — | Filter by group (e.g. `trigger`, `output`) |
| `limit` | number | `20` | Max results |

**Example:**
```bash
curl "http://localhost:8787/n8n/nodes/search?q=slack&limit=5"
```

**Response:** Array of `NodeSummary` objects.

---

### `GET /n8n/nodes/:type`

Get full schema for a single node — properties, required fields, options, and credential types.

**Fuzzy matching** is supported. All of these resolve to the same node:
- `/n8n/nodes/telegram`
- `/n8n/nodes/Telegram`
- `/n8n/nodes/n8n-nodes-base.telegram`

**Response:**
```json
{
  "ok": true,
  "node": {
    "type": "n8n-nodes-base.telegram",
    "displayName": "Telegram",
    "version": 1.2,
    "properties": [
      { "name": "resource", "type": "options", "required": false, "options": [...] },
      { "name": "operation", "type": "options", "required": false, "options": [...] },
      { "name": "chatId", "type": "string", "required": true }
    ],
    "credentials": [
      { "name": "telegramApi", "required": true }
    ]
  }
}
```

---

### `GET /n8n/examples`

Returns hand-written workflow templates. Useful as structural references for the AI.

**Query params:**

| Param | Description |
|-------|-------------|
| `intent` | Filter by intent slug (e.g. `webhook_to_slack`) |

**Example:**
```bash
curl "http://localhost:8787/n8n/examples?intent=cron_http_post"
```

---

### `POST /n8n/workflow/validate`

Validates a workflow JSON without sending it to n8n. Checks:
- Required fields (`name`, `nodes`, `connections`)
- Every node has `id`, `name`, `type`, `position`, `parameters`
- Connections reference existing node names
- No duplicate node IDs or names
- No orphan nodes
- At least one trigger node

**Body:**
```json
{ "workflowJson": { "name": "...", "nodes": [...], "connections": {} } }
```

**Response:**
```json
{ "ok": true, "warnings": [] }
```
or
```json
{ "ok": false, "errors": [{ "code": "missing_field", "path": "nodes[0].type", "message": "..." }] }
```

---

### `POST /n8n/workflow/apply`

Creates or updates a workflow in n8n. Requires `ALLOW_N8N_WRITE=true` and a valid `N8N_API_KEY`.

Automatically enriches the workflow with sticky notes before saving:
- **Overview note** — execution order summary
- **Section notes** — visual grouping of Trigger / Process / Action nodes
- **Credential notes** — per-node credential setup reminders

**Body:**
```json
{
  "workflowJson": { "name": "My Workflow", "nodes": [...], "connections": {} },
  "mode": "create"
}
```

| `mode` | Behavior |
|--------|----------|
| `create` | Always creates a new workflow |
| `update` | Updates existing workflow (`workflowJson.id` required) |
| `upsert` | Updates if `id` present, creates otherwise |

**Response:**
```json
{ "ok": true, "workflow": { "id": "abc123", "name": "My Workflow" } }
```

**Error codes:**

| HTTP | `error` | Cause |
|------|---------|-------|
| `403` | `write_disabled` | `ALLOW_N8N_WRITE` is not `true` |
| `401` | `missing_api_key` | `N8N_API_KEY` not set |
| `401` | `n8n_auth_error` | API key rejected by n8n |
| `502` | `network_error` | n8n unreachable |
| `422` | `n8n_validation_error` | n8n rejected the workflow JSON |

---

### `POST /n8n/workflow/execute`

Triggers execution of an existing workflow by ID.

**Body:**
```json
{ "workflowId": "abc123", "inputData": {} }
```

---

### `POST /n8n/execution/get`

Fetches the result of a specific execution.

**Body:**
```json
{ "executionId": "exec456" }
```

---

### `GET /n8n/catalog/status`

Returns the current state of the node catalog cache.

**Response:**
```json
{
  "ok": true,
  "updatedAt": "2026-03-01T01:35:26.210Z",
  "source": "n8n-nodes-base-package",
  "count": 439,
  "fresh": true
}
```

---

### `POST /n8n/catalog/refresh`

Rebuilds the node catalog by reading directly from the installed `n8n-nodes-base` npm package. Falls back to the n8n API if the package is unavailable.

This is slow (~3-5 seconds) and writes to disk. Run it once after install, then rely on the cache.

```bash
curl -X POST http://localhost:8787/n8n/catalog/refresh
```

---

## How the Node Catalog Works

1. On first request after startup, `catalog.store.js` checks for a cached file on disk.
2. If the cache is missing or expired (`CATALOG_TTL_HOURS`), `catalog.provider.js` loads all node descriptors from the `n8n-nodes-base` package installed locally.
3. Node types are stored with their full prefix: `n8n-nodes-base.telegram` — this is what n8n expects in workflow JSON.
4. `catalog.search.js` provides fuzzy matching so the AI can pass short names (`"telegram"`) and still get results.

---

## Workflow Annotation

When a workflow is applied via `POST /n8n/workflow/apply`, the `workflow.annotate.js` module automatically adds sticky notes:

```
┌─────────────────────────────────────────┐
│ 📋 Overview                             │
│ Execution order: Webhook → Set → Slack  │
└─────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────────────────┐
│ 🚀 Trigger       │  │ 📤 Actions                   │
│                  │  │                              │
│  [Webhook]       │  │  [Set]  [Send Slack Message] │
└──────────────────┘  └──────────────────────────────┘

                       ┌────────────────────────────┐
                       │ 🔑 Credential              │
                       │ slackApi → "My Slack Bot"  │
                       └────────────────────────────┘
```

This makes generated workflows immediately readable in the n8n canvas without any manual setup.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_BASE_URL` | `http://n8n:5678` | n8n instance URL |
| `N8N_API_BASE` | `/api/v1` | n8n REST API base path |
| `N8N_API_KEY` | — | Required for write operations |
| `ALLOW_N8N_WRITE` | `false` | Enable apply/execute endpoints |
| `CATALOG_CACHE_DIR` | `./cache` | Cache directory |
| `CATALOG_TTL_HOURS` | `24` | Hours before catalog cache expires |
