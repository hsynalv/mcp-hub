# Observability Infrastructure

Central observability system for MCP-Hub platform - metrics, tracing, and runtime visibility.

## Overview

The Observability infrastructure provides:
- **Metrics** - Counter, gauge, and histogram metrics collection
- **Tracing/Correlation** - Distributed tracing with correlation IDs
- **Runtime Stats** - Process and system visibility
- **Integration** - Plugin, job, and tool metrics

## Difference from Audit

| Audit | Observability |
|-------|--------------|
| Security/compliance focus | Operational visibility |
| Immutable log entries | Real-time metrics |
| Who did what | System performance |
| Permanent storage | In-memory (configurable) |
| Regulatory requirements | DevOps/SRE needs |

## Architecture

```
src/core/observability/
├── metrics.js              # Metrics registry (counter, gauge, histogram)
├── tracing.js            # Correlation ID and trace context
├── runtime.stats.js      # Process and runtime statistics
├── plugin.metrics.js     # Plugin-specific metrics
├── jobs.metrics.js       # Job/queue metrics
├── tools.metrics.js      # Tool usage metrics
├── observability.manager.js  # Central orchestrator
├── index.js              # Main exports
└── observability.test.js # Test suite
```

## Quick Start

### Basic Usage

```javascript
import {
  getObservabilityManager,
  getMetricsRegistry,
  generateCorrelationId,
} from "./core/observability/index.js";

// Get manager
const obs = getObservabilityManager();

// Record metrics
obs.incrementCounter("requests_total", 1, { plugin: "shell" });
obs.setGauge("jobs_running", 5);
obs.observeDuration("request_duration_ms", 150);

// Generate correlation ID
const correlationId = generateCorrelationId();
```

## Metrics System

### Metric Types

```javascript
import { MetricType, getMetricsRegistry } from "./core/observability/index.js";

const metrics = getMetricsRegistry();

// Counter (only increases)
metrics.increment("requests_total", 1, { plugin: "shell", status: "200" });

// Gauge (can go up/down)
metrics.set("jobs_running", 5);
metrics.set("memory_usage_mb", 512);

// Histogram (duration/value distribution)
metrics.observe("request_duration_ms", 150, { plugin: "rag" });
```

### Standard Metrics

```javascript
import { Metrics } from "./core/observability/index.js";

// Counters
Metrics.REQUESTS_TOTAL;           // "requests_total"
Metrics.PLUGIN_CALLS_TOTAL;       // "plugin_calls_total"
Metrics.JOB_EVENTS_TOTAL;           // "job_events_total"
Metrics.TOOL_CALLS_TOTAL;         // "tool_calls_total"
Metrics.ERRORS_TOTAL;             // "errors_total"

// Gauges
Metrics.JOBS_RUNNING;             // "jobs_running"
Metrics.JOBS_QUEUED;              // "jobs_queued"
Metrics.PLUGINS_ENABLED;          // "plugins_enabled"
Metrics.TOOLS_TOTAL;              // "tools_total"

// Histograms
Metrics.REQUEST_DURATION_MS;        // "request_duration_ms"
Metrics.JOB_DURATION_MS;          // "job_duration_ms"
Metrics.PLUGIN_EXECUTION_DURATION_MS;  // "plugin_execution_duration_ms"
Metrics.LLM_DURATION_MS;          // "llm_duration_ms"
Metrics.RAG_QUERY_DURATION_MS;    // "rag_query_duration_ms"
```

### Labels

All metrics support labels for dimensional data:

```javascript
metrics.increment("errors_total", 1, {
  type: "plugin",
  plugin: "shell",
  action: "execute"
});

metrics.observe("request_duration_ms", 200, {
  plugin: "rag",
  operation: "search"
});
```

## Tracing / Correlation

### Correlation ID

```javascript
import {
  generateCorrelationId,
  extractTraceContext,
  withTraceContext,
} from "./core/observability/index.js";

// Generate new ID
const id = generateCorrelationId();
// → "corr_16a8f9k2_3d9f2a1b"

// Extract from request
const ctx = extractTraceContext(req);
// → { correlationId, traceId, spanId, parentSpanId, baggage }

// Propagate through async calls
await withTraceContext(ctx, async () => {
  // All code here has access to the same correlation ID
  const current = getCurrentTraceContext();
  console.log(current.correlationId); // same as ctx.correlationId
});
```

### Trace Context Structure

```javascript
{
  correlationId: "corr_16a8f9k2_3d9f2a1b",
  traceId: "trace_16a8f9k2_3d9f2a1b",
  spanId: "3d9f2a1b8c4e",
  parentSpanId: "parent_span_id",
  baggage: {
    user: "admin",
    workspaceId: "ws_123"
  }
}
```

