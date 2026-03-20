/**
 * Runtime Stats
 *
 * Process/plugin/tool/job snapshots for JSON health APIs. Prometheus scrape uses
 * `/observability/metrics` → `exportMetricsRegistryPrometheus()` (hub registry) plus process/legacy lines;
 * this module is not the Prometheus source of truth.
 */

import { getPlugins, getFailedPlugins } from "../plugins.js";
import { getToolStats as getToolRegistryStats } from "../tool-registry.js";
import { getJobStats as getCoreQueueJobStats } from "../jobs.js";

/**
 * Process stats
 * @returns {Object}
 */
export function getProcessStats() {
  return {
    pid: process.pid,
    ppid: process.ppid,
    title: process.title,
    version: process.version,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    cwd: process.cwd(),
    uptime: process.uptime(),
  };
}

/**
 * Memory usage stats
 * @returns {Object}
 */
export function getMemoryStats() {
  const mem = process.memoryUsage();

  return {
    rss: formatBytes(mem.rss),
    rssBytes: mem.rss,
    heapTotal: formatBytes(mem.heapTotal),
    heapTotalBytes: mem.heapTotal,
    heapUsed: formatBytes(mem.heapUsed),
    heapUsedBytes: mem.heapUsed,
    external: formatBytes(mem.external),
    externalBytes: mem.external || 0,
    arrayBuffers: formatBytes(mem.arrayBuffers),
    arrayBuffersBytes: mem.arrayBuffers || 0,
  };
}

/**
 * CPU usage (if available)
 * @returns {Object | null}
 */
export function getCPUStats() {
  if (process.cpuUsage) {
    const usage = process.cpuUsage();
    return {
      user: usage.user,
      system: usage.system,
    };
  }
  return null;
}

/**
 * Event loop stats (if available)
 * @returns {Object | null}
 */
export function getEventLoopStats() {
  // Node.js 18.10+ has performance.eventLoopUtilization
  // eslint-disable-next-line no-undef
  if (typeof performance !== "undefined" && performance.eventLoopUtilization) {
    try {
      const elu = performance.eventLoopUtilization();
      return {
        utilization: elu.utilization,
        idle: elu.idle,
        active: elu.active,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resource limits
 * @returns {Object}
 */
export function getResourceLimits() {
  return {
    maxOldGenerationSize: process.memoryUsage().heapTotal,
  };
}

/**
 * Format bytes to human readable
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get runtime stats snapshot
 * @returns {Object}
 */
export function getRuntimeStats() {
  return {
    timestamp: new Date().toISOString(),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: getMemoryStats(),
    cpu: getCPUStats(),
    eventLoop: getEventLoopStats(),
  };
}

/**
 * Format uptime to human readable
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Get plugin stats
 * @returns {Object}
 */
export function getPluginStats() {
  const loaded = getPlugins();
  const failed = getFailedPlugins();

  return {
    total: loaded.length + failed.length,
    enabled: loaded.length,
    loaded: loaded.length,
    healthy: loaded.length,
    failed: failed.length,
    pluginNames: loaded.map((p) => p.name),
  };
}

/**
 * Job counts by state — always core/jobs.js (production queue); not the legacy JobManager store.
 * @returns {Promise<Object>}
 */
export async function getJobStats() {
  return getCoreQueueJobStats();
}

/**
 * Get tool stats
 * @returns {Object}
 */
export function getToolStats() {
  return getToolRegistryStats();
}

/**
 * Get complete system snapshot
 * @returns {Promise<Object>}
 */
export async function getSystemSnapshot() {
  return {
    timestamp: new Date().toISOString(),
    runtime: getRuntimeStats(),
    plugins: getPluginStats(),
    jobs: await getJobStats(),
    tools: getToolStats(),
  };
}

/**
 * Health check status
 * @returns {Object}
 */
export function getHealthStatus() {
  const pluginStats = getPluginStats();

  // Determine overall health
  let status_code = "healthy";
  const checks = {
    runtime: true,
    plugins: pluginStats.failed === 0,
    registry: pluginStats.total > 0,
  };

  if (pluginStats.failed > 0) {
    status_code = "degraded";
  }

  if (pluginStats.total === 0) {
    status_code = "unhealthy";
  }

  return {
    status: status_code,
    checks,
    timestamp: new Date().toISOString(),
  };
}
