/**
 * Metrics System
 *
 * In-memory metrics registry supporting counters, gauges, and histograms.
 * Designed for future Prometheus/OpenTelemetry compatibility.
 */

/**
 * Metric types
 */
export const MetricType = {
  COUNTER: "counter",
  GAUGE: "gauge",
  HISTOGRAM: "histogram",
};

/**
 * Metric value with labels
 */
class MetricValue {
  /**
   * @param {string} name
   * @param {MetricType} type
   * @param {Object} [labels]
   * @param {string} [help]
   */
  constructor(name, type, labels = {}, help = "") {
    this.name = name;
    this.type = type;
    this.labels = labels;
    this.help = help;
    this.value = 0;
    this.count = 0;
    this.sum = 0;
    this.buckets = new Map();
    this.timestamp = Date.now();
  }
}

/**
 * Metrics Registry
 */
export class MetricsRegistry {
  constructor() {
    /** @type {Map<string, MetricValue>} */
    this.metrics = new Map();
    this.startedAt = Date.now();
  }

  /**
   * Generate metric key from name and labels
   * @param {string} name
   * @param {Object} labels
   * @returns {string}
   */
  _key(name, labels = {}) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  /**
   * Register or get a counter
   * @param {string} name
   * @param {string} [help]
   * @returns {MetricValue}
   */
  counter(name, help = "") {
    const key = this._key(name);
    if (!this.metrics.has(key)) {
      this.metrics.set(key, new MetricValue(name, MetricType.COUNTER, {}, help));
    }
    return this.metrics.get(key);
  }

  /**
   * Register or get a gauge
   * @param {string} name
   * @param {string} [help]
   * @returns {MetricValue}
   */
  gauge(name, help = "") {
    const key = this._key(name);
    if (!this.metrics.has(key)) {
      this.metrics.set(key, new MetricValue(name, MetricType.GAUGE, {}, help));
    }
    return this.metrics.get(key);
  }

  /**
   * Register or get a histogram
   * @param {string} name
   * @param {string} [help]
   * @returns {MetricValue}
   */
  histogram(name, help = "") {
    const key = this._key(name);
    if (!this.metrics.has(key)) {
      const metric = new MetricValue(name, MetricType.HISTOGRAM, {}, help);
      // Default buckets in ms
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000].forEach(b => {
        metric.buckets.set(b, 0);
      });
      this.metrics.set(key, metric);
    }
    return this.metrics.get(key);
  }

  /**
   * Increment a counter
   * @param {string} name
   * @param {number} [value]
   * @param {Object} [labels]
   */
  increment(name, value = 1, labels = {}) {
    const key = this._key(name, labels);
    let metric = this.metrics.get(key);

    if (!metric) {
      metric = new MetricValue(name, MetricType.COUNTER, labels);
      this.metrics.set(key, metric);
    }

    if (metric.type !== MetricType.COUNTER) {
      throw new Error(`Metric ${name} is not a counter`);
    }

    metric.value += value;
    metric.timestamp = Date.now();
  }

  /**
   * Set a gauge value
   * @param {string} name
   * @param {number} value
   * @param {Object} [labels]
   */
  set(name, value, labels = {}) {
    const key = this._key(name, labels);
    let metric = this.metrics.get(key);

    if (!metric) {
      metric = new MetricValue(name, MetricType.GAUGE, labels);
      this.metrics.set(key, metric);
    }

    if (metric.type !== MetricType.GAUGE) {
      throw new Error(`Metric ${name} is not a gauge`);
    }

    metric.value = value;
    metric.timestamp = Date.now();
  }

  /**
   * Observe a duration/value in histogram
   * @param {string} name
   * @param {number} value
   * @param {Object} [labels]
   */
  observe(name, value, labels = {}) {
    const key = this._key(name, labels);
    let metric = this.metrics.get(key);

    if (!metric) {
      metric = new MetricValue(name, MetricType.HISTOGRAM, labels);
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000].forEach(b => {
        metric.buckets.set(b, 0);
      });
      this.metrics.set(key, metric);
    }

    if (metric.type !== MetricType.HISTOGRAM) {
      throw new Error(`Metric ${name} is not a histogram`);
    }

    metric.count++;
    metric.sum += value;

    // Update buckets
    for (const [bucket, count] of metric.buckets) {
      if (value <= bucket) {
        metric.buckets.set(bucket, count + 1);
      }
    }

    metric.timestamp = Date.now();
  }

  /**
   * Get metric value
   * @param {string} name
   * @param {Object} [labels]
   * @returns {number | null}
   */
  get(name, labels = {}) {
    const key = this._key(name, labels);
    const metric = this.metrics.get(key);
    return metric ? metric.value : null;
  }

  /**
   * Get all metrics snapshot
   * @returns {Object}
   */
  snapshot() {
    const result = {
      counters: {},
      gauges: {},
      histograms: {},
      timestamp: Date.now(),
    };

    for (const [key, metric] of this.metrics) {
      const entry = {
        name: metric.name,
        value: metric.value,
        labels: metric.labels,
        help: metric.help,
        timestamp: metric.timestamp,
      };

      if (metric.type === MetricType.COUNTER) {
        result.counters[key] = entry;
      } else if (metric.type === MetricType.GAUGE) {
        result.gauges[key] = entry;
      } else if (metric.type === MetricType.HISTOGRAM) {
        result.histograms[key] = {
          ...entry,
          count: metric.count,
          sum: metric.sum,
          buckets: Object.fromEntries(metric.buckets),
        };
      }
    }

    return result;
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
  }

  /**
   * Get metric names
   * @returns {string[]}
   */
  getNames() {
    const names = new Set();
    for (const metric of this.metrics.values()) {
      names.add(metric.name);
    }
    return Array.from(names);
  }
}

/**
 * Create a new metrics registry
 * @returns {MetricsRegistry}
 */
export function createMetricsRegistry() {
  return new MetricsRegistry();
}

/**
 * Global registry instance
 * @type {MetricsRegistry | null}
 */
let globalRegistry = null;

/**
 * Get or create global registry
 * @returns {MetricsRegistry}
 */
export function getMetricsRegistry() {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}

/**
 * Set global registry
 * @param {MetricsRegistry} registry
 */
export function setMetricsRegistry(registry) {
  globalRegistry = registry;
}

/**
 * Common metric names
 */
export const Metrics = {
  // Counters
  REQUESTS_TOTAL: "requests_total",
  PLUGIN_CALLS_TOTAL: "plugin_calls_total",
  JOB_EVENTS_TOTAL: "job_events_total",
  TOOL_CALLS_TOTAL: "tool_calls_total",
  ERRORS_TOTAL: "errors_total",

  // Gauges
  JOBS_RUNNING: "jobs_running",
  JOBS_QUEUED: "jobs_queued",
  PLUGINS_ENABLED: "plugins_enabled",
  TOOLS_TOTAL: "tools_total",

  // Histograms
  REQUEST_DURATION_MS: "request_duration_ms",
  JOB_DURATION_MS: "job_duration_ms",
  PLUGIN_EXECUTION_DURATION_MS: "plugin_execution_duration_ms",
  LLM_DURATION_MS: "llm_duration_ms",
  RAG_QUERY_DURATION_MS: "rag_query_duration_ms",
};
