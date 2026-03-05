/**
 * Jobs/Queue System
 *
 * Manages long-running jobs: submit, status, logs, cancel.
 * Jobs can be submitted by plugins and tracked asynchronously.
 *
 * States: queued → running → done | failed | cancelled
 */

import { randomUUID } from "crypto";

// Job storage and runners
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

  jobs.set(id, job);

  // Start job execution asynchronously
  setImmediate(() => runJob(id));

  console.log(`[jobs] submitted ${type} job ${id}`);
  return publicView(job);
}

/**
 * Internal: Execute a job
 */
async function runJob(id) {
  const job = jobs.get(id);
  if (!job || job.state !== JobState.QUEUED) return;

  const runner = jobRunners.get(job.type);
  if (!runner) {
    job.state = JobState.FAILED;
    job.error = "Runner not found";
    job.finishedAt = new Date().toISOString();
    return;
  }

  job.state = JobState.RUNNING;
  job.startedAt = new Date().toISOString();

  // Helper functions for runner
  const updateProgress = (percent) => {
    job.progress = Math.min(100, Math.max(0, Math.round(percent)));
  };

  const log = (message) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;
    job.logs.push(entry);
    // Keep only last 1000 logs
    if (job.logs.length > 1000) {
      job.logs.shift();
    }
  };

  // Legacy compatibility wrapper
  const legacyJob = {
    ...job,
    succeed(result) {
      if (job.state === JobState.RUNNING) {
        job.state = JobState.COMPLETED;
        job.result = result ?? null;
        job.finishedAt = new Date().toISOString();
      }
    },
    fail(err) {
      if (job.state === JobState.RUNNING) {
        job.state = JobState.FAILED;
        job.error = err?.message ?? String(err);
        job.finishedAt = new Date().toISOString();
      }
    },
  };

  try {
    log(`Starting ${job.type} job`);
    const result = await runner(legacyJob, updateProgress, log);
    
    // If runner didn't call succeed/fail, mark as done
    if (job.state === JobState.RUNNING) {
      job.state = JobState.COMPLETED;
      job.result = result ?? null;
      job.finishedAt = new Date().toISOString();
      job.progress = 100;
    }
    
    log(`Job ${job.state}`);
  } catch (err) {
    if (job.state === JobState.RUNNING) {
      job.state = JobState.FAILED;
      job.error = err?.message ?? String(err);
      job.finishedAt = new Date().toISOString();
      log(`Job failed: ${job.error}`);
    }
  }
}

export function listJobs({ state, type, limit = 50 } = {}) {
  let list = [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  if (state) list = list.filter((j) => j.state === state);
  if (type)  list = list.filter((j) => j.type === type);
  return list.slice(0, limit).map(publicView);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicView(job) : null;
}

export function getJobLogs(id) {
  const job = jobs.get(id);
  return job ? job.logs : null;
}

export function cancelJob(id) {
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

export function getJobStats() {
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
