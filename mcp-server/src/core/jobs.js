/**
 * Jobs/Queue System
 *
 * Manages long-running jobs: submit, status, logs, cancel.
 * Jobs can be submitted by plugins and tracked asynchronously.
 *
 * States: queued → running → done | failed | cancelled
 */

import { randomUUID } from "crypto";
import { config } from "./config.js";
import { RedisJobStore } from "./jobs.redis.js";

// Initialize store (Redis or in-memory fallback)
let store = null;
let useRedis = false;

function initStore() {
  if (config.redis.enabled && !store) {
    try {
      store = new RedisJobStore({
        url: config.redis.url,
        keyPrefix: config.redis.keyPrefix,
        ttlSeconds: config.redis.ttlSeconds,
      });
      useRedis = true;
      console.log("[jobs] Redis store initialized");

      // Recover orphaned jobs on startup
      store.recoverOrphanedJobs().then((count) => {
        if (count > 0) {
          console.log(`[jobs] Recovered ${count} orphaned jobs from previous session`);
        }
      });
    } catch (err) {
      console.warn("[jobs] Redis initialization failed, using memory store:", err.message);
      store = null;
      useRedis = false;
    }
  }
  return store;
}

// Job storage and runners (memory fallback)
const jobs = new Map();
const jobRunners = new Map();

