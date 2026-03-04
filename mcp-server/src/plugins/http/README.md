# Plugin: http

Controlled outbound HTTP proxy. AI agents make external API calls through this plugin — with domain allowlisting, per-domain rate limiting, response size limits, TTL caching, and automatic `{{secret:NAME}}` header/body resolution.

---

## Why Use This?

Direct agent access to the internet is uncontrolled and risky. This plugin acts as a gatekeeper:

- Blocks untrusted domains
- Prevents runaway API calls (rate limits)
- Keeps response sizes bounded
- Ensures secrets never appear in agent prompts (resolved server-side)
- Caches frequent GET requests

---

## Quick Start

```bash
# Simple GET
curl -X POST http://localhost:8787/http/request \
  -H "Content-Type: application/json" \
  -d '{"method": "GET", "url": "https://api.github.com/users/octocat"}'

# POST with secret in header (secret stays server-side)
curl -X POST http://localhost:8787/http/request \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "url": "https://api.example.com/data",
    "headers": {"Authorization": "Bearer {{secret:MY_API_KEY}}"},
    "body": {"key": "value"},
    "cache": false
  }'

# GET with caching (5 minute TTL)
curl -X POST http://localhost:8787/http/request \
  -H "Content-Type: application/json" \
  -d '{"method": "GET", "url": "https://api.github.com/repos/octocat/Hello-World", "cache": true, "cacheTtl": 300}'
```

---

## Endpoints

| Method   | Path            | Scope    | Description                        |
|----------|-----------------|----------|------------------------------------|
| `POST`   | `/http/request` | `write`  | Make a controlled HTTP request     |
| `GET`    | `/http/policy`  | `read`   | View allowlist, rate limits, config|
| `GET`    | `/http/cache`   | `read`   | Cache statistics                   |
| `DELETE` | `/http/cache`   | `danger` | Clear the response cache           |
| `GET`    | `/http/health`  | `read`   | Plugin health                      |

---

## Request Body (`POST /http/request`)

| Field      | Type      | Required | Description                                      |
|------------|-----------|----------|--------------------------------------------------|
| `method`   | string    | yes      | HTTP method: GET, POST, PUT, PATCH, DELETE       |
| `url`      | string    | yes      | Target URL (must pass domain allowlist)          |
| `headers`  | object    | no       | Request headers (supports `{{secret:NAME}}`)    |
| `body`     | any       | no       | Request body (supports `{{secret:NAME}}`)       |
| `cache`    | boolean   | no       | Cache GET responses (default: false)             |
| `cacheTtl` | number    | no       | Cache TTL in seconds (default: 300)              |

---

## Secret Refs

Headers and body values can contain `{{secret:NAME}}` placeholders. These are resolved server-side using `process.env[NAME]` — the actual value never reaches the agent.

```json
{
  "headers": {
    "Authorization": "Bearer {{secret:GITHUB_TOKEN}}",
    "X-Tenant-ID":   "{{secret:TENANT_ID}}"
  }
}
```

---

## Configuration

```env
HTTP_ALLOWED_DOMAINS=api.github.com,*.amazonaws.com   # leave empty to allow all
HTTP_BLOCKED_DOMAINS=localhost,127.0.0.1               # always blocked
HTTP_MAX_RESPONSE_SIZE_KB=512
HTTP_DEFAULT_TIMEOUT_MS=10000
HTTP_RATE_LIMIT_RPM=60      # requests per minute per domain
HTTP_CACHE_TTL_SECONDS=300
```

### Domain Patterns

- Exact: `api.github.com`
- Wildcard: `*.amazonaws.com` (matches any single subdomain)

Blocked domains are checked first. If `HTTP_ALLOWED_DOMAINS` is empty, all non-blocked domains are allowed.

---

## Example Response

```json
{
  "ok": true,
  "cached": false,
  "status": 200,
  "body": { "login": "octocat", "id": 583231 },
  "size": 1482,
  "truncated": false,
  "durationMs": 312
}
```
