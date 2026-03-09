/**
 * Job Types
 *
 * Type definitions for the job/queue system.
 */

/**
 * Job status enum values
 * @typedef {"queued" | "running" | "completed" | "failed" | "cancelled"} JobStatus
 */
export const JobStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Valid job statuses
 */
export const VALID_JOB_STATUSES = Object.values(JobStatus);

/**
 * @typedef {Object} Job
 * @property {string} id - Unique job ID
 * @property {string} type - Job type (e.g., "rag.index", "llm.generate")
 * @property {JobStatus} status - Current job status
 * @property {string} plugin - Plugin name responsible for this job
 * @property {string} action - Action name within plugin
 * @property {string | null} workspaceId - Workspace context
 * @property {string | null} projectId - Project context
 * @property {string | null} actor - User/actor who submitted the job
 * @property {string | null} correlationId - Correlation ID for tracing
 * @property {Object | null} input - Job input data
 * @property {Object | null} output - Job output data (on completion)
 * @property {Object | null} error - Error details (on failure)
 * @property {number} progress - Progress percentage (0-100)
 * @property {string} createdAt - ISO timestamp
 * @property {string | null} startedAt - ISO timestamp when started
 * @property {string | null} finishedAt - ISO timestamp when finished
 * @property {Object | null} metadata - Additional metadata
 */

/**
 * @typedef {Object} JobContext
 * @property {string} jobId - Job ID
 * @property {string} type - Job type
 * @property {string} plugin - Plugin name
 * @property {string} action - Action name
 * @property {string | null} workspaceId - Workspace context
 * @property {string | null} actor - Actor
 * @property {string | null} correlationId - Correlation ID
 */

/**
 * @typedef {Object} JobHandlerContext
 * @property {Job} job - Full job object
 * @property {Function} updateProgress - Update progress function
 * @property {AbortSignal} signal - Cancellation signal
 * @property {JobContext} context - Job context
 */

/**
 * @typedef {Function} JobHandler
 * @param {JobHandlerContext} ctx - Handler context
 * @returns {Promise<Object>} Job result
 */

/**
 * @typedef {Object} JobSubmitOptions
 * @property {string} type - Job type
 * @property {string} plugin - Plugin name
 * @property {string} action - Action name
 * @property {string | null} [workspaceId] - Workspace context
 * @property {string | null} [projectId] - Project context
 * @property {string | null} [actor] - Actor
 * @property {string | null} [correlationId] - Correlation ID
 * @property {Object | null} [input] - Input data
 * @property {Object | null} [metadata] - Additional metadata
 * @property {number} [priority] - Job priority (higher = more important)
 */

/**
 * @typedef {Object} JobFilter
 * @property {JobStatus | JobStatus[]} [status] - Filter by status
 * @property {string} [plugin] - Filter by plugin
 * @property {string} [type] - Filter by type
 * @property {string} [workspaceId] - Filter by workspace
 * @property {string} [actor] - Filter by actor
 */

/**
 * @typedef {Object} JobListResult
 * @property {Job[]} jobs - List of jobs
 * @property {number} total - Total count
 * @property {Object} [pagination] - Pagination info
 */

/**
 * @typedef {Object} JobEvent
 * @property {string} type - Event type
 * @property {string} jobId - Job ID
 * @property {Job} [job] - Full job object
 * @property {Object} [data] - Additional event data
 * @property {number} timestamp - Event timestamp
 */

/**
 * @typedef {Object} JobStore
 * @property {Function} createJob - Create a job
 * @property {Function} getJob - Get a job by ID
 * @property {Function} listJobs - List jobs with filters
 * @property {Function} updateJob - Update a job
 * @property {Function} deleteJob - Delete a job
 * @property {Function} clearJobs - Clear all jobs
 * @property {Function} getJobsByStatus - Get jobs by status
 * @property {Function} getJobsByWorkspace - Get jobs by workspace
 */

/**
 * @typedef {Object} JobConfig
 * @property {boolean} enabled - Whether jobs system is enabled
 * @property {number} maxConcurrency - Max concurrent jobs
 * @property {number} maxRetries - Max retries for failed jobs
 * @property {string} store - Store type ("memory" | "redis" | etc)
 * @property {number} pollInterval - Queue poll interval in ms
 */

export {};
