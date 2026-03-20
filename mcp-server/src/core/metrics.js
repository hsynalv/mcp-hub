/**
 * Legacy Prometheus-style metric types (Counter/Gauge/Histogram maps).
 *
 * @deprecated Not wired to production — no `src/` importers except tests. Prefer
 *   `src/core/observability/metrics.js` (MetricsRegistry) and hub pipeline →
 *   `exportMetricsRegistryPrometheus()` exposed at GET `/observability/metrics`.
 */

import { performance } from "perf_hooks";

// Metric storage
const counters = new Map(); // name -> { value, labels }
const gauges = new Map();
const histograms = new Map();

/**
 * Counter metric - monotonically increasing
 */
export class Counter {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map(); // serialized labels -> value
  }

  inc(labels = {}, value = 1) {
    const key = this.serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  get(labels = {}) {
    return this.values.get(this.serializeLabels(labels)) || 0;
  }

  serializeLabels(labels) {
    if (this.labelNames.length === 0) return "_";
    return this.labelNames.map((k) => `${k}="${labels[k] || ""}"`).join(",");
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      const labels = key === "_" ? "" : `{${key}}`;
      lines.push(`${this.name}${labels} ${value}`);
    }
    return lines.join("\n");
  }
}

/**
 * Gauge metric - can go up or down
 */
export class Gauge {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  set(labels = {}, value) {
    const key = this.serializeLabels(labels);
    this.values.set(key, value);
  }

  inc(labels = {}, value = 1) {
    const key = this.serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  dec(labels = {}, value = 1) {
    this.inc(labels, -value);
  }

  get(labels = {}) {
    return this.values.get(this.serializeLabels(labels)) || 0;
  }

  serializeLabels(labels) {
    if (this.labelNames.length === 0) return "_";
    return this.labelNames.map((k) => `${k}="${labels[k] || ""}"`).join(",");
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      const labels = key === "_" ? "" : `{${key}}`;
      lines.push(`${this.name}${labels} ${value}`);
    }
    return lines.join("\n");
  }
}

/**
 * Histogram metric - distribution of values
 */
export class Histogram {
  constructor(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], labelNames = []) {
    this.name = name;
    this.help = help;
    this.buckets = buckets.sort((a, b) => a - b);
    this.labelNames = labelNames;
    this.counts = new Map(); // key -> { sum, count, buckets: {le: count} }
  }

  observe(labels = {}, value) {
    const key = this.serializeLabels(labels);
    let data = this.counts.get(key);
    if (!data) {
      data = { sum: 0, count: 0, buckets: {} };
      for (const b of this.buckets) {
        data.buckets[b] = 0;
      }
      data.buckets["+Inf"] = 0;
    }

    data.sum += value;
    data.count++;

    for (const b of this.buckets) {
      if (value <= b) {
        data.buckets[b]++;
      }
    }
    data.buckets["+Inf"]++;

    this.counts.set(key, data);
  }

  time(labels = {}, fn) {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.observe(labels, (performance.now() - start) / 1000);
    }
  }

  async timeAsync(labels = {}, fn) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.observe(labels, (performance.now() - start) / 1000);
    }
  }

  serializeLabels(labels) {
    if (this.labelNames.length === 0) return "_";
    return this.labelNames.map((k) => `${k}="${labels[k] || ""}"`).join(",");
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];

    for (const [key, data] of this.counts) {
      const baseLabels = key === "_" ? "" : key;

      // Bucket counts
      for (const b of this.buckets) {
        const bucketLabels = baseLabels
          ? `${baseLabels},le="${b}"`
          : `le="${b}"`;
        lines.push(`${this.name}_bucket{${bucketLabels}} ${data.buckets[b]}`);
      }

      // +Inf bucket
      const infLabels = baseLabels ? `${baseLabels},le="+Inf"` : `le="+Inf"`;
      lines.push(`${this.name}_bucket{${infLabels}} ${data.buckets["+Inf"]}`);

      // Sum and count
      const labels = baseLabels ? `{${baseLabels}}` : "";
      lines.push(`${this.name}_sum${labels} ${data.sum}`);
      lines.push(`${this.name}_count${labels} ${data.count}`);
    }

    return lines.join("\n");
  }
}

// Global metrics registry
const metrics = new Map();

/**
 * Create or get a counter
 */
export function createCounter(name, help, labelNames) {
  if (!metrics.has(name)) {
    metrics.set(name, new Counter(name, help, labelNames));
  }
  return metrics.get(name);
}

/**
 * Create or get a gauge
 */
export function createGauge(name, help, labelNames) {
  if (!metrics.has(name)) {
    metrics.set(name, new Gauge(name, help, labelNames));
  }
  return metrics.get(name);
}

/**
 * Create or get a histogram
 */
export function createHistogram(name, help, buckets, labelNames) {
  if (!metrics.has(name)) {
    metrics.set(name, new Histogram(name, help, buckets, labelNames));
  }
  return metrics.get(name);
}

/**
 * Get all metrics as Prometheus format
 */
export function getAllMetrics() {
  const parts = [];
  for (const metric of metrics.values()) {
    parts.push(metric.toPrometheus());
  }
  return parts.join("\n\n");
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics() {
  metrics.clear();
}

// ── Predefined application metrics ──────────────────────────────────────────

export const httpRequestsTotal = createCounter(
  "mcp_http_requests_total",
  "Total HTTP requests",
  ["method", "route", "status"]
);

export const httpRequestDuration = createHistogram(
  "mcp_http_request_duration_seconds",
  "HTTP request duration in seconds",
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ["method", "route"]
);

export const httpActiveConnections = createGauge(
  "mcp_http_active_connections",
  "Number of active HTTP connections"
);

export const circuitBreakerState = createGauge(
  "mcp_circuit_breaker_state",
  "Circuit breaker state (0=closed, 1=half-open, 2=open)",
  ["circuit"]
);

export const pluginLoadErrors = createCounter(
  "mcp_plugin_load_errors_total",
  "Total plugin loading errors",
  ["plugin"]
);

export const mcpToolCalls = createCounter(
  "mcp_tool_calls_total",
  "Total MCP tool calls",
  ["tool", "status"]
);

export const mcpToolDuration = createHistogram(
  "mcp_tool_duration_seconds",
  "MCP tool execution duration",
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ["tool"]
);

export const externalApiCalls = createCounter(
  "mcp_external_api_calls_total",
  "External API calls",
  ["service", "status"]
);

export const externalApiRetries = createCounter(
  "mcp_external_api_retries_total",
  "External API retry attempts",
  ["service"]
);

export const externalApiDuration = createHistogram(
  "mcp_external_api_duration_seconds",
  "External API call duration",
  [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  ["service"]
);