/** Job states */
export const JobState = {
  PENDING: "pending",
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Register a job runner for a specific job type
 * @param {string} type - Job type identifier
 * @param {Function} handler - Async handler function(job, updateProgress, log)
 */
export function registerJobRunner(type, handler) {
  jobRunners.set(type, handler);
  console.log(`[jobs] registered runner for type: ${type}`);
}

/**
 * Legacy: Create a job directly with inline runner
 * @param {string} type - Job type
 * @param {object} payload - Input data
 * @param {Function} runner - Async runner function
 * @returns {object} Job descriptor
 */
export function createJob(type, payload, runner) {
  // Register temporary runner
  const tempType = `${type}_${randomUUID().slice(0, 8)}`;
  registerJobRunner(tempType, runner);
  return submitJob(tempType, payload);
}

/**
 * Submit a job for execution
 * @param {string} type - Job type (must have registered runner)
 * @param {object} payload - Job input data
 * @param {object} context - Execution context
 * @returns {object} Job descriptor
 */
export function submitJob(type, payload = {}, context = {}) {
  if (!jobRunners.has(type)) {
    throw new Error(`No runner registered for job type: ${type}`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  const job = {
    id,
    type,
    state: JobState.QUEUED,
    payload,
    context: {
      projectId: context.projectId || context.project?.id || null,
      env: context.env || context.projectEnv || "development",
      user: context.user || null,
    },
    progress: 0,
    logs: [],
    result: null,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };

  // Initialize store if needed
  initStore();

  // Store in Redis or memory
  if (useRedis && store) {
    store.enqueue(job).catch((err) => {
      console.error("[jobs] Failed to enqueue job in Redis:", err);
      // Fallback to memory
      jobs.set(id, job);
    });
  } else {
    jobs.set(id, job);
  }

  // Start job execution asynchronously
  setImmediate(() => runJob(id));

  console.log(`[jobs] submitted ${type} job ${id}`);
  return publicView(job);
}

/**
 * Internal: Execute a job
 */
async function runJob(id) {
  // Get job from appropriate store
  let job;
  if (useRedis && store) {
    job = await store.get(id);
  } else {
    job = jobs.get(id);
  }

  if (!job || job.state !== JobState.QUEUED) return;

  const runner = jobRunners.get(job.type);
  if (!runner) {
    const error = "Runner not found";
    if (useRedis && store) {
      await store.markFailed(id, error);
    } else {
      job.state = JobState.FAILED;
      job.error = error;
      job.finishedAt = new Date().toISOString();
    }
    return;
  }

  // Update state to running
  if (useRedis && store) {
    await store.set(id, { ...job, state: JobState.RUNNING, startedAt: new Date().toISOString() });
    await store.redis.sadd(`${store.keyPrefix}jobs:running`, id);
  } else {
    job.state = JobState.RUNNING;
    job.startedAt = new Date().toISOString();
  }

  // Helper functions for runner with Redis persistence
  const updateProgress = async (percent) => {
    const progress = Math.min(100, Math.max(0, Math.round(percent)));
    if (useRedis && store) {
      await store.updateProgress(id, progress);
    } else {
      job.progress = progress;
    }
  };

  const log = async (message) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;
    if (useRedis && store) {
      await store.addLog(id, message);
    } else {
      job.logs.push(entry);
      if (job.logs.length > 1000) job.logs.shift();
    }
  };

  // Legacy compatibility wrapper
  const legacyJob = {
    ...job,
    succeed: async (result) => {
      if (useRedis && store) {
        const current = await store.get(id);
        if (current && current.state === JobState.RUNNING) {
          await store.markCompleted(id, result ?? null);
        }
      } else {
        if (job.state === JobState.RUNNING) {
          job.state = JobState.COMPLETED;
          job.result = result ?? null;
          job.finishedAt = new Date().toISOString();
        }
      }
    },
    fail: async (err) => {
      const errorMsg = err?.message ?? String(err);
      if (useRedis && store) {
        const current = await store.get(id);
        if (current && current.state === JobState.RUNNING) {
          await store.markFailed(id, errorMsg);
        }
      } else {
        if (job.state === JobState.RUNNING) {
          job.state = JobState.FAILED;
          job.error = errorMsg;
          job.finishedAt = new Date().toISOString();
        }
      }
    },
  };

  try {
    await log(`Starting ${job.type} job`);
    const result = await runner(legacyJob, updateProgress, log);

    // If runner didn't call succeed/fail, mark as done
    if (useRedis && store) {
      const current = await store.get(id);
      if (current && current.state === JobState.RUNNING) {
        await store.markCompleted(id, result ?? null);
      }
    } else {
      if (job.state === JobState.RUNNING) {
        job.state = JobState.COMPLETED;
        job.result = result ?? null;
        job.finishedAt = new Date().toISOString();
        job.progress = 100;
      }
    }

    await log(`Job completed`);
  } catch (err) {
    const errorMsg = err?.message ?? String(err);
    if (useRedis && store) {
      const current = await store.get(id);
      if (current && current.state === JobState.RUNNING) {
        await store.markFailed(id, errorMsg);
      }
    } else {
      if (job.state === JobState.RUNNING) {
        job.state = JobState.FAILED;
        job.error = errorMsg;
        job.finishedAt = new Date().toISOString();
      }
    }
    await log(`Job failed: ${errorMsg}`);
  }
}

export async function listJobs({ state, type, limit = 50 } = {}) {
  if (useRedis && store) {
    const jobs = await store.list({ state, type, limit });
    return jobs.map(publicView);
  }

  let list = [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  if (state) list = list.filter((j) => j.state === state);
  if (type)  list = list.filter((j) => j.type === type);
  return list.slice(0, limit).map(publicView);
}

export async function getJob(id) {
  if (useRedis && store) {
    const job = await store.get(id);
    return job ? publicView(job) : null;
  }
  const job = jobs.get(id);
  return job ? publicView(job) : null;
}

export async function getJobLogs(id) {
  if (useRedis && store) {
    return await store.getLogs(id);
  }
  const job = jobs.get(id);
  return job ? job.logs : null;
}

export async function cancelJob(id) {
  if (useRedis && store) {
    const job = await store.get(id);
    if (!job) return false;
    if (job.state === JobState.QUEUED || job.state === JobState.RUNNING) {
      await store.markCancelled(id);
      await store.addLog(id, "Job cancelled");
      return true;
    }
    return false;
  }

  const job = jobs.get(id);
  if (!job) return false;

  if (job.state === JobState.QUEUED || job.state === JobState.RUNNING) {
    job.state = JobState.CANCELLED;
    job.finishedAt = new Date().toISOString();
    job.logs.push(`[${new Date().toISOString()}] Job cancelled`);
    return true;
  }

  return false;
}

export async function getJobStats() {
  if (useRedis && store) {
    return await store.getStats();
  }

  const all = Array.from(jobs.values());
  return {
    total: all.length,
    queued: all.filter(j => j.state === JobState.QUEUED).length,
    running: all.filter(j => j.state === JobState.RUNNING).length,
    completed: all.filter(j => j.state === JobState.COMPLETED || j.state === JobState.DONE).length,
    failed: all.filter(j => j.state === JobState.FAILED).length,
    cancelled: all.filter(j => j.state === JobState.CANCELLED).length,
  };
}

/** Strip internal methods before sending to client. */
function publicView(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    context: job.context,
    progress: job.progress || 0,
    logCount: job.logs?.length || 0,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };
}

// Prune completed/failed jobs older than 1 hour to avoid memory leak
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (
      (job.state === "completed" || job.state === "failed") &&
      new Date(job.finishedAt).getTime() < cutoff
    ) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);
