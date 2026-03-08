# MCP Hub Observability

This document describes the observability system for MCP Hub, including metrics, logging, and monitoring.

## Overview

MCP Hub provides comprehensive observability through:

1. **Prometheus Metrics** - For monitoring and alerting
2. **Correlation IDs** - For distributed request tracing
3. **Structured Logging** - For debugging and audit trails
4. **Health Checks** - For service availability
5. **Dashboard** - Web UI for real-time monitoring

## Metrics

### HTTP Request Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `mcp_http_requests_total` | Counter | Total HTTP requests | `method`, `route`, `status` |
| `mcp_http_request_duration_seconds` | Histogram | Request duration | `method`, `route` |
| `mcp_http_active_connections` | Gauge | Active connections | - |

### Plugin Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `mcp_tool_calls_total` | Counter | MCP tool executions | `tool`, `status` |
| `mcp_tool_duration_seconds` | Histogram | Tool execution time | `tool` |
| `mcp_plugin_load_errors_total` | Counter | Plugin loading failures | `plugin` |

### External Service Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `mcp_external_api_calls_total` | Counter | External API calls | `service`, `status` |
| `mcp_external_api_retries_total` | Counter | Retry attempts | `service` |
| `mcp_external_api_duration_seconds` | Histogram | External call duration | `service` |

### Resilience Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `mcp_circuit_breaker_state` | Gauge | Circuit state (0=closed, 1=half-open, 2=open) | `circuit` |

### Accessing Metrics

Prometheus-format metrics are available at:

```
GET /observability/metrics
```

## Correlation IDs

Every request receives a unique correlation ID for distributed tracing:

### Generation

- **Auto-generated**: If not provided, a new ID is created
- **Client-provided**: Send via `x-correlation-id` header
- **Propagation**: Included in all response headers

### Usage

```http
# Request with correlation ID
GET /github/repos
x-correlation-id: abc-123-xyz

# Response includes the same ID
HTTP/1.1 200 OK
x-correlation-id: abc-123-xyz
```

### Log Correlation

All logs include the correlation ID:

```javascript
{
  "message": "GitHub API request",
  "correlationId": "req-1234567890",
  "plugin": "github",
  "duration": 250,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Logging

### Log Levels

| Level | Usage |
|-------|-------|
| `ERROR` | Failures, exceptions, security events |
| `WARN` | Recoverable issues, rate limits |
| `INFO` | Normal operations, plugin loading |
| `DEBUG` | Detailed execution flow |

### Structured Log Format

All logs follow a structured format:

```javascript
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "correlationId": "req-1234567890",
  "plugin": "github",
  "operation": "list_repos",
  "duration_ms": 250,
  "status": "success",
  "message": "Listed 42 repositories"
}
```

### Audit Logging

Audit logs track all operations for compliance:

```javascript
{
  "timestamp": "2024-01-15T10:30:00Z",
  "correlationId": "req-1234567890",
  "actor": { "type": "api_key", "scopes": ["read"] },
  "operation": "github_get_repo",
  "resource": "octocat/hello-world",
  "status": "success",
  "duration_ms": 150
}
```

Access audit logs:

```
GET /audit/logs?plugin=github&status=success&limit=100
```

## Health Checks

### Plugin Health

Aggregate health status of all plugins:

```
GET /observability/health
```

Response:

```json
{
  "status": "healthy",
  "plugins": {
    "github": { "status": "healthy", "lastCheck": "2024-01-15T10:30:00Z" },
    "notion": { "status": "healthy", "lastCheck": "2024-01-15T10:30:00Z" },
    "shell": { "status": "degraded", "reason": "high_load" }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Service Health

Basic service health check:

```
GET /health
```

Response:

```json
{
  "status": "ok",
  "auth": "enabled"
}
```

## Job Queue Metrics

Track async job execution:

| Metric | Description |
|--------|-------------|
| `pending_jobs` | Jobs waiting to execute |
| `active_jobs` | Currently running jobs |
| `completed_jobs` | Successfully finished |
| `failed_jobs` | Failed with error |

Access job stats:

```
GET /jobs/stats
```

Response:

```json
{
  "pending": 5,
  "active": 2,
  "completed": 150,
  "failed": 3
}
```

## Dashboard

Web-based monitoring dashboard available at:

```
GET /observability/dashboard
```

Features:

- Real-time request metrics
- Plugin health status
- Error rate graphs
- Recent audit logs
- Queue size visualization

## Error Tracking

### Sentry Integration

Automatic error tracking with Sentry:

```bash
# Set Sentry DSN
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

Captured data:

- Error stack traces
- Correlation IDs
- Request context
- User information (anonymized)

### Error Metrics

View recent errors:

```
GET /observability/errors?limit=20
```

Response:

```json
{
  "errors": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "correlationId": "req-1234567890",
      "code": "EXTERNAL_ERROR",
      "message": "GitHub API timeout",
      "plugin": "github"
    }
  ]
}
```

## Best Practices

### For Operators

1. **Monitor key metrics**:
   - Error rate (< 1%)
   - P95 latency (< 500ms)
   - Queue size (< 100)

2. **Set up alerts**:
   - High error rate
   - Plugin health degradation
   - Circuit breaker open

3. **Configure retention**:
   - Metrics: 15 days
   - Logs: 30 days
   - Audit: 90 days

### For Developers

1. **Always use correlation IDs**:
   ```javascript
   logger.info("Processing request", { correlationId: req.correlationId });
   ```

2. **Track operation timing**:
   ```javascript
   const start = Date.now();
   await operation();
   const duration = Date.now() - start;
   ```

3. **Include plugin context**:
   ```javascript
   logger.info("Plugin operation", { plugin: name, operation: "createPR" });
   ```

## Configuration

### Environment Variables

```bash
# Sentry for error tracking
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Audit logging
AUDIT_LOG_FILE=true

# Metrics endpoint
METRICS_PORT=9090
```

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: 'mcp-hub'
    static_configs:
      - targets: ['localhost:8787']
    metrics_path: '/observability/metrics'
    scrape_interval: 15s
```

## Troubleshooting

### High Error Rate

1. Check `/observability/errors`
2. Look for external API failures
3. Verify plugin health

### Slow Response Times

1. Check `/observability/metrics` for histogram data
2. Identify slow plugins
3. Review circuit breaker states

### Missing Correlation IDs

1. Verify `x-correlation-id` header in requests
2. Check middleware is loaded: `correlationIdMiddleware`
3. Ensure logs include the ID

## See Also

- [Metrics Implementation](../mcp-server/src/core/metrics.js)
- [Observability Plugin](../mcp-server/src/plugins/observability/)
- [Audit System](../mcp-server/src/core/audit.js)
