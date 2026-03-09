/**
 * Plugin Metrics
 *
 * Metrics collection for plugin system.
 */

import { getRegistry } from "../registry/index.js";
import { Metrics, getMetricsRegistry } from "./metrics.js";

/**
 * Record plugin call
 * @param {string} pluginName
 * @param {string} action
 * @param {string} status - "success" | "error"
 * @param {number} [duration]
 */
export function recordPluginCall(pluginName, action, status, duration) {
  const registry = getMetricsRegistry();

  // Increment plugin calls counter
  registry.increment(Metrics.PLUGIN_CALLS_TOTAL, 1, {
    plugin: pluginName,
    action,
    status,
  });

  // Record duration if provided
  if (duration !== undefined) {
    registry.observe(Metrics.PLUGIN_EXECUTION_DURATION_MS, duration, {
      plugin: pluginName,
      action,
    });
  }

  // Increment errors counter if failed
  if (status === "error") {
    registry.increment(Metrics.ERRORS_TOTAL, 1, {
      type: "plugin",
      plugin: pluginName,
      action,
    });
  }
}

/**
 * Update plugin gauge
 * @param {string} pluginName
 * @param {boolean} enabled
 */
export function updatePluginGauge(pluginName, enabled) {
  const registry = getMetricsRegistry();
  // This is tracked globally via getPluginStats
  // Individual plugin enablement tracked via labels if needed
}

/**
 * Get plugin metrics snapshot
 * @returns {Object}
 */
export function getPluginMetrics() {
  const registry = getRegistry();
  const status = registry.getStatus();

  return {
    plugins_enabled: status.enabled,
    plugins_total: status.total,
    plugins_healthy: status.healthy,
    plugins_failed: status.failed,
    plugins_loaded: status.loaded,
  };
}

/**
 * Initialize plugin metrics gauges
 */
export function initializePluginMetrics() {
  const metrics = getMetricsRegistry();

  // Set initial gauge values
  metrics.set(Metrics.PLUGINS_ENABLED, 0);
  metrics.set(Metrics.TOOLS_TOTAL, 0);
}

/**
 * Sync plugin metrics with registry
 */
export function syncPluginMetrics() {
  const registry = getRegistry();
  const metrics = getMetricsRegistry();
  const status = registry.getStatus();

  metrics.set(Metrics.PLUGINS_ENABLED, status.enabled);
}
