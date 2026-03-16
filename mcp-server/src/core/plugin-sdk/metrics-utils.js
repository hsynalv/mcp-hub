/**
 * Plugin SDK - Metrics Utilities
 *
 * Optional metrics integration for plugin operations.
 */

/**
 * Record a tool/plugin call for metrics (if observability is available).
 * @param {string} toolName - Tool or operation name
 * @param {string} pluginName - Plugin identifier
 * @param {string} status - "success" | "error"
 * @param {number} [durationMs] - Duration in milliseconds
 */
export function recordPluginMetric(toolName, pluginName, status = "success", durationMs = 0) {
  try {
    import("../observability/index.js").then(({ recordToolCall }) => {
      recordToolCall(toolName, pluginName, status, durationMs);
    }).catch(() => {});
  } catch {
    /* observability optional */
  }
}

/**
 * Wrap an async handler with timing metrics.
 * @param {string} pluginName - Plugin name
 * @param {string} operation - Operation name
 * @param {Function} fn - async (...args) => result
 * @returns {Function} Wrapped function
 */
export function withMetrics(pluginName, operation, fn) {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      recordPluginMetric(operation, pluginName, "success", Date.now() - start);
      return result;
    } catch (err) {
      recordPluginMetric(operation, pluginName, "error", Date.now() - start);
      throw err;
    }
  };
}