### HTTP Headers

```javascript
import { contextToHeaders } from "./core/observability/index.js";

const headers = contextToHeaders(ctx);
// → {
//   "x-correlation-id": "corr_...",
//   "x-trace-id": "trace_...",
//   "x-span-id": "span_...",
//   "x-parent-span-id": "parent_...",
//   "x-baggage": "{\"user\":\"admin\"}"
// }
```

### Automatic Tracing

```javascript
import { traced } from "./core/observability/index.js";

const tracedFunction = traced(async (data) => {
  // Function automatically gets trace context
  // Child spans are created for nested calls
  return await processData(data);
}, "processData");

// Use normally
const result = await tracedFunction(data);
```

## Runtime Stats

### Basic Stats

```javascript
import {
  getRuntimeStats,
  getProcessStats,
  getMemoryStats,
} from "./core/observability/index.js";

// Runtime snapshot
const stats = getRuntimeStats();
// → {
//   timestamp: "2024-01-01T12:00:00.000Z",
//   startedAt: "2024-01-01T10:00:00.000Z",
//   uptime: 7200,
//   uptimeFormatted: "2h 0m 0s",
//   nodeVersion: "v18.17.0",
//   platform: "linux",
//   arch: "x64",
//   memory: { rss: "150.5 MB", heapUsed: "45.2 MB", ... },
//   cpu: { user: 1200000, system: 800000 }
// }

// Process info
const process = getProcessStats();
// → { pid, ppid, title, versions, platform, arch, ... }

// Memory details
const memory = getMemoryStats();
// → { rss, rssBytes, heapTotal, heapUsed, external, arrayBuffers }
```

### System Snapshot

```javascript
import { getSystemSnapshot } from "./core/observability/index.js";

const snapshot = await getSystemSnapshot();
// → {
//   timestamp: "...",
//   runtime: { ... },
//   plugins: { total: 10, enabled: 8, ... },
//   jobs: { total: 5, running: 2, queued: 3, ... },
//   tools: { total: 42, byPlugin: {...} }
// }
```

### Health Check

```javascript
import { getHealthStatus } from "./core/observability/index.js";

const health = getHealthStatus();
// → {
//   status: "healthy",  // healthy | degraded | unhealthy
//   checks: {
//     runtime: true,
//     plugins: true,
//     registry: true
//   },
//   timestamp: "..."
// }
```

## Integration with Existing Systems

### Plugin Metrics

```javascript
import { recordPluginCall } from "./core/observability/index.js";

// Record plugin execution
recordPluginCall("shell", "execute", "success", 150);  // 150ms duration
recordPluginCall("shell", "execute", "error");         // failed
```

### Job Metrics

```javascript
import {
  recordJobEvent,
  recordJobDuration,
  updateJobGauges,
} from "./core/observability/index.js";

// Record job lifecycle
recordJobEvent("rag.index", "queued", "rag");
recordJobEvent("rag.index", "started", "rag");
recordJobEvent("rag.index", "completed", "rag");

// Record duration
recordJobDuration("rag.index", 5000, "rag");

// Update gauges
updateJobGauges(2, 5);  // 2 running, 5 queued
```

### Tool Metrics

```javascript
import {
  recordToolCall,
  recordLLMCall,
  recordRAGQuery,
} from "./core/observability/index.js";

// Record tool usage
recordToolCall("rag.search", "rag", "success", 200);
recordToolCall("shell.execute", "shell", "error");

// LLM-specific
recordLLMCall("openai", "gpt-4", 1500, "success");
recordLLMCall("anthropic", "claude", 2000, "success");

// RAG-specific
recordRAGQuery("index", 5000, "success");
recordRAGQuery("search", 150, "success");
```

## Observability Manager

### Central Orchestrator

```javascript
import { getObservabilityManager } from "./core/observability/index.js";

const obs = getObservabilityManager();

// Metrics
obs.incrementCounter("requests_total", 1, { plugin: "shell" });
obs.setGauge("active_connections", 10);
obs.observeDuration("db_query_ms", 50);

// Tracing
const ctx = obs.extractTraceContext(req);
await obs.withTraceContext(ctx, async () => {
  // Async work with trace context
});

// Runtime
const runtime = obs.getRuntimeSnapshot();
const system = await obs.getSystemSnapshot();
const health = obs.getHealthStatus();

// Export
const json = obs.exportMetricsJSON();
const prom = obs.exportMetricsPrometheus();
```

