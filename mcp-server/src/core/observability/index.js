/**
 * Observability Module
 *
 * Central observability exports for MCP-Hub platform.
 */

// Metrics
export {
  MetricsRegistry,
  createMetricsRegistry,
  getMetricsRegistry,
  setMetricsRegistry,
  Metrics,
  MetricType,
} from "./metrics.js";

// Tracing
export {
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
  isValidTraceContext,
  formatTraceContext,
} from "./tracing.js";

// Runtime Stats
export {
  getRuntimeStats,
  getProcessStats,
  getMemoryStats,
  getCPUStats,
  getEventLoopStats,
  getResourceLimits,
  getPluginStats,
  getJobStats,
  getToolStats,
  getSystemSnapshot,
  getHealthStatus,
} from "./runtime.stats.js";

// Plugin Metrics
export {
  recordPluginCall,
  getPluginMetrics,
  syncPluginMetrics,
} from "./plugin.metrics.js";

// Job Metrics
export {
  recordJobEvent,
  recordJobDuration,
  updateJobGauges,
  getJobMetrics,
  syncJobMetrics,
} from "./jobs.metrics.js";

// Tool Metrics
export {
  recordToolCall,
  recordLLMCall,
  recordRAGQuery,
  getToolMetrics,
  syncToolMetrics,
} from "./tools.metrics.js";

// Observability Manager
export {
  ObservabilityManager,
  createObservabilityManager,
  getObservabilityManager,
  setObservabilityManager,
} from "./observability.manager.js";
