/**
 * Job Worker
 *
 * Job execution engine with progress, cancellation, and error handling.
 */

import { JobStatus } from "./job.types.js";

// AbortController global - available in Node 15+, added in types for older
/* global AbortController */

/**
 * Job Worker
 */
export class JobWorker {
  /**
   * @param {Object} [options]
   * @param {import("./job.store.js").JobStore} [options.store]
   * @param {import("./job.events.js").JobEventEmitter} [options.emitter]
   * @param {Function} [options.onComplete]
   * @param {Function} [options.onError]
   */
  constructor(options = {}) {
    this.store = options.store;
    this.emitter = options.emitter;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
    this.running = false;
    this.currentJob = null;
    this.abortController = null;
  }

  /**
   * Execute a job
   * @param {import("./job.types.js").Job} job
   * @param {import("./job.types.js").JobHandler} handler
   * @returns {Promise<Object>}
   */
  async execute(job, handler) {
    if (this.running) {
      throw new Error("Worker is already running a job");
    }

    this.running = true;
    this.currentJob = job;
    this.abortController = new AbortController();

    const startedAt = new Date().toISOString();

    // Update job status to running
    await this.store.updateJob(job.id, {
      status: JobStatus.RUNNING,
      startedAt,
    });

    // Emit started event
    if (this.emitter) {
      const updatedJob = await this.store.getJob(job.id);
      this.emitter.emitStarted(updatedJob);
    }

    try {
      // Create progress updater
      const updateProgress = async (progress, data = null) => {
        if (progress < 0) progress = 0;
        if (progress > 100) progress = 100;

        await this.store.updateJob(job.id, { progress });

        if (this.emitter) {
          const updatedJob = await this.store.getJob(job.id);
          this.emitter.emitProgress(updatedJob, progress, data);
        }
      };

      // Execute handler
      const result = await handler({
        job,
        updateProgress,
        signal: this.abortController.signal,
        context: {
          jobId: job.id,
          type: job.type,
          plugin: job.plugin,
          action: job.action,
          workspaceId: job.workspaceId,
          actor: job.actor,
          correlationId: job.correlationId,
        },
      });

      // Mark as completed
      const finishedAt = new Date().toISOString();
      await this.store.updateJob(job.id, {
        status: JobStatus.COMPLETED,
        progress: 100,
        finishedAt,
        output: result,
      });

      // Emit completed event
      if (this.emitter) {
        const updatedJob = await this.store.getJob(job.id);
        this.emitter.emitCompleted(updatedJob, result);
      }

      if (this.onComplete) {
        this.onComplete(job, result);
      }

      return result;
    } catch (error) {
      // Handle cancellation
      if (this.abortController.signal.aborted) {
        const finishedAt = new Date().toISOString();
        await this.store.updateJob(job.id, {
          status: JobStatus.CANCELLED,
          finishedAt,
        });

        if (this.emitter) {
          const updatedJob = await this.store.getJob(job.id);
          this.emitter.emitCancelled(updatedJob);
        }

        throw new Error("Job was cancelled");
      }

      // Handle failure
      const finishedAt = new Date().toISOString();
      await this.store.updateJob(job.id, {
        status: JobStatus.FAILED,
        finishedAt,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code || "JOB_FAILED",
        },
      });

      // Emit failed event
      if (this.emitter) {
        const updatedJob = await this.store.getJob(job.id);
        this.emitter.emitFailed(updatedJob, error);
      }

      if (this.onError) {
        this.onError(job, error);
      }

      throw error;
    } finally {
      this.running = false;
      this.currentJob = null;
      this.abortController = null;
    }
  }

  /**
   * Cancel current job
   * @returns {boolean}
   */
  cancel() {
    if (!this.running || !this.abortController) {
      return false;
    }

    this.abortController.abort();
    return true;
  }

  /**
   * Check if worker is running
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Get current job
   * @returns {import("./job.types.js").Job | null}
   */
  getCurrentJob() {
    return this.currentJob;
  }
}

/**
 * Create a job worker
 * @param {Object} [options]
 * @returns {JobWorker}
 */
export function createJobWorker(options = {}) {
  return new JobWorker(options);
}
