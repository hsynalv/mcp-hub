/**
 * Simple in-memory job queue for long-running tasks.
 *
 * States: pending → running → completed | failed
 *
 * Future: swap the in-memory store for Redis without changing the public API.
 */

import { randomUUID } from "crypto";

const jobs = new Map();

/**
 * Create a new job and return its descriptor.
 * The runner function receives (job) and should call job.succeed(result) or job.fail(error).
 *
 * @param {string} type       - Job type label (e.g. "analyze_repo")
 * @param {object} payload    - Input data
 * @param {Function} runner   - Async function(job) that does the work
 * @returns {object}          - Job descriptor
 */
export function createJob(type, payload, runner) {
  const id = randomUUID();
  const job = {
    id,
    type,
    payload,
    state: "pending",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,

    // Called by runner to mark success
    succeed(result) {
      this.state = "completed";
      this.finishedAt = new Date().toISOString();
      this.result = result ?? null;
    },

    // Called by runner to mark failure
    fail(err) {
      this.state = "failed";
      this.finishedAt = new Date().toISOString();
      this.error = err?.message ?? String(err);
    },
  };

  jobs.set(id, job);

  // Run async — do not await
  setImmediate(async () => {
    job.state = "running";
    job.startedAt = new Date().toISOString();
    try {
      await runner(job);
      if (job.state === "running") job.succeed(null); // runner forgot to call succeed
    } catch (err) {
      job.fail(err);
    }
  });

  return publicView(job);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicView(job) : null;
}

export function listJobs({ state, type, limit = 50 } = {}) {
  let list = [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  if (state) list = list.filter((j) => j.state === state);
  if (type)  list = list.filter((j) => j.type === type);
  return list.slice(0, limit).map(publicView);
}

/** Strip internal methods before sending to client. */
function publicView(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
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
