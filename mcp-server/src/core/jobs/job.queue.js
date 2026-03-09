/**
 * Job Queue
 *
 * FIFO queue management with priority support.
 */

import { JobStatus } from "./job.types.js";

/**
 * Job Queue
 */
export class JobQueue {
  /**
   * @param {Object} [options]
   * @param {import("./job.store.js").JobStore} [options.store]
   */
  constructor(options = {}) {
    this.store = options.store;
    this.processing = false;
    this.paused = false;
  }

  /**
   * Get next job from queue
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async dequeue() {
    if (!this.store) return null;
    return this.store.getNextQueuedJob();
  }

  /**
   * Check if queue has jobs
   * @returns {Promise<boolean>}
   */
  async hasJobs() {
    const job = await this.dequeue();
    return job !== null;
  }

  /**
   * Get queue length
   * @returns {Promise<number>}
   */
  async length() {
    if (!this.store) return 0;
    const counts = await this.store.getJobCounts();
    return counts.queued;
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.paused = true;
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.paused = false;
  }

  /**
   * Check if queue is paused
   * @returns {boolean}
   */
  isPaused() {
    return this.paused;
  }

  /**
   * Check if queue is processing
   * @returns {boolean}
   */
  isProcessing() {
    return this.processing;
  }
}

/**
 * Create a job queue
 * @param {Object} [options]
 * @returns {JobQueue}
 */
export function createJobQueue(options = {}) {
  return new JobQueue(options);
}
