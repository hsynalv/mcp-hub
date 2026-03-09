/**
 * Jobs Metrics
 *
 * Metrics collection for jobs/queue system.
 */

import { getJobManager } from "../jobs/job.manager.js";
import { Metrics, getMetricsRegistry } from "./metrics.js";

/**
 * Record job event
 * @param {string} jobType
 * @param {string} status - "queued" | "started" | "completed" | "failed" | "cancelled"
 * @param {string} [plugin]
 */
export function recordJobEvent(jobType, status, plugin) {
  const registry = getMetricsRegistry();

  registry.increment(Metrics.JOB_EVENTS_TOTAL, 1, {
    jobType,
    status,
    plugin: plugin || "unknown",
  });

  // Update specific counters
  if (status === "completed") {
    registry.increment("job_completed_total", 1, { jobType });
  } else if (status === "failed") {
    registry.increment("job_failed_total", 1, { jobType });
  } else if (status === "cancelled") {
    registry.increment("job_cancelled_total", 1, { jobType });
  }
}

/**
 * Record job duration
 * @param {string} jobType
 * @param {number} durationMs
 * @param {string} [plugin]
 */
export function recordJobDuration(jobType, durationMs, plugin) {
  const registry = getMetricsRegistry();

  registry.observe(Metrics.JOB_DURATION_MS, durationMs, {
    jobType,
    plugin: plugin || "unknown",
  });
}

/**
 * Update job gauges
 * @param {number} running
 * @param {number} queued
 */
export function updateJobGauges(running, queued) {
  const registry = getMetricsRegistry();

  registry.set(Metrics.JOBS_RUNNING, running);
  registry.set(Metrics.JOBS_QUEUED, queued);
}

/**
 * Get job metrics snapshot
 * @returns {Promise<Object>}
 */
export async function getJobMetrics() {
  const manager = getJobManager();
  const counts = await manager.getJobCounts();

  return {
    jobs_running: counts.running,
    jobs_queued: counts.queued,
    jobs_completed: counts.completed,
    jobs_failed: counts.failed,
    jobs_cancelled: counts.cancelled,
    jobs_total: counts.total,
  };
}

/**
 * Sync job metrics with job manager
 */
export async function syncJobMetrics() {
  const manager = getJobManager();
  const counts = await manager.getJobCounts();

  updateJobGauges(counts.running, counts.queued);
}

/**
 * Initialize job metrics
 */
export function initializeJobMetrics() {
  const registry = getMetricsRegistry();

  // Initialize gauges
  registry.set(Metrics.JOBS_RUNNING, 0);
  registry.set(Metrics.JOBS_QUEUED, 0);
}
