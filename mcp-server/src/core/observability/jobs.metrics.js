/**
 * Job queue gauges — sourced from core/jobs.js `getJobStats` (Redis HASH/set/zset or in-memory Map).
 *
 * Counters/histograms for lifecycle phases are derived only from hub audit events
 * (emitJobLifecycleHubEvent → recordMetricFromHubEvent). Gauges here intentionally mirror
 * store state only — do not re-emit or duplicate lifecycle counters in this module.
 */

import { getJobStats as getCoreQueueJobStats } from "../jobs.js";
import { Metrics, getMetricsRegistry } from "./metrics.js";

/**
 * @deprecated Dead no-op — lifecycle counters/histograms use hub events only
 * (`recordMetricFromHubEvent` → `job_lifecycle_events_total` / `job_duration_ms`). Do not call.
 */
export function recordJobEvent(_jobType, _status, _plugin) {}

/**
 * @deprecated Dead no-op — durations recorded via hub `job_duration_ms`. Do not call.
 */
export function recordJobDuration(_jobType, _durationMs, _plugin) {}

/**
 * @param {number} running
 * @param {number} queued
 */
export function updateJobGauges(running, queued) {
  const registry = getMetricsRegistry();
  registry.set(Metrics.JOBS_RUNNING, running);
  registry.set(Metrics.JOBS_QUEUED, queued);
}

/**
 * Snapshot of job queue state (core jobs.js — production path).
 * @returns {Promise<Object>}
 */
export async function getJobMetrics() {
  const stats = await getCoreQueueJobStats();
  return {
    jobs_running: stats.running,
    jobs_queued: stats.queued,
    jobs_completed: stats.completed,
    jobs_failed: stats.failed,
    jobs_cancelled: stats.cancelled ?? 0,
    jobs_total: stats.total,
  };
}

/**
 * Refresh running/queued gauges from the core job store.
 */
export async function syncJobMetrics() {
  const stats = await getCoreQueueJobStats();
  updateJobGauges(stats.running, stats.queued);
}

/**
 * Initialize job gauges
 */
export function initializeJobMetrics() {
  const registry = getMetricsRegistry();
  registry.set(Metrics.JOBS_RUNNING, 0);
  registry.set(Metrics.JOBS_QUEUED, 0);
}
