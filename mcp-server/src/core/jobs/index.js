/**
 * Jobs System Index
 *
 * Central export point for job queue functionality.
 * Plugins can register job handlers via registerJobHandler().
 */

export {
  // Core job functions
  createJob,
  submitJob,
  getJob,
  listJobs,
  cancelJob,
  getJobLogs,
  getJobStats,
  JobState,
} from "../jobs.js";

// Re-export with clearer name for plugins
export { registerJobRunner as registerJobHandler } from "../jobs.js";
