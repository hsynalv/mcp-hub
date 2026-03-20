/**
 * Redis Job Store
 *
 * Redis-backed persistent job queue for MCP-Hub.
 * Provides durability across server restarts and supports multi-instance deployments.
 *
 * Redis Schema:
 *   mcp-hub:job:<id>       -> Job data (HASH)
 *   mcp-hub:jobs:queue     -> Pending job IDs (LIST)
 *   mcp-hub:jobs:running   -> Running job IDs (SET with timestamp score)
 *   mcp-hub:jobs:completed -> Completed job IDs (Sorted Set by completion time)
 *   mcp-hub:jobs:failed    -> Failed job IDs (Sorted Set by failure time)
 *   mcp-hub:progress:<id>  -> Job progress channel for pub/sub
 */

import Redis from "ioredis";
import { randomUUID } from "crypto";
import { emitJobLifecycleHubEvent } from "./audit/emit-job-event.js";

function terminalJobDurationMs(job) {
  if (!job?.startedAt || !job?.finishedAt) return 0;
  return Math.max(0, new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime());
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class RedisJobStore {
  constructor(options = {}) {
    this.redis = options.redis || new Redis(options.url || process.env.REDIS_URL || "redis://localhost:6379");
    this.keyPrefix = options.keyPrefix || "mcp-hub:";
    this.ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
    this.enabled = true;

    this.redis.on("error", (err) => {
      console.error("[redis-jobs] Redis connection error:", err.message);
      this.enabled = false;
    });

    this.redis.on("connect", () => {
      console.log("[redis-jobs] Redis connected");
      this.enabled = true;
    });
  }

  // Key helpers
  _jobKey(id) {
    return `${this.keyPrefix}job:${id}`;
  }

  _progressKey(id) {
    return `${this.keyPrefix}progress:${id}`;
  }

  _cancelledSetKey() {
    return `${this.keyPrefix}jobs:cancelled`;
  }

  // Core operations
  async get(id) {
    const data = await this.redis.hgetall(this._jobKey(id));
    if (!data || Object.keys(data).length === 0) return null;
    return this._deserializeJob(data);
  }

  async set(id, job) {
    const serialized = this._serializeJob(job);
    await this.redis.hset(this._jobKey(id), serialized);
    // Set TTL on job data
    await this.redis.expire(this._jobKey(id), this.ttlSeconds);
  }

  async delete(id) {
    await this.redis.del(this._jobKey(id));
    // Also remove from all state sets
    await Promise.all([
      this.redis.lrem(`${this.keyPrefix}jobs:queue`, 0, id),
      this.redis.srem(`${this.keyPrefix}jobs:running`, id),
      this.redis.zrem(`${this.keyPrefix}jobs:completed`, id),
      this.redis.zrem(`${this.keyPrefix}jobs:failed`, id),
      this.redis.srem(this._cancelledSetKey(), id),
    ]);
  }

  // Queue operations
  async enqueue(job) {
    await this.set(job.id, { ...job, state: "queued" });
    await this.redis.rpush(`${this.keyPrefix}jobs:queue`, job.id);
  }

  async dequeue() {
    // Atomically pop from queue
    const result = await this.redis.lpop(`${this.keyPrefix}jobs:queue`);
    if (!result) return null;

    // Move to running set with timestamp
    const now = Date.now();
    await this.redis.sadd(`${this.keyPrefix}jobs:running`, result);
    await this.redis.hset(this._jobKey(result), "state", "running", "startedAt", new Date().toISOString());

    return this.get(result);
  }

  async markCompleted(id, result) {
    const now = Date.now();
    await Promise.all([
      this.redis.srem(`${this.keyPrefix}jobs:running`, id),
      this.redis.srem(this._cancelledSetKey(), id),
      this.redis.zadd(`${this.keyPrefix}jobs:completed`, now, id),
      this.redis.hset(this._jobKey(id), "state", "completed", "result", JSON.stringify(result), "finishedAt", new Date().toISOString(), "progress", "100"),
    ]);
    // Set shorter TTL for completed jobs (6 hours)
    await this.redis.expire(this._jobKey(id), 6 * 60 * 60);
  }

  async markFailed(id, error) {
    const now = Date.now();
    await Promise.all([
      this.redis.srem(`${this.keyPrefix}jobs:running`, id),
      this.redis.zadd(`${this.keyPrefix}jobs:failed`, now, id),
      this.redis.srem(this._cancelledSetKey(), id),
      this.redis.hset(this._jobKey(id), "state", "failed", "error", typeof error === "string" ? error : JSON.stringify(error), "finishedAt", new Date().toISOString()),
    ]);
    // Set shorter TTL for failed jobs (6 hours)
    await this.redis.expire(this._jobKey(id), 6 * 60 * 60);
  }

  async markCancelled(id) {
    const now = Date.now();
    await Promise.all([
      this.redis.srem(`${this.keyPrefix}jobs:running`, id),
      this.redis.zadd(`${this.keyPrefix}jobs:failed`, now, id),
      this.redis.hset(this._jobKey(id), "state", "cancelled", "finishedAt", new Date().toISOString()),
    ]);
  }

  async updateProgress(id, progress) {
    await this.redis.hset(this._jobKey(id), "progress", String(progress));
    // Publish for real-time updates
    await this.redis.publish(this._progressKey(id), JSON.stringify({ progress, timestamp: Date.now() }));
  }

  async addLog(id, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    // Use list with trim to keep last 1000 logs
    await this.redis.lpush(`${this.keyPrefix}job:logs:${id}`, logEntry);
    await this.redis.ltrim(`${this.keyPrefix}job:logs:${id}`, 0, 999);
    // Set TTL on logs
    await this.redis.expire(`${this.keyPrefix}job:logs:${id}`, this.ttlSeconds);
  }

  async getLogs(id) {
    const logs = await this.redis.lrange(`${this.keyPrefix}job:logs:${id}`, 0, -1);
    return logs.reverse(); // Oldest first
  }

  // Listing operations
  async list({ state, type, limit = 50 } = {}) {
    let jobIds = [];

    if (state) {
      // Get from specific state collection
      switch (state) {
        case "queued":
          jobIds = await this.redis.lrange(`${this.keyPrefix}jobs:queue`, 0, limit - 1);
          break;
        case "running":
          jobIds = await this.redis.smembers(`${this.keyPrefix}jobs:running`);
          break;
        case "completed":
          jobIds = await this.redis.zrevrange(`${this.keyPrefix}jobs:completed`, 0, limit - 1);
          break;
        case "failed":
        case "cancelled":
          jobIds = await this.redis.zrevrange(`${this.keyPrefix}jobs:failed`, 0, limit - 1);
          break;
      }
    } else {
      // Get from all states
      const [queued, running, completed, failed] = await Promise.all([
        this.redis.lrange(`${this.keyPrefix}jobs:queue`, 0, limit - 1),
        this.redis.smembers(`${this.keyPrefix}jobs:running`),
        this.redis.zrevrange(`${this.keyPrefix}jobs:completed`, 0, Math.floor(limit / 2)),
        this.redis.zrevrange(`${this.keyPrefix}jobs:failed`, 0, Math.floor(limit / 4)),
      ]);
      jobIds = [...queued, ...running, ...completed, ...failed];
    }

    // Remove duplicates and limit
    jobIds = [...new Set(jobIds)].slice(0, limit);

    // Fetch job data
    const jobs = await Promise.all(jobIds.map((id) => this.get(id)));
    const validJobs = jobs.filter(Boolean);

    // Filter by type if specified
    if (type) {
      return validJobs.filter((j) => j.type === type);
    }

    return validJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async getStats() {
    const [queued, running, completed, terminalNonSuccess, cancelled] = await Promise.all([
      this.redis.llen(`${this.keyPrefix}jobs:queue`),
      this.redis.scard(`${this.keyPrefix}jobs:running`),
      this.redis.zcard(`${this.keyPrefix}jobs:completed`),
      this.redis.zcard(`${this.keyPrefix}jobs:failed`),
      this.redis.scard(this._cancelledSetKey()),
    ]);

    const failed = Math.max(0, terminalNonSuccess - cancelled);

    return {
      total: queued + running + completed + terminalNonSuccess,
      queued,
      running,
      completed,
      failed,
      cancelled,
    };
  }

  // Recovery: Find orphaned running jobs (stuck for >30 min)
  async recoverOrphanedJobs() {
    const runningIds = await this.redis.smembers(`${this.keyPrefix}jobs:running`);
    const cutoff = Date.now() - JOB_TIMEOUT_MS;
    const orphaned = [];

    for (const id of runningIds) {
      const job = await this.get(id);
      if (job && job.startedAt) {
        const startTime = new Date(job.startedAt).getTime();
        if (startTime < cutoff) {
          orphaned.push(id);
        }
      }
    }

    for (const id of orphaned) {
      await this.markFailed(id, "Job timed out (orphaned after restart)");
      console.log(`[redis-jobs] Recovered orphaned job ${id}`);
      const failedJob = await this.get(id);
      if (failedJob) {
        try {
          await emitJobLifecycleHubEvent(failedJob, "failed", {
            queueBackend: "redis",
            durationMs: terminalJobDurationMs(failedJob),
            failureReason: "orphan_timeout",
            error: "Job timed out (orphaned after restart)",
          });
        } catch {
          /* best-effort */
        }
      }
    }

    return orphaned.length;
  }

  // Cleanup: Remove old completed/failed job references
  async cleanupOldJobs(maxAgeHours = 24) {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

    const [completedRemoved, failedRemoved] = await Promise.all([
      this.redis.zremrangebyscore(`${this.keyPrefix}jobs:completed`, 0, cutoff),
      this.redis.zremrangebyscore(`${this.keyPrefix}jobs:failed`, 0, cutoff),
    ]);

    return {
      completedRemoved,
      failedRemoved,
    };
  }

  // Serialization helpers
  _serializeJob(job) {
    const serialized = {};
    for (const [key, value] of Object.entries(job)) {
      if (value === null || value === undefined) continue;
      if (key === "logs") continue; // Logs stored separately
      if (typeof value === "object") {
        serialized[key] = JSON.stringify(value);
      } else {
        serialized[key] = String(value);
      }
    }
    return serialized;
  }

  _deserializeJob(data) {
    const job = {};
    for (const [key, value] of Object.entries(data)) {
      // Try to parse JSON
      if (key === "payload" || key === "context" || key === "result") {
        try {
          job[key] = JSON.parse(value);
        } catch {
          job[key] = value;
        }
      } else if (key === "progress") {
        job[key] = parseInt(value, 10) || 0;
      } else if (value === "true" || value === "false") {
        job[key] = value === "true";
      } else {
        job[key] = value;
      }
    }
    return job;
  }

  // Graceful shutdown
  async disconnect() {
    await this.redis.disconnect();
  }
}

// Factory function for creating store with fallback
export function createJobStore(options = {}) {
  const useRedis = options.useRedis !== false && (process.env.REDIS_URL || options.url);

  if (useRedis) {
    try {
      const store = new RedisJobStore(options);
      console.log("[jobs] Using Redis-backed job store");
      return store;
    } catch (err) {
      console.warn("[jobs] Failed to initialize Redis store, falling back to memory:", err.message);
    }
  }

  console.log("[jobs] Using in-memory job store (jobs will be lost on restart)");
  return null; // Signal to use memory store
}
