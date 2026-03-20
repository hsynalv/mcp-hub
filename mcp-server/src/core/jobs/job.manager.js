/**
 * Job Manager (alternate / in-memory subsystem)
 *
 * @deprecated Production and observability use `src/core/jobs.js` + hub lifecycle events.
 *             Kept for `jobs.test.js` and incremental migration only — do not wire new features here.
 */

import { JobStatus, VALID_JOB_STATUSES } from "./job.types.js";
import { JobStore, getJobStore } from "./job.store.js";
import { JobQueue, createJobQueue } from "./job.queue.js";
import { JobWorker, createJobWorker } from "./job.worker.js";
import { JobEventEmitter, getJobEventEmitter } from "./job.events.js";

/**
 * Job Manager configuration
 */
const DEFAULT_CONFIG = {
  enabled: true,
  maxConcurrency: 2,
  maxRetries: 1,
  store: "memory",
  pollInterval: 1000,
};

/**
 * Get config from environment
 * @returns {Object}
 */
function getConfigFromEnv() {
  return {
    enabled: process.env.JOBS_ENABLED !== "false",
    maxConcurrency: parseInt(process.env.JOBS_MAX_CONCURRENCY, 10) || DEFAULT_CONFIG.maxConcurrency,
    maxRetries: parseInt(process.env.JOBS_MAX_RETRIES, 10) || DEFAULT_CONFIG.maxRetries,
    store: process.env.JOBS_STORE || DEFAULT_CONFIG.store,
    pollInterval: parseInt(process.env.JOBS_POLL_INTERVAL, 10) || DEFAULT_CONFIG.pollInterval,
  };
}

/**
 * Job Manager
 */
export class JobManager {
  /**
   * @param {Object} [options]
   * @param {JobStore} [options.store]
   * @param {JobEventEmitter} [options.emitter]
   * @param {Object} [options.config]
   */
  constructor(options = {}) {
    this.store = options.store || getJobStore();
    this.emitter = options.emitter || getJobEventEmitter();
    this.config = { ...DEFAULT_CONFIG, ...getConfigFromEnv(), ...options.config };

    this.queue = createJobQueue({ store: this.store });
    this.workers = [];
    this.handlers = new Map();
    this.running = false;
    this.pollTimer = null;
  }

