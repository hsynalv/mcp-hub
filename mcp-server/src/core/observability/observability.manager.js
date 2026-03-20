/**
 * Observability Manager
 *
 * Central observability orchestrator - manages metrics, traces, and runtime stats.
 */

import {
  MetricsRegistry,
  createMetricsRegistry,
  getMetricsRegistry,
  setMetricsRegistry,
  Metrics,
  MetricType,
  exportMetricsRegistryPrometheus,
} from "./metrics.js";

import {
  generateCorrelationId,
  generateSpanId,
  generateTraceId,
  extractTraceContext,
  createChildContext,
  contextToHeaders,
  withTraceContext,
  getCurrentTraceContext,
  traced,
  addTraceToLog,
} from "./tracing.js";

import {
  getRuntimeStats,
  getProcessStats,
  getMemoryStats,
  getPluginStats,
  getJobStats,
  getToolStats,
  getSystemSnapshot,
  getHealthStatus,
} from "./runtime.stats.js";

import {
  recordPluginCall,
  getPluginMetrics,
  syncPluginMetrics,
} from "./plugin.metrics.js";

import {
  recordJobEvent,
  recordJobDuration,
  updateJobGauges,
  getJobMetrics,
  syncJobMetrics,
} from "./jobs.metrics.js";

import {
  recordToolCall,
  recordLLMCall,
  recordRAGQuery,
  getToolMetrics,
  syncToolMetrics,
} from "./tools.metrics.js";

/**
 * Observability Manager
 * Central orchestrator for all observability concerns
 */
export class ObservabilityManager {
  /**
   * @param {Object} [options]
   * @param {MetricsRegistry} [options.metricsRegistry]
   */
  constructor(options = {}) {
    this.metrics = options.metricsRegistry || getMetricsRegistry();
    this.startedAt = Date.now();
    this.initialized = false;
  }

  /**
   * Initialize observability
   */
  init() {
    if (this.initialized) return;

    // Initialize metrics
    this.metrics.set("observability_started_at", this.startedAt);

    this.initialized = true;
  }

  // ==================== Metrics API ====================

  /**
   * Increment a counter
   * @param {string} name
   * @param {number} [value]
   * @param {Object} [labels]
   */
  incrementCounter(name, value = 1, labels = {}) {
    this.metrics.increment(name, value, labels);
  }

  /**
   * Set a gauge value
   * @param {string} name
   * @param {number} value
   * @param {Object} [labels]
   */
  setGauge(name, value, labels = {}) {
    this.metrics.set(name, value, labels);
  }

  /**
   * Observe a duration/value
   * @param {string} name
   * @param {number} value
   * @param {Object} [labels]
   */
  observeDuration(name, value, labels = {}) {
    this.metrics.observe(name, value, labels);
  }

  /**
   * Get metrics snapshot
   * @returns {Object}
   */
  getMetricsSnapshot() {
    return this.metrics.snapshot();
  }

  // ==================== Tracing API ====================

  /**
   * Generate correlation ID
   * @returns {string}
   */
  generateCorrelationId() {
    return generateCorrelationId();
  }

  /**
   * Extract trace context from request
   * @param {Object} req
   * @returns {import("./tracing.js").TraceContext}
   */
  extractTraceContext(req) {
    return extractTraceContext(req);
  }

  /**
   * Execute with trace context
   * @param {import("./tracing.js").TraceContext} context
   * @param {Function} fn
   * @returns {any}
   */
  withTraceContext(context, fn) {
    return withTraceContext(context, fn);
  }

  /**
   * Get current trace context
   * @returns {import("./tracing.js").TraceContext | undefined}
   */
  getCurrentTraceContext() {
    return getCurrentTraceContext();
  }

  /**
   * Create traced function wrapper
   * @param {Function} fn
   * @param {string} [operationName]
   * @returns {Function}
   */
  traced(fn, operationName) {
    return traced(fn, operationName);
  }

  // ==================== Runtime Stats API ====================

