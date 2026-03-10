/**
 * Health Types
 *
 * Type definitions for the health monitoring service.
 */

/**
 * Health status values
 * @typedef {"healthy" | "degraded" | "unhealthy" | "unknown"} HealthStatus
 */
export const HealthStatus = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
  UNKNOWN: "unknown",
};

/**
 * @typedef {Object} HealthCheckResult
 * @property {string} name - Plugin/service name
 * @property {HealthStatus} status - Health status
 * @property {string} [message] - Optional status message
 * @property {number} timestamp - Check timestamp (ms)
 * @property {number} [responseTime] - Response time in ms
 * @property {Object} [checks] - Detailed check results
 * @property {string[]} [dependencies] - Plugin dependencies
 * @property {Error} [error] - Error if check failed
 */

/**
 * @typedef {Object} PluginHealth
 * @property {string} name - Plugin name
 * @property {string} version - Plugin version
 * @property {HealthStatus} status - Current health status
 * @property {number} lastCheck - Last check timestamp
 * @property {number} [responseTime] - Last response time
 * @property {string} [message] - Status message
 * @property {number} consecutiveFailures - Consecutive failure count
 * @property {string[]} dependencies - Plugin dependencies
 * @property {boolean} enabled - Whether plugin is enabled
 */

/**
 * @typedef {Object} ServiceHealth
 * @property {HealthStatus} status - Overall service status
 * @property {number} timestamp - Check timestamp
 * @property {Object} summary - Health summary
 * @property {number} summary.total - Total plugins
 * @property {number} summary.healthy - Healthy plugins
 * @property {number} summary.degraded - Degraded plugins
 * @property {number} summary.unhealthy - Unhealthy plugins
 * @property {number} summary.unknown - Unknown status plugins
 * @property {PluginHealth[]} plugins - Per-plugin health
 */

/**
 * @typedef {Object} HealthCheckOptions
 * @property {number} [timeout] - Check timeout in ms
 * @property {boolean} [parallel] - Run checks in parallel
 * @property {number} [maxRetries] - Max retry attempts
 * @property {number} [retryDelay] - Delay between retries
 */

/**
 * @typedef {Object} HealthServiceConfig
 * @property {number} [checkInterval] - Health check interval in ms
 * @property {number} [checkTimeout] - Per-check timeout in ms
 * @property {number} [maxHistory] - Max health history entries
 * @property {boolean} [autoStart] - Auto-start monitoring
 * @property {boolean} [trackDependencies] - Track plugin dependencies
 */

/**
 * @typedef {Object} DependencyGraph
 * @property {Map<string, string[]>} dependencies - Plugin dependencies
 * @property {Map<string, string[]>} dependents - Plugins that depend on each plugin
 */

export {};
