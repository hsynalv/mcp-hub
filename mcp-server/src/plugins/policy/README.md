# Plugin: policy

Policy engine for the MCP Hub. Define rules that intercept requests before they are executed — requiring manual approval, enforcing rate limits, requiring dry-run confirmation, or outright blocking.

---

## Rule Actions

| Action             | Behavior                                                                |
|--------------------|-------------------------------------------------------------------------|
| `require_approval` | Creates an approval entry. Request proceeds only after manual approval. |
| `dry_run_first`    | Returns a preview. Caller must re-send with `?confirmed=true`.          |
| `rate_limit`       | Rejects requests once the limit is exceeded in the time window.         |
| `block`            | Always rejects matching requests.                                       |

---

## Quick Start

### 1. Add a rule

```bash
# Require approval before bulk-deleting Notion rows
curl -X POST http://localhost:8787/policy/rules \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern":     "POST /notion/rows/archive",
    "action":      "require_approval",
    "description": "Bulk delete requires manual confirmation"
  }'

# Rate limit HTTP requests to 50 per day
curl -X POST http://localhost:8787/policy/rules \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern": "POST /http/request",
    "action":  "rate_limit",
    "limit":   50,
    "window":  "1d"
  }'

# Require dry-run before applying n8n workflows
curl -X POST http://localhost:8787/policy/rules \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern": "POST /n8n/workflow/apply",
    "action":  "dry_run_first"
  }'
```

### 2. Test a request against rules

```bash
curl -X POST http://localhost:8787/policy/evaluate \
  -H "Content-Type: application/json" \
  -d '{"method": "POST", "path": "/notion/rows/archive"}'
```

```json
{
  "ok": true,
  "result": {
    "allowed": false,
    "action":  "require_approval",
    "rule":    "rule-a1b2c3d4",
    "approval": { "id": "approval-xyz", "status": "pending" },
    "message": "This action requires manual approval. Approval ID: approval-xyz. ..."
  }
}
```

### 3. Approve a pending request

```bash
curl -X POST http://localhost:8787/policy/approvals/approval-xyz/approve \
  -H "Authorization: Bearer $HUB_ADMIN_KEY"
```

---

## Endpoints

| Method   | Path                              | Scope    | Description                           |
|----------|-----------------------------------|----------|---------------------------------------|
| `GET`    | `/policy/rules`                   | `read`   | List all rules                        |
| `POST`   | `/policy/rules`                   | `danger` | Add a rule                            |
| `DELETE` | `/policy/rules/:id`               | `danger` | Remove a rule                         |
| `GET`    | `/policy/approvals`               | `read`   | List approvals (`?status=pending`)    |
| `POST`   | `/policy/approvals/:id/approve`   | `danger` | Approve a request                     |
| `POST`   | `/policy/approvals/:id/reject`    | `danger` | Reject a request                      |
| `POST`   | `/policy/evaluate`                | `read`   | Test a request against policy (safe)  |
| `GET`    | `/policy/health`                  | `read`   | Plugin health                         |

---

## Rule Pattern Syntax

```
[METHOD] /path/pattern
```

- Method is optional; omitting it matches any method.
- Wildcards (`*`) match any single path segment.

```
POST /notion/rows/archive        → exact match
* /n8n/workflow/*                → any method, any workflow sub-path
/http/request                    → any method to /http/request
```

---

## Window Format

For `rate_limit` action:

| Value | Meaning    |
|-------|------------|
| `1m`  | 1 minute   |
| `1h`  | 1 hour     |
| `1d`  | 1 day      |
| `24h` | 24 hours   |

---

## Rule Storage

Rules and approvals are stored at `{CATALOG_CACHE_DIR}/policy.json`.

Rate limit counters are in-memory and reset on server restart.