  /**
   * Get runtime snapshot
   * @returns {Object}
   */
  getRuntimeSnapshot() {
    return getRuntimeStats();
  }

  /**
   * Get system snapshot
   * @returns {Promise<Object>}
   */
  async getSystemSnapshot() {
    return getSystemSnapshot();
  }

  /**
   * Get health status
   * @returns {Object}
   */
  getHealthStatus() {
    return getHealthStatus();
  }

  // ==================== Plugin Metrics API ====================

  /**
   * Record plugin call
   * @param {string} pluginName
   * @param {string} action
   * @param {string} status
   * @param {number} [duration]
   */
  recordPluginCall(pluginName, action, status, duration) {
    recordPluginCall(pluginName, action, status, duration);
  }

  /**
   * Get plugin metrics
   * @returns {Object}
   */
  getPluginMetrics() {
    return getPluginMetrics();
  }

  // ==================== Job Metrics API ====================

  /**
   * @deprecated Lifecycle counters come from hub events (emitJobLifecycleHubEvent). No-op.
   */
  recordJobEvent(jobType, status, plugin) {
    recordJobEvent(jobType, status, plugin);
  }

  /**
   * @deprecated Durations recorded via job.completed / job.failed / job.cancelled hub events. No-op.
   */
  recordJobDuration(jobType, durationMs, plugin) {
    recordJobDuration(jobType, durationMs, plugin);
  }

  /**
   * Get job metrics
   * @returns {Promise<Object>}
   */
  async getJobMetrics() {
    return getJobMetrics();
  }

  // ==================== Tool Metrics API ====================

  /**
   * Record tool call
   * @param {string} toolName
   * @param {string} plugin
   * @param {string} status
   * @param {number} [duration]
   */
  recordToolCall(toolName, plugin, status, duration) {
    recordToolCall(toolName, plugin, status, duration);
  }

  /**
   * Record LLM call
   * @param {string} provider
   * @param {string} model
   * @param {number} durationMs
   * @param {string} status
   */
  recordLLMCall(provider, model, durationMs, status) {
    recordLLMCall(provider, model, durationMs, status);
  }

  /**
   * Record RAG query
   * @param {string} operation
   * @param {number} durationMs
   * @param {string} status
   */
  recordRAGQuery(operation, durationMs, status) {
    recordRAGQuery(operation, durationMs, status);
  }

  /**
   * Get tool metrics
   * @returns {Object}
   */
  getToolMetrics() {
    return getToolMetrics();
  }

  // ==================== Export API ====================

  /**
   * Export metrics as JSON
   * @returns {Object}
   */
  exportMetricsJSON() {
    return this.metrics.snapshot();
  }

  /**
   * Export metrics as Prometheus text (same helper as GET `/observability/metrics` hub section).
   * @returns {string}
   */
  exportMetricsPrometheus() {
    return exportMetricsRegistryPrometheus(this.metrics);
  }

  /**
   * Get complete observability snapshot
   * @returns {Promise<Object>}
   */
  async getFullSnapshot() {
    const [system, jobs] = await Promise.all([
      getSystemSnapshot(),
      getJobMetrics(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      metrics: this.metrics.snapshot(),
      runtime: system.runtime,
      plugins: system.plugins,
      jobs,
      tools: system.tools,
      health: getHealthStatus(),
    };
  }
}

/**
 * Create observability manager
 * @param {Object} [options]
 * @returns {ObservabilityManager}
 */
export function createObservabilityManager(options = {}) {
  return new ObservabilityManager(options);
}

/**
 * Global manager instance
 * @type {ObservabilityManager | null}
 */
let globalManager = null;

/**
 * Get or create global manager
 * @returns {ObservabilityManager}
 */
export function getObservabilityManager() {
  if (!globalManager) {
    globalManager = new ObservabilityManager();
    globalManager.init();
  }
  return globalManager;
}

/**
 * Set global manager
 * @param {ObservabilityManager} manager
 */
export function setObservabilityManager(manager) {
  globalManager = manager;
}
