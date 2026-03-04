# Plugin: observability

Aggregated health, Prometheus-format metrics, and error log surfacing. Builds on the existing `audit.js` ring buffer — no additional storage required.

---

## Endpoints

| Method | Path                     | Scope  | Description                        |
|--------|--------------------------|--------|------------------------------------|
| `GET`  | `/observability/health`  | `read` | Aggregate health of all plugins    |
| `GET`  | `/observability/metrics` | `read` | Prometheus-format text metrics     |
| `GET`  | `/observability/errors`  | `read` | Recent errors from audit log       |

---

## Health Check

```bash
curl http://localhost:8787/observability/health
```

```json
{
  "ok": true,
  "status": "healthy",
  "uptime": { "seconds": 3621, "human": "1h 0m 21s" },
  "memory": { "heapUsedMb": 42.3, "heapTotalMb": 68.0, "rssMb": 89.1 },
  "plugins": [
    { "name": "n8n",     "status": "loaded", "calls": 142, "errors": 0 },
    { "name": "notion",  "status": "loaded", "calls": 87,  "errors": 2 },
    { "name": "secrets", "status": "loaded", "calls": 12,  "errors": 0 }
  ],
  "audit": {
    "totalCalls": 241,
    "totalErrors": 2,
    "errorRate": 1
  }
}
```

Status is `"degraded"` if any plugin has recorded errors.

---

## Prometheus Metrics

```bash
curl http://localhost:8787/observability/metrics
```

```
# HELP mcp_hub_uptime_seconds Server uptime in seconds
# TYPE mcp_hub_uptime_seconds gauge
mcp_hub_uptime_seconds 3621

# HELP mcp_hub_requests_total Total HTTP requests
# TYPE mcp_hub_requests_total counter
mcp_hub_requests_total 241

# HELP mcp_hub_plugin_requests_total Requests per plugin
# TYPE mcp_hub_plugin_requests_total counter
mcp_hub_plugin_requests_total{plugin="n8n"} 142
mcp_hub_plugin_requests_total{plugin="notion"} 87
...
```

Use with Prometheus + Grafana or any metrics scraper.

---

## Recent Errors

```bash
# Last 20 errors (default)
curl http://localhost:8787/observability/errors

# Last 5 errors from the notion plugin
curl "http://localhost:8787/observability/errors?limit=5&plugin=notion"
```

---

## Sentry (Optional)

Set `SENTRY_DSN` in `.env` to enable automatic error tracking:

```env
SENTRY_DSN=https://xxx@sentry.io/yyy
```

Install the Sentry SDK:

```bash
npm install @sentry/node
```

The plugin will initialize Sentry automatically on startup if `SENTRY_DSN` is present.
