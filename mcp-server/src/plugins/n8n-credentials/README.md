# Plugin: n8n-credentials

Exposes credential metadata from a live n8n instance to the AI agent — without ever returning secrets, tokens, or passwords.

The AI needs to know which credentials exist (and their types) to correctly wire them into generated workflows. This plugin provides exactly that, cached locally for performance.

---

## Endpoints

### `GET /credentials`

Returns all credentials currently stored in n8n as a lightweight metadata list.

**Response:**
```json
[
  { "id": "1", "name": "My Telegram Bot", "type": "telegramApi" },
  { "id": "2", "name": "Slack Workspace", "type": "slackApi" },
  { "id": "3", "name": "Google Sheets SA", "type": "googleSheetsOAuth2Api" }
]
```

Data is served from disk cache when fresh. If the cache is expired or missing, the plugin fetches from n8n automatically.

If n8n is unreachable and there is no cache, the endpoint returns `503`:
```json
{ "ok": false, "error": "n8n_unreachable", "details": "..." }
```

---

### `GET /credentials/:type`

Filters the credential list by type. Useful when the AI knows which credential type a node requires and wants to find a matching one.

**Example:**
```bash
curl http://localhost:8787/credentials/telegramApi
```

**Response:**
```json
[
  { "id": "1", "name": "My Telegram Bot", "type": "telegramApi" }
]
```

Returns an empty array `[]` if no credentials of that type exist — never an error.

---

### `POST /credentials/refresh`

Forces a fresh fetch from n8n and overwrites the disk cache.

```bash
curl -X POST http://localhost:8787/credentials/refresh
```

**Response:**
```json
{
  "ok": true,
  "count": 6,
  "updatedAt": "2026-03-01T12:00:00.000Z"
}
```

Use this after adding new credentials in n8n so the AI can see them immediately.

---

## Security

This plugin is intentionally read-only and metadata-only:

- **Never** returns credential `data` fields (tokens, passwords, API keys, OAuth secrets)
- **Never** exposes the raw n8n credential object
- Only returns: `id`, `name`, `type`
- Results are deduplicated by `id`

The n8n API key used to fetch credentials is stored only in `.env` and never forwarded to clients.

---

## Caching

Credentials are cached to disk at:
```
{CATALOG_CACHE_DIR}/n8n-credentials/credentials.json
```

Cache format:
```json
{
  "updatedAt": "2026-03-01T12:00:00.000Z",
  "items": [
    { "id": "1", "name": "My Telegram Bot", "type": "telegramApi" }
  ]
}
```

Cache is considered fresh for `CREDENTIALS_TTL_MINUTES` minutes (default: 60). After expiry, the next `GET /credentials` call triggers an automatic refresh.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_BASE_URL` | `http://n8n:5678` | n8n instance URL |
| `N8N_API_BASE` | `/api/v1` | n8n REST API base path |
| `N8N_API_KEY` | — | Required — used to authenticate with n8n |
| `CATALOG_CACHE_DIR` | `./cache` | Root cache directory |
| `CREDENTIALS_TTL_MINUTES` | `60` | Minutes before credential cache expires |

`N8N_API_KEY` is required for this plugin to function. Without it, all endpoints return:
```json
{ "ok": false, "error": "missing_api_key" }
```

---

## Usage with n8n AI Agent

The `GET /n8n/context` endpoint (n8n plugin) automatically includes credentials from this plugin's cache. In most cases you do not need to call `/credentials` directly from the AI agent.

Call `/credentials/:type` directly only when you need to check availability of a specific credential type before building a workflow.
