/**
 * Job Store
 *
 * Memory-based job storage with abstraction for future persistent backends.
 */

import { JobStatus } from "./job.types.js";

/**
 * JobStore interface - Memory-based implementation
 * Can be swapped with Redis, PostgreSQL, etc. implementations
 */
export class JobStore {
  constructor() {
    /** @type {Map<string, import("./job.types.js").Job>} */
    this.jobs = new Map();
    this.idCounter = 0;
  }

  /**
   * Generate unique job ID
   * @returns {string}
   */
  generateId() {
    this.idCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `job_${timestamp}_${random}_${this.idCounter}`;
  }

  /**
   * Create a new job
   * @param {Object} jobData
   * @returns {Promise<import("./job.types.js").Job>}
   */
  async createJob(jobData) {
    const now = new Date().toISOString();
    const id = this.generateId();

    const job = {
      id,
      status: JobStatus.QUEUED,
      progress: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      output: null,
      error: null,
      ...jobData,
    };

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Get job by ID
   * @param {string} jobId
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  /**
   * List jobs with optional filters
   * @param {import("./job.types.js").JobFilter} [filters]
   * @param {Object} [options]
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @param {string} [options.sortBy]
 * @param {"asc" | "desc"} [options.sortOrder]
 * @returns {Promise<import("./job.types.js").JobListResult>}
   */
  async listJobs(filters = {}, options = {}) {
    let jobs = Array.from(this.jobs.values());

    // Apply filters
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      jobs = jobs.filter(j => statuses.includes(j.status));
    }

    if (filters.plugin) {
      jobs = jobs.filter(j => j.plugin === filters.plugin);
    }

    if (filters.type) {
      jobs = jobs.filter(j => j.type === filters.type);
    }

    if (filters.workspaceId) {
      jobs = jobs.filter(j => j.workspaceId === filters.workspaceId);
    }

    if (filters.actor) {
      jobs = jobs.filter(j => j.actor === filters.actor);
    }

    // Sort
    const sortBy = options.sortBy || "createdAt";
    const sortOrder = options.sortOrder || "desc";
    jobs.sort((a, b) => {
      const aVal = a[sortBy] || "";
      const bVal = b[sortBy] || "";
      if (sortOrder === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    // Pagination
    const total = jobs.length;
    const offset = options.offset || 0;
    const limit = options.limit || 100;
    jobs = jobs.slice(offset, offset + limit);

    return {
      jobs,
      total,
      pagination: {
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Update a job
   * @param {string} jobId
   * @param {Object} updates
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    // Prevent overwriting immutable fields
    const { id, createdAt, ...allowedUpdates } = updates;

    const updatedJob = {
      ...job,
      ...allowedUpdates,
    };

    this.jobs.set(jobId, updatedJob);
    return { ...updatedJob };
  }

  /**
   * Delete a job
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async deleteJob(jobId) {
    return this.jobs.delete(jobId);
  }

  /**
   * Clear all jobs
   * @returns {Promise<number>} Number of jobs cleared
   */
  async clearJobs() {
    const count = this.jobs.size;
    this.jobs.clear();
    return count;
  }

  /**
   * Get jobs by status
   * @param {JobStatus | JobStatus[]} status
   * @returns {Promise<import("./job.types.js").Job[]>}
   */
  async getJobsByStatus(status) {
    const statuses = Array.isArray(status) ? status : [status];
    return Array.from(this.jobs.values()).filter(j =>
      statuses.includes(j.status)
    );
  }

  /**
   * Get jobs by workspace
   * @param {string} workspaceId
   * @param {JobStatus} [status]
   * @returns {Promise<import("./job.types.js").Job[]>}
   */
  async getJobsByWorkspace(workspaceId, status) {
    let jobs = Array.from(this.jobs.values()).filter(
      j => j.workspaceId === workspaceId
    );

    if (status) {
      jobs = jobs.filter(j => j.status === status);
    }

    return jobs;
  }

  /**
   * Get next queued job (FIFO with priority support)
   * @returns {Promise<import("./job.types.js").Job | null>}
   */
  async getNextQueuedJob() {
    const queued = Array.from(this.jobs.values())
      .filter(j => j.status === JobStatus.QUEUED)
      .sort((a, b) => {
        // Priority first (higher = more important)
        const priorityA = a.priority || 0;
        const priorityB = b.priority || 0;
        if (priorityB !== priorityA) {
          return priorityB - priorityA;
        }
        // Then FIFO
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

    return queued[0] || null;
  }

  /**
   * Get job count by status
   * @returns {Promise<Object>}
   */
  async getJobCounts() {
    const counts = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: this.jobs.size,
    };

    for (const job of this.jobs.values()) {
      if (counts[job.status] !== undefined) {
        counts[job.status]++;
      }
    }

    return counts;
  }
}

/**
 * Create a new job store instance
 * @returns {JobStore}
 */
export function createJobStore() {
  return new JobStore();
}

/**
 * Global store instance
 * @type {JobStore | null}
 */
let globalStore = null;

/**
 * Get or create global store
 * @returns {JobStore}
 */
export function getJobStore() {
  if (!globalStore) {
    globalStore = new JobStore();
  }
  return globalStore;
}

/**
 * Set global store instance
 * @param {JobStore} store
 */
export function setJobStore(store) {
  globalStore = store;
}