  /**
   * Register a job handler
   * @param {string} type - Job type (e.g., "rag.index")
   * @param {import("./job.types.js").JobHandler} handler
   */
  registerHandler(type, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Handler for ${type} must be a function`);
    }
    this.handlers.set(type, handler);
  }

  /**
   * Unregister a job handler
   * @param {string} type
   */
  unregisterHandler(type) {
    this.handlers.delete(type);
  }

  /**
   * Submit a new job
   * @param {string} type - Job type
   * @param {Object} input - Job input
   * @param {Object} [context] - Job context
   * @param {string} [context.plugin]
   * @param {string} [context.action]
   * @param {string} [context.workspaceId]
   * @param {string} [context.projectId]
   * @param {string} [context.actor]
   * @param {string} [context.correlationId]
   * @param {Object} [context.metadata]
   * @param {number} [context.priority]
   * @returns {Promise<import("./job.types.js").Job>}
   */
  async submitJob(type, input, context = {}) {
    if (!this.config.enabled) {
      throw new Error("Job system is disabled");
    }

    // Parse type to plugin/action if not provided
    const [plugin, action] = type.split(".");

    const job = await this.store.createJob({
      type,
      plugin: context.plugin || plugin,
      action: context.action || action,
      workspaceId: context.workspaceId || null,
      projectId: context.projectId || null,
      actor: context.actor || null,
      correlationId: context.correlationId || null,
      input,
      metadata: context.metadata || null,
      priority: context.priority || 0,
    });

    // Emit created event
    this.emitter.emitCreated(job);

    return job;
  }

  /**
   * Get a job by ID
   * @param {string} jobId
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async getJob(jobId) {
    return this.store.getJob(jobId);
  }

  /**
   * List jobs with filters
   * @param {import("./job.types.js").JobFilter} [filters]
   * @param {Object} [options]
   * @returns {Promise<import("./job.types.js").JobListResult>}
   */
  async listJobs(filters = {}, options = {}) {
    return this.store.listJobs(filters, options);
  }

  /**
   * Cancel a job
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async cancelJob(jobId) {
    const job = await this.store.getJob(jobId);
    if (!job) return false;

    // Can only cancel queued or running jobs
    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.RUNNING) {
      return false;
    }

    // If running, cancel the worker
    if (job.status === JobStatus.RUNNING) {
      const worker = this.workers.find(w => w.getCurrentJob()?.id === jobId);
      if (worker) {
        worker.cancel();
      }
    }

    // Update job status
    const finishedAt = new Date().toISOString();
    await this.store.updateJob(jobId, {
      status: JobStatus.CANCELLED,
      finishedAt,
    });

    // Emit cancelled event
    const updatedJob = await this.store.getJob(jobId);
    this.emitter.emitCancelled(updatedJob);

    return true;
  }

  /**
   * Retry a failed job
   * @param {string} jobId
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async retryJob(jobId) {
    const job = await this.store.getJob(jobId);
    if (!job) return null;

    // Can only retry failed jobs
    if (job.status !== JobStatus.FAILED && job.status !== JobStatus.CANCELLED) {
      return null;
    }

    // Reset job status
    const updated = await this.store.updateJob(jobId, {
      status: JobStatus.QUEUED,
      progress: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      output: null,
    });

    // Emit created event (retry)
    this.emitter.emitCreated(updated);

    return updated;
  }

  /**
   * Delete a job
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async deleteJob(jobId) {
    return this.store.deleteJob(jobId);
  }

  /**
   * Start processing jobs
   */
  startProcessing() {
    if (this.running || !this.config.enabled) return;

    this.running = true;
    this.queue.resume();
    this.poll();
  }

  /**
   * Stop processing jobs
   */
  stopProcessing() {
    this.running = false;
    this.queue.pause();

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel running workers
    this.workers.forEach(w => w.cancel());
    this.workers = [];
  }

  /**
   * Poll for new jobs
   * @private
   */
  async poll() {
    if (!this.running) return;

    // Check if we have capacity
    const runningWorkers = this.workers.filter(w => w.isRunning()).length;
    const availableSlots = this.config.maxConcurrency - runningWorkers;

    if (availableSlots > 0) {
      // Process jobs up to available slots
      for (let i = 0; i < availableSlots; i++) {
        const job = await this.queue.dequeue();
        if (!job) break;

        this.processJob(job);
      }
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval);
  }

  /**
   * Process a single job
   * @private
   * @param {import("./job.types.js").Job} job
   */
  async processJob(job) {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      // No handler - mark as failed
      await this.store.updateJob(job.id, {
        status: JobStatus.FAILED,
        error: {
          message: `No handler registered for job type: ${job.type}`,
          code: "NO_HANDLER",
        },
        finishedAt: new Date().toISOString(),
      });

      const updated = await this.store.getJob(job.id);
      this.emitter.emitFailed(updated, new Error("No handler"));
      return;
    }

    // Create worker
    const worker = createJobWorker({
      store: this.store,
      emitter: this.emitter,
    });

    this.workers.push(worker);

    try {
      await worker.execute(job, handler);
    } catch (err) {
      // Error already handled by worker
      console.error(`Job ${job.id} failed:`, err.message);
    } finally {
      // Remove worker from list
      const index = this.workers.indexOf(worker);
      if (index > -1) {
        this.workers.splice(index, 1);
      }
    }
  }

  /**
   * Get job counts by status
   * @returns {Promise<Object>}
   */
  async getJobCounts() {
    return this.store.getJobCounts();
  }

  /**
   * Check if manager is running
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }
}

/**
 * Create a job manager
 * @param {Object} [options]
 * @returns {JobManager}
 */
export function createJobManager(options = {}) {
  return new JobManager(options);
}

/**
 * Global manager instance
 * @type {JobManager | null}
 */
let globalManager = null;

/**
 * Get or create global manager
 * @param {Object} [options]
 * @returns {JobManager}
 */
export function getJobManager(options = {}) {
  if (!globalManager) {
    globalManager = new JobManager(options);
  }
  return globalManager;
}

/**
 * Set global manager
 * @param {JobManager} manager
 */
export function setJobManager(manager) {
  globalManager = manager;
}
