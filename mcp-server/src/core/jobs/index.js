/**
 * Jobs System Index
 *
 * Production job execution: `../jobs.js` (submitJob, registerJobRunner).
 * This folder holds an alternate in-memory JobManager implementation used only by unit tests.
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

// @deprecated Alternate job subsystem — use `../jobs.js` for production / hub telemetry.
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
