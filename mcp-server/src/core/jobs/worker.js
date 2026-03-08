/**
 * Job Worker
 *
 * Worker execution for job system.
 * Handles job execution, error capture, and progress tracking.
 */

/**
 * Job states
 */
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
 * Create a job runner
 * @param {Object} queue - Job queue instance
 * @param {Map} jobRunners - Map of job type to handler function
 * @returns {Object} Worker instance
 */
export function createWorker(queue, jobRunners) {
  /**
   * Execute a job
   * @param {string} jobId - Job ID to run
   * @returns {Promise<void>}
   */
  async function runJob(jobId) {
    const job = await queue.get(jobId);
    if (!job || job.state !== JobState.QUEUED) {
      return;
    }

    const runner = jobRunners.get(job.type);
    if (!runner) {
      await queue.update(jobId, {
        state: JobState.FAILED,
        error: `No runner registered for job type: ${job.type}`,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    // Update state to running
    await queue.update(jobId, {
      state: JobState.RUNNING,
      startedAt: new Date().toISOString(),
    });

    // Helper functions for runner
    const updateProgress = async (percent) => {
      const progress = Math.min(100, Math.max(0, Math.round(percent)));
      await queue.update(jobId, { progress });
    };

    const log = async (message) => {
      const timestamp = new Date().toISOString();
      const entry = `[${timestamp}] ${message}`;
      const job = await queue.get(jobId);
      if (job) {
        const logs = job.logs || [];
        logs.push(entry);
        if (logs.length > 1000) logs.shift();
        await queue.update(jobId, { logs });
      }
    };

    // Legacy compatibility wrapper
    const legacyJob = {
      ...job,
      succeed: async (result) => {
        const current = await queue.get(jobId);
        if (current && current.state === JobState.RUNNING) {
          await queue.update(jobId, {
            state: JobState.COMPLETED,
            result: result ?? null,
            finishedAt: new Date().toISOString(),
            progress: 100,
          });
        }
      },
      fail: async (err) => {
        const errorMsg = err?.message ?? String(err);
        const current = await queue.get(jobId);
        if (current && current.state === JobState.RUNNING) {
          await queue.update(jobId, {
            state: JobState.FAILED,
            error: errorMsg,
            finishedAt: new Date().toISOString(),
          });
        }
        await log(`Job failed: ${errorMsg}`);
      },
    };

    try {
      await log(`Starting ${job.type} job`);
      const result = await runner(legacyJob, updateProgress, log);

      // If runner didn't call succeed/fail, mark as done
      const current = await queue.get(jobId);
      if (current && current.state === JobState.RUNNING) {
        await queue.update(jobId, {
          state: JobState.COMPLETED,
          result: result ?? null,
          finishedAt: new Date().toISOString(),
          progress: 100,
        });
      }

      await log(`Job completed`);
    } catch (err) {
      const errorMsg = err?.message ?? String(err);
      const current = await queue.get(jobId);
      if (current && current.state === JobState.RUNNING) {
        await queue.update(jobId, {
          state: JobState.FAILED,
          error: errorMsg,
          finishedAt: new Date().toISOString(),
        });
      }
      await log(`Job failed: ${errorMsg}`);
    }
  }

  /**
   * Start worker loop to process queued jobs
   * @param {Object} options
   * @param {number} options.intervalMs - Poll interval in ms
   * @param {number} options.maxConcurrent - Max concurrent jobs
   */
  async function start({ intervalMs = 1000, maxConcurrent = 5 } = {}) {
    let running = 0;

    const processNext = async () => {
      if (running >= maxConcurrent) return;

      const job = await queue.dequeue();
      if (!job) return;

      running++;
      runJob(job.id).finally(() => {
        running--;
      });
    };

    // Start polling
    const interval = setInterval(processNext, intervalMs);

    return {
      stop: () => clearInterval(interval),
    };
  }

  return {
    runJob,
    start,
  };
}
