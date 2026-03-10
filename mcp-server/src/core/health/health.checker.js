/**
 * Health Checker
 *
 * Health check runner with timeout handling and retry logic.
 */

import { HealthStatus } from "./health.types.js";

/**
 * Default check timeout in ms
 */
const DEFAULT_TIMEOUT = 5000;

/**
 * Default max retries
 */
const DEFAULT_MAX_RETRIES = 2;

/**
 * Default retry delay in ms
 */
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Run health check with timeout
 * @param {Function} checkFn - Health check function
 * @param {string} name - Plugin/service name
 * @param {Object} [context] - Check context
 * @param {number} [timeout] - Timeout in ms
 * @returns {Promise<import("./health.types.js").HealthCheckResult>}
 */
export async function runHealthCheck(checkFn, name, context = {}, timeout = DEFAULT_TIMEOUT) {
  const startTime = Date.now();

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timed out after ${timeout}ms`));
      }, timeout);
    });

    // Run check with timeout
    const result = await Promise.race([
      checkFn(context),
      timeoutPromise,
    ]);

    const responseTime = Date.now() - startTime;

    // Normalize result
    const status = normalizeStatus(result?.status);

    return {
      name,
      status,
      message: result?.message || getDefaultMessage(status),
      timestamp: Date.now(),
      responseTime,
      checks: result?.checks,
      dependencies: result?.dependencies || [],
    };
  } catch (err) {
    return {
      name,
      status: HealthStatus.UNHEALTHY,
      message: err.message,
      timestamp: Date.now(),
      responseTime: Date.now() - startTime,
      error: err,
    };
  }
}

/**
 * Run health check with retries
 * @param {Function} checkFn - Health check function
 * @param {string} name - Plugin/service name
 * @param {Object} [context] - Check context
 * @param {import("./health.types.js").HealthCheckOptions} [options]
 * @returns {Promise<import("./health.types.js").HealthCheckResult>}
 */
export async function runHealthCheckWithRetry(
  checkFn,
  name,
  context = {},
  options = {}
) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  let lastResult = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await runHealthCheck(checkFn, name, context, timeout);
    lastResult = result;

    // If healthy, return immediately
    if (result.status === HealthStatus.HEALTHY) {
      if (attempt > 0) {
        result.message = `${result.message} (recovered after ${attempt} retries)`;
      }
      return result;
    }

    // If not the last attempt, wait before retrying
    if (attempt < maxRetries) {
      await delay(retryDelay * (attempt + 1)); // Exponential backoff
    }
  }

  return lastResult;
}

/**
 * Run multiple health checks
 * @param {Array<{name: string, checkFn: Function, context?: Object}>} checks
 * @param {import("./health.types.js").HealthCheckOptions} [options]
 * @returns {Promise<import("./health.types.js").HealthCheckResult[]>}
 */
export async function runHealthChecks(checks, options = {}) {
  const parallel = options.parallel ?? true;

  if (parallel) {
    // Run all checks in parallel
    const promises = checks.map(check =>
      runHealthCheckWithRetry(
        check.checkFn,
        check.name,
        check.context || {},
        options
      )
    );

    return Promise.all(promises);
  } else {
    // Run checks sequentially
    const results = [];
    for (const check of checks) {
      const result = await runHealthCheckWithRetry(
        check.checkFn,
        check.name,
        check.context || {},
        options
      );
      results.push(result);
    }
    return results;
  }
}

/**
 * Normalize health status string
 * @param {string} [status]
 * @returns {HealthStatus}
 */
function normalizeStatus(status) {
  if (!status) return HealthStatus.UNKNOWN;

  const normalized = status.toLowerCase().trim();

  switch (normalized) {
    case "healthy":
    case "ok":
    case "good":
    case "up":
      return HealthStatus.HEALTHY;
    case "degraded":
    case "warning":
    case "slow":
      return HealthStatus.DEGRADED;
    case "unhealthy":
    case "error":
    case "bad":
    case "down":
    case "failed":
      return HealthStatus.UNHEALTHY;
    default:
      return HealthStatus.UNKNOWN;
  }
}

/**
 * Get default message for status
 * @param {HealthStatus} status
 * @returns {string}
 */
function getDefaultMessage(status) {
  switch (status) {
    case HealthStatus.HEALTHY:
      return "Service is healthy";
    case HealthStatus.DEGRADED:
      return "Service is degraded";
    case HealthStatus.UNHEALTHY:
      return "Service is unhealthy";
    default:
      return "Unknown status";
  }
}

/**
 * Delay promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate overall health status from individual results
 * @param {import("./health.types.js").HealthCheckResult[]} results
 * @returns {HealthStatus}
 */
export function calculateOverallStatus(results) {
  if (results.length === 0) {
    return HealthStatus.UNKNOWN;
  }

  const hasUnhealthy = results.some(r => r.status === HealthStatus.UNHEALTHY);
  const hasDegraded = results.some(r => r.status === HealthStatus.DEGRADED);
  const hasUnknown = results.some(r => r.status === HealthStatus.UNKNOWN);

  if (hasUnhealthy) {
    return HealthStatus.UNHEALTHY;
  }

  if (hasDegraded) {
    return HealthStatus.DEGRADED;
  }

  if (hasUnknown) {
    return HealthStatus.DEGRADED;
  }

  return HealthStatus.HEALTHY;
}

/**
 * Check if status is worse than another
 * @param {HealthStatus} status1
 * @param {HealthStatus} status2
 * @returns {boolean}
 */
export function isStatusWorse(status1, status2) {
  const severity = {
    [HealthStatus.HEALTHY]: 0,
    [HealthStatus.UNKNOWN]: 1,
    [HealthStatus.DEGRADED]: 2,
    [HealthStatus.UNHEALTHY]: 3,
  };

  return severity[status1] > severity[status2];
}
