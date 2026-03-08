/**
 * Job Queue
 *
 * Queue management for job system.
 * Handles job storage, retrieval, and queue status.
 */

import { randomUUID } from "crypto";

/**
 * Create a job queue manager
 * @param {Object} options
 * @param {Map} options.memoryStore - In-memory job storage
 * @param {Object} options.redisStore - Optional Redis store
 * @param {boolean} options.useRedis - Whether to use Redis
 */
export function createJobQueue({ memoryStore, redisStore, useRedis }) {
  /**
   * Enqueue a new job
   * @param {Object} job - Job object to store
   * @returns {Promise<void>}
   */
  async function enqueue(job) {
    if (useRedis && redisStore) {
      await redisStore.enqueue(job);
    } else {
      memoryStore.set(job.id, job);
    }
  }

  /**
   * Dequeue next pending job (FIFO)
   * @returns {Promise<Object|null>} Job object or null if empty
   */
  async function dequeue() {
    if (useRedis && redisStore) {
      return await redisStore.dequeue();
    }

    // In-memory: find first queued job
    for (const [id, job] of memoryStore) {
      if (job.state === "queued") {
        return job;
      }
    }
    return null;
  }

  /**
   * Get job by ID
   * @param {string} id - Job ID
   * @returns {Promise<Object|null>}
   */
  async function get(id) {
    if (useRedis && redisStore) {
      return await redisStore.get(id);
    }
    return memoryStore.get(id) || null;
  }

  /**
   * Update job in store
   * @param {string} id - Job ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async function update(id, updates) {
    if (useRedis && redisStore) {
      await redisStore.update(id, updates);
      return;
    }

    const job = memoryStore.get(id);
    if (job) {
      Object.assign(job, updates);
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>}
   */
  async function getStats() {
    if (useRedis && redisStore) {
      return await redisStore.getStats();
    }

    const all = Array.from(memoryStore.values());
    return {
      total: all.length,
      queued: all.filter(j => j.state === "queued").length,
      running: all.filter(j => j.state === "running").length,
      completed: all.filter(j => j.state === "completed" || j.state === "done").length,
      failed: all.filter(j => j.state === "failed").length,
      cancelled: all.filter(j => j.state === "cancelled").length,
    };
  }

  /**
   * List jobs with optional filters
   * @param {Object} filters
   * @param {string} filters.state - Filter by state
   * @param {string} filters.type - Filter by job type
   * @param {number} filters.limit - Max results
   * @returns {Promise<Object[]>}
   */
  async function list({ state, type, limit = 50 } = {}) {
    if (useRedis && redisStore) {
      return await redisStore.list({ state, type, limit });
    }

    let jobs = [...memoryStore.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    if (state) jobs = jobs.filter(j => j.state === state);
    if (type) jobs = jobs.filter(j => j.type === type);

    return jobs.slice(0, limit);
  }

  /**
   * Remove completed/failed jobs older than cutoff
   * @param {number} cutoffTime - Timestamp in ms
   * @returns {Promise<number>} Number of jobs removed
   */
  async function prune(cutoffTime) {
    let removed = 0;

    if (useRedis && redisStore) {
      return await redisStore.prune(cutoffTime);
    }

    for (const [id, job] of memoryStore) {
      if (
        (job.state === "completed" || job.state === "failed") &&
        new Date(job.finishedAt).getTime() < cutoffTime
      ) {
        memoryStore.delete(id);
        removed++;
      }
    }

    return removed;
  }

  return {
    enqueue,
    dequeue,
    get,
    update,
    getStats,
    list,
    prune,
  };
}
