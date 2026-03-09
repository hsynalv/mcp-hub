/**
 * Job Events
 *
 * Event system for job lifecycle notifications.
 */

import { EventEmitter } from "events";

/**
 * Job event types
 */
export const JobEventType = {
  CREATED: "job.created",
  STARTED: "job.started",
  PROGRESS: "job.progress",
  COMPLETED: "job.completed",
  FAILED: "job.failed",
  CANCELLED: "job.cancelled",
  RETRYING: "job.retrying",
};

/**
 * Job event emitter
 */
export class JobEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Emit job created event
   * @param {import("./job.types.js").Job} job
   */
  emitCreated(job) {
    this.emit(JobEventType.CREATED, {
      type: JobEventType.CREATED,
      jobId: job.id,
      job,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job started event
   * @param {import("./job.types.js").Job} job
   */
  emitStarted(job) {
    this.emit(JobEventType.STARTED, {
      type: JobEventType.STARTED,
      jobId: job.id,
      job,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job progress event
   * @param {import("./job.types.js").Job} job
   * @param {number} progress
   * @param {Object} [data]
   */
  emitProgress(job, progress, data = null) {
    this.emit(JobEventType.PROGRESS, {
      type: JobEventType.PROGRESS,
      jobId: job.id,
      job,
      progress,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job completed event
   * @param {import("./job.types.js").Job} job
   * @param {Object} result
   */
  emitCompleted(job, result) {
    this.emit(JobEventType.COMPLETED, {
      type: JobEventType.COMPLETED,
      jobId: job.id,
      job,
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job failed event
   * @param {import("./job.types.js").Job} job
   * @param {Error} error
   */
  emitFailed(job, error) {
    this.emit(JobEventType.FAILED, {
      type: JobEventType.FAILED,
      jobId: job.id,
      job,
      error: {
        message: error.message,
        stack: error.stack,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job cancelled event
   * @param {import("./job.types.js").Job} job
   */
  emitCancelled(job) {
    this.emit(JobEventType.CANCELLED, {
      type: JobEventType.CANCELLED,
      jobId: job.id,
      job,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit job retrying event
   * @param {import("./job.types.js").Job} job
   * @param {number} attempt
   */
  emitRetrying(job, attempt) {
    this.emit(JobEventType.RETRYING, {
      type: JobEventType.RETRYING,
      jobId: job.id,
      job,
      attempt,
      timestamp: Date.now(),
    });
  }
}

/**
 * Global event emitter instance
 * @type {JobEventEmitter | null}
 */
let globalEmitter = null;

/**
 * Get or create global event emitter
 * @returns {JobEventEmitter}
 */
export function getJobEventEmitter() {
  if (!globalEmitter) {
    globalEmitter = new JobEventEmitter();
  }
  return globalEmitter;
}

/**
 * Set global event emitter
 * @param {JobEventEmitter} emitter
 */
export function setJobEventEmitter(emitter) {
  globalEmitter = emitter;
}
