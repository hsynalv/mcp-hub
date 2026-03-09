/**
 * Jobs System Index
 *
 * Central export point for job queue functionality.
 * Plugins can register job handlers via registerJobHandler().
 */

// Core types
export { JobStatus, VALID_JOB_STATUSES } from "./job.types.js";

// Store
export { JobStore, createJobStore, getJobStore, setJobStore } from "./job.store.js";

// Events
export { JobEventEmitter, JobEventType, getJobEventEmitter, setJobEventEmitter } from "./job.events.js";

// Queue
export { JobQueue, createJobQueue } from "./job.queue.js";

// Worker
export { JobWorker, createJobWorker } from "./job.worker.js";

// Manager - primary interface
export { JobManager, createJobManager, getJobManager, setJobManager } from "./job.manager.js";

// Legacy exports for backward compatibility
export {
  createJob,
  submitJob,
  getJob,
  listJobs,
  cancelJob,
  getJobLogs,
  getJobStats,
  JobState,
} from "../jobs.js";

export { registerJobRunner as registerJobHandler } from "../jobs.js";
