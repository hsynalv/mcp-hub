# Plugin: secrets

Provides a secret reference system so AI agents never see secret values. Instead of passing raw tokens, agents use `{{secret:NAME}}` placeholders — the server resolves them server-side.

**Security guarantee:** Secret values never appear in API responses, audit logs, or agent tool outputs.

---

## How It Works

```
Agent: "Call API with Authorization: {{secret:PERCEPTA_API_KEY}}"
       ↓
http plugin receives the request body
       ↓
secrets.store.resolveDeep() replaces {{secret:PERCEPTA_API_KEY}} → actual token
       ↓
HTTP request made with real token (server-side only)
       ↓
Audit log records: Authorization: [REDACTED]
```

Secrets are **not stored** by this plugin. They live in `process.env` (your `.env` file). The plugin only maintains a **registry** of known secret names (metadata only).

---

## Setup

1. Add your secrets to `.env`:
   ```env
   PERCEPTA_API_KEY=sk-live-xxxx
   NOTION_API_KEY=secret_xxxx
   ```

2. Register them so agents know they exist:
   ```bash
   curl -X POST http://localhost:8787/secrets \
     -H "Content-Type: application/json" \
     -d '{"name": "PERCEPTA_API_KEY", "description": "Percepta backend API key"}'
   ```

3. Agents reference them as `{{secret:PERCEPTA_API_KEY}}` in any string field.

---

## Endpoints

### `GET /secrets`

List all registered secret names. **Never returns values.**

```bash
curl http://localhost:8787/secrets
```

```json
{
  "ok": true,
  "count": 2,
  "secrets": [
    { "name": "PERCEPTA_API_KEY", "description": "Percepta backend API key", "hasValue": true, "source": "env", "createdAt": "..." },
    { "name": "NOTION_API_KEY",   "description": "Notion integration secret", "hasValue": true, "source": "env", "createdAt": "..." }
  ]
}
```

`hasValue: true` means the secret exists in `process.env` and will resolve correctly.

---

### `POST /secrets`

Register a secret name. Requires `HUB_ADMIN_KEY`.

```bash
curl -X POST http://localhost:8787/secrets \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "MY_API_KEY", "description": "My service API key"}'
```

Name must be `UPPER_SNAKE_CASE`. The value must already be in `.env`.

---

### `DELETE /secrets/:name`

Remove a secret from the registry. Does not affect `.env`. Requires `HUB_ADMIN_KEY`.

```bash
curl -X DELETE http://localhost:8787/secrets/MY_API_KEY \
  -H "Authorization: Bearer $HUB_ADMIN_KEY"
```

---

### `POST /secrets/resolve`

Verify that all `{{secret:NAME}}` refs in a template will resolve. Returns which refs were found and which are missing — **never returns resolved values**.

```bash
curl -X POST http://localhost:8787/secrets/resolve \
  -H "Content-Type: application/json" \
  -d '{"template": "Bearer {{secret:NOTION_API_KEY}}"}'
```

```json
{
  "ok": true,
  "refs": { "found": ["NOTION_API_KEY"], "missing": [] },
  "hasUnresolved": false
}
```

---

## Using Refs in Other Plugins

The `http` plugin automatically resolves `{{secret:NAME}}` in all header and body values:

```json
{
  "method": "POST",
  "url": "https://api.example.com/data",
  "headers": {
    "Authorization": "Bearer {{secret:MY_API_KEY}}",
    "X-Tenant": "{{secret:TENANT_ID}}"
  }
}
```

Other plugins can import the resolver directly:

```javascript
import { resolveDeep, resolveTemplate } from "../secrets/secrets.store.js";

const headers = resolveDeep(req.body.headers);
```

---

## Configuration

No additional environment variables required. Secrets are read from the existing `.env` file via `process.env`.

The secret registry (names only) is stored at:
```
{CATALOG_CACHE_DIR}/secrets-registry.json
```