### Full Snapshot

```javascript
const full = await obs.getFullSnapshot();
// → {
//   timestamp: "...",
//   metrics: { counters, gauges, histograms },
//   runtime: { ... },
//   plugins: { ... },
//   jobs: { ... },
//   tools: { ... },
//   health: { ... }
// }
```

## API Endpoints

### Basic Setup

```javascript
import { Router } from "express";
import { getObservabilityManager } from "./core/observability/index.js";

const router = Router();
const obs = getObservabilityManager();

// GET /observability/metrics
router.get("/observability/metrics", (req, res) => {
  const format = req.query.format || "json";

  if (format === "prometheus") {
    res.set("Content-Type", "text/plain");
    res.send(obs.exportMetricsPrometheus());
  } else {
    res.json(obs.exportMetricsJSON());
  }
});

// GET /observability/runtime
router.get("/observability/runtime", (req, res) => {
  res.json(obs.getRuntimeSnapshot());
});

// GET /observability/health
router.get("/observability/health", (req, res) => {
  const health = obs.getHealthStatus();
  const statusCode = health.status === "healthy" ? 200 :
                    health.status === "degraded" ? 200 : 503;
  res.status(statusCode).json(health);
});

// GET /observability/plugins
router.get("/observability/plugins", (req, res) => {
  res.json(obs.getPluginMetrics());
});

// GET /observability/jobs
router.get("/observability/jobs", async (req, res) => {
  const jobs = await obs.getJobMetrics();
  res.json(jobs);
});

// GET /observability/snapshot
router.get("/observability/snapshot", async (req, res) => {
  const snapshot = await obs.getFullSnapshot();
  res.json(snapshot);
});
```

## Prometheus Export

### Basic Format

The Prometheus exporter produces text format compatible with Prometheus scrape:

```
# HELP requests_total Total requests
# TYPE requests_total counter
requests_total{plugin="shell",status="200"} 42

# HELP jobs_running Current running jobs
# TYPE jobs_running gauge
jobs_running 5

# TYPE request_duration_ms histogram
request_duration_ms_bucket{le="50"} 10
request_duration_ms_bucket{le="100"} 25
request_duration_ms_bucket{le="+Inf"} 42
request_duration_ms_count 42
request_duration_ms_sum 3150
```

## Future: Prometheus/OpenTelemetry Integration

### Planned Extensions

1. **Prometheus Client** - Native Prometheus metrics endpoint
2. **OpenTelemetry SDK** - OTLP export to collectors
3. **Jaeger/Zipkin** - Distributed trace export
4. **Grafana Dashboards** - Pre-built dashboards
5. **Alerting Rules** - Prometheus alerting

### Extension Points

```javascript
// Custom exporter
class CustomExporter {
  export(metrics) {
    // Send to custom backend
  }
}

// Register with manager
obs.registerExporter(new CustomExporter());
```

## Testing

### Run Tests

```bash
npm test src/core/observability/observability.test.js
```

### Test Coverage

- Counter increment/decrement
- Gauge set/update
- Histogram observation
- Runtime stats snapshot
- Correlation ID generation
- Trace context extraction
- Job/plugin/tool metric integration
- Manager behavior
- Prometheus export format

## Best Practices

1. **Use Correlation IDs** - Pass through all async operations
2. **Label Everything** - Use labels for dimensional metrics
3. **Histogram for Durations** - Use histograms, not gauges for timing
4. **Sync Gauges** - Regularly sync gauge values from source systems
5. **Don't Log PII** - Avoid putting sensitive data in baggage
6. **Cardinality Control** - Be careful with high-cardinality labels
7. **Metric Names** - Follow `domain_entity_unit` pattern

## Troubleshooting

### Metrics Not Recording
- Check `getMetricsRegistry()` returns same instance
- Verify metric type matches operation (counter vs gauge)

### Correlation ID Missing
- Ensure `withTraceContext()` wraps async operations
- Check headers are passed between services

### Memory Leaks
- Don't create unlimited unique labels
- Clear metrics registry periodically if needed

### High Cardinality
- Avoid user IDs, timestamps, or random values in labels
- Use bounded sets of label values

## Configuration

### Environment Variables

```bash
# Future configuration
OBSERVABILITY_ENABLED=true
OBSERVABILITY_METRICS_INTERVAL=15000
OBSERVABILITY_EXPORT_FORMAT=json  # json | prometheus
OBSERVABILITY_TRACE_SAMPLING=0.1  # 10% sampling
```

---

For more details, see the test suite: `src/core/observability/observability.test.js`

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
