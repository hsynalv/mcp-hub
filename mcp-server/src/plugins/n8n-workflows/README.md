# Plugin: n8n-workflows

Gives the AI agent read access to all workflows stored in a live n8n instance — their metadata, full JSON, and searchability.

This plugin enables two key use cases:
1. **Workflow as context** — the AI can fetch an existing workflow and use it as a reference or starting point
2. **Workflow update** — the AI fetches the current JSON before modifying it, ensuring no manual changes are lost

---

## Endpoints

### `GET /n8n/workflows`

Returns a lightweight list of all workflows in n8n.

**Response:**
```json
[
  { "id": "abc123", "name": "Webhook to Telegram", "active": true, "updatedAt": "2026-03-01T10:00:00.000Z" },
  { "id": "def456", "name": "Daily Report", "active": false, "updatedAt": "2026-02-28T08:30:00.000Z" }
]
```

Results are served from disk cache when fresh. Stale or missing cache triggers an automatic refresh from n8n.

---

### `GET /n8n/workflows/:id`

Returns the complete workflow JSON for a given ID. This is the same format n8n uses internally and the same format `POST /n8n/workflow/apply` accepts.

**Example:**
```bash
curl http://localhost:8787/n8n/workflows/abc123
```

**Response:**
```json
{
  "id": "abc123",
  "name": "Webhook to Telegram",
  "active": true,
  "nodes": [...],
  "connections": {},
  "settings": {},
  "staticData": null
}
```

Use this endpoint before updating a workflow to ensure the AI works from the current state rather than reconstructing from memory.

---

### `POST /n8n/workflows/search`

Searches through workflows by name keyword or node type.

**Body:**
```json
{
  "q": "telegram",
  "nodeType": "n8n-nodes-base.httpRequest"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `q` | string | Name contains this string (case-insensitive) |
| `nodeType` | string | Any node in the workflow matches this exact type |

Both fields are optional. If both are provided, results match either condition (OR).

**Response:**
```json
[
  {
    "id": "abc123",
    "name": "Webhook to Telegram",
    "active": true,
    "matches": { "nodes": 1 }
  }
]
```

---

## Caching

### Workflow list

The workflow list is cached at:
```
{CATALOG_CACHE_DIR}/n8n-workflows/list.json
```

TTL is controlled by `WORKFLOWS_TTL_MINUTES` (default: 10 minutes). Short TTL ensures the AI sees recently created or modified workflows.

### Workflow detail

Individual workflow JSONs are cached per-ID at:
```
{CATALOG_CACHE_DIR}/n8n-workflows/<id>.json
```

These are fetched live on first access and cached for the same TTL duration.

---

## Workflow Update Flow

The recommended flow when modifying an existing workflow:

```
1. GET /n8n/workflows/:id       → fetch current JSON
2. Modify the JSON              → add/remove/edit nodes and connections
3. POST /n8n/workflow/validate  → validate the modified JSON
4. POST /n8n/workflow/apply     → apply with mode: "update"
                                   (workflowJson must include top-level "id")
```

This prevents the AI from reconstructing a workflow from scratch and accidentally losing nodes or connections that were manually added in n8n.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_BASE_URL` | `http://n8n:5678` | n8n instance URL |
| `N8N_API_BASE` | `/api/v1` | n8n REST API base path |
| `N8N_API_KEY` | — | Required — used to authenticate with n8n |
| `CATALOG_CACHE_DIR` | `./cache` | Root cache directory |
| `WORKFLOWS_TTL_MINUTES` | `10` | Minutes before workflow cache expires |

`N8N_API_KEY` is required. Without it, all endpoints return:
```json
{ "ok": false, "error": "missing_api_key" }
```

If n8n is unreachable and no cache exists:
```json
{ "ok": false, "error": "n8n_unreachable" }
```
