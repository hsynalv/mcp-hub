/**
 * Jobs Test Suite
 *
 * Tests for the job/queue system.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { JobStatus } from "./job.types.js";
import { JobStore, createJobStore } from "./job.store.js";
import { JobQueue, createJobQueue } from "./job.queue.js";
import { JobWorker, createJobWorker } from "./job.worker.js";
import { JobEventEmitter, JobEventType } from "./job.events.js";
import { JobManager, createJobManager } from "./job.manager.js";

describe("Job System", () => {
  describe("JobStore", () => {
    let store;

    beforeEach(() => {
      store = createJobStore();
    });

    it("should create a job", async () => {
      const job = await store.createJob({
        type: "test.job",
        plugin: "test",
        action: "job",
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.status).toBe(JobStatus.QUEUED);
      expect(job.progress).toBe(0);
      expect(job.createdAt).toBeDefined();
    });

    it("should get a job by ID", async () => {
      const created = await store.createJob({ type: "test.job" });
      const retrieved = await store.getJob(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
    });

    it("should return null for non-existent job", async () => {
      const job = await store.getJob("non-existent");
      expect(job).toBeNull();
    });

    it("should update a job", async () => {
      const job = await store.createJob({ type: "test.job" });
      const updated = await store.updateJob(job.id, {
        status: JobStatus.RUNNING,
        progress: 50,
      });

      expect(updated.status).toBe(JobStatus.RUNNING);
      expect(updated.progress).toBe(50);
    });

    it("should list jobs with filters", async () => {
      await store.createJob({ type: "test.job", plugin: "test" });
      await store.createJob({ type: "other.job", plugin: "other" });

      const result = await store.listJobs({ plugin: "test" });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].plugin).toBe("test");
    });

    it("should filter by status", async () => {
      const job1 = await store.createJob({ type: "test.job" });
      await store.updateJob(job1.id, { status: JobStatus.COMPLETED });
      await store.createJob({ type: "test.job2" });

      const result = await store.listJobs({ status: JobStatus.QUEUED });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].status).toBe(JobStatus.QUEUED);
    });

    it("should delete a job", async () => {
      const job = await store.createJob({ type: "test.job" });
      const deleted = await store.deleteJob(job.id);

      expect(deleted).toBe(true);
      expect(await store.getJob(job.id)).toBeNull();
    });

    it("should get jobs by workspace", async () => {
      await store.createJob({ type: "test.job", workspaceId: "ws-1" });
      await store.createJob({ type: "test.job", workspaceId: "ws-2" });
      await store.createJob({ type: "test.job", workspaceId: "ws-1" });

      const jobs = await store.getJobsByWorkspace("ws-1");
      expect(jobs).toHaveLength(2);
    });

    it("should get next queued job in FIFO order", async () => {
      await store.createJob({ type: "test.1" });
      const second = await store.createJob({ type: "test.2" });

      // Add priority to second job
      await store.updateJob(second.id, { priority: 10 });

      const next = await store.getNextQueuedJob();
      expect(next.type).toBe("test.2"); // Higher priority first
    });

    it("should count jobs by status", async () => {
      await store.createJob({ type: "test.1" });
      const job2 = await store.createJob({ type: "test.2" });
      await store.updateJob(job2.id, { status: JobStatus.RUNNING });

      const counts = await store.getJobCounts();
      expect(counts.queued).toBe(1);
      expect(counts.running).toBe(1);
      expect(counts.total).toBe(2);
    });
  });

  describe("JobQueue", () => {
    let store;
    let queue;

    beforeEach(() => {
      store = createJobStore();
      queue = createJobQueue({ store });
    });

    it("should dequeue next job", async () => {
      await store.createJob({ type: "test.job" });
      const job = await queue.dequeue();

      expect(job).toBeDefined();
      expect(job.type).toBe("test.job");
    });

    it("should return null when empty", async () => {
      const job = await queue.dequeue();
      expect(job).toBeNull();
    });

    it("should check if queue has jobs", async () => {
      expect(await queue.hasJobs()).toBe(false);

      await store.createJob({ type: "test.job" });
      expect(await queue.hasJobs()).toBe(true);
    });

    it("should get queue length", async () => {
      await store.createJob({ type: "test.job" });
      await store.createJob({ type: "test.job2" });

      const length = await queue.length();
      expect(length).toBe(2);
    });

    it("should pause and resume", () => {
      expect(queue.isPaused()).toBe(false);

      queue.pause();
      expect(queue.isPaused()).toBe(true);

      queue.resume();
      expect(queue.isPaused()).toBe(false);
    });
  });

  describe("JobWorker", () => {
    let store;
    let emitter;
    let worker;

    beforeEach(() => {
      store = createJobStore();
      emitter = new JobEventEmitter();
      worker = createJobWorker({ store, emitter });
    });

    it("should execute a job successfully", async () => {
      const job = await store.createJob({ type: "test.job" });

      const handler = async ({ updateProgress }) => {
        await updateProgress(50);
        return { result: "success" };
      };

      const result = await worker.execute(job, handler);

      expect(result).toEqual({ result: "success" });

      const updated = await store.getJob(job.id);
      expect(updated.status).toBe(JobStatus.COMPLETED);
      expect(updated.progress).toBe(100);
      expect(updated.output).toEqual({ result: "success" });
    });

    it("should handle job failure", async () => {
      const job = await store.createJob({ type: "test.job" });

      const handler = async () => {
        throw new Error("Job failed");
      };

      await expect(worker.execute(job, handler)).rejects.toThrow("Job failed");

      const updated = await store.getJob(job.id);
      expect(updated.status).toBe(JobStatus.FAILED);
      expect(updated.error).toBeDefined();
      expect(updated.error.message).toBe("Job failed");
    });

    it("should emit events during execution", async () => {
      const job = await store.createJob({ type: "test.job" });

      const events = [];
      emitter.on(JobEventType.STARTED, (e) => events.push(e.type));
      emitter.on(JobEventType.PROGRESS, (e) => events.push(e.type));
      emitter.on(JobEventType.COMPLETED, (e) => events.push(e.type));

      const handler = async ({ updateProgress }) => {
        await updateProgress(50);
        return { done: true };
      };

      await worker.execute(job, handler);

      expect(events).toContain(JobEventType.STARTED);
      expect(events).toContain(JobEventType.PROGRESS);
      expect(events).toContain(JobEventType.COMPLETED);
    });

    it("should handle cancellation", async () => {
      const job = await store.createJob({ type: "test.job" });

      const handler = async ({ signal }) => {
        // Simulate long running job
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (signal.aborted) {
          throw new Error("Cancelled");
        }

        return { result: "done" };
      };

      // Start execution
      const executePromise = worker.execute(job, handler);

      // Cancel immediately
      setTimeout(() => worker.cancel(), 10);

      await expect(executePromise).rejects.toThrow("cancelled");

      const updated = await store.getJob(job.id);
      expect(updated.status).toBe(JobStatus.CANCELLED);
    });

    it("should track running state", async () => {
      const job = await store.createJob({ type: "test.job" });

      expect(worker.isRunning()).toBe(false);

      const handler = async () => {
        expect(worker.isRunning()).toBe(true);
        expect(worker.getCurrentJob()).toBeDefined();
        return { done: true };
      };

      await worker.execute(job, handler);

      expect(worker.isRunning()).toBe(false);
      expect(worker.getCurrentJob()).toBeNull();
    });
  });

  describe("JobManager", () => {
    let manager;

    beforeEach(() => {
      manager = createJobManager({ config: { enabled: true } });
    });

    it("should submit a job", async () => {
      const job = await manager.submitJob("test.job", { data: "test" }, {
        plugin: "test",
        workspaceId: "ws-1",
      });

      expect(job).toBeDefined();
      expect(job.type).toBe("test.job");
      expect(job.status).toBe(JobStatus.QUEUED);
      expect(job.input).toEqual({ data: "test" });
      expect(job.workspaceId).toBe("ws-1");
    });

    it("should register and use handler", async () => {
      const handler = vi.fn().mockResolvedValue({ result: "done" });
      manager.registerHandler("test.job", handler);

      const job = await manager.submitJob("test.job", { test: true });

      // Start processing
      manager.startProcessing();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].job.id).toBe(job.id);

      manager.stopProcessing();
    });

    it("should get a job", async () => {
      const submitted = await manager.submitJob("test.job", {});
      const retrieved = await manager.getJob(submitted.id);

      expect(retrieved.id).toBe(submitted.id);
    });

    it("should list jobs", async () => {
      await manager.submitJob("test.1", {});
      await manager.submitJob("test.2", {});

      const result = await manager.listJobs();
      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should cancel a job", async () => {
      const job = await manager.submitJob("test.job", {});
      const cancelled = await manager.cancelJob(job.id);

      expect(cancelled).toBe(true);

      const updated = await manager.getJob(job.id);
      expect(updated.status).toBe(JobStatus.CANCELLED);
    });

    it("should not cancel completed jobs", async () => {
      const job = await manager.submitJob("test.job", {});
      await manager.store.updateJob(job.id, { status: JobStatus.COMPLETED });

      const cancelled = await manager.cancelJob(job.id);
      expect(cancelled).toBe(false);
    });

    it("should retry a failed job", async () => {
      const job = await manager.submitJob("test.job", {});
      await manager.store.updateJob(job.id, {
        status: JobStatus.FAILED,
        error: { message: "Error" },
      });

      const retried = await manager.retryJob(job.id);

      expect(retried).toBeDefined();
      expect(retried.status).toBe(JobStatus.QUEUED);
      expect(retried.error).toBeNull();
    });

    it("should delete a job", async () => {
      const job = await manager.submitJob("test.job", {});
      const deleted = await manager.deleteJob(job.id);

      expect(deleted).toBe(true);
      expect(await manager.getJob(job.id)).toBeNull();
    });

    it("should get job counts", async () => {
      await manager.submitJob("test.1", {});
      await manager.submitJob("test.2", {});
      const job3 = await manager.submitJob("test.3", {});
      await manager.store.updateJob(job3.id, { status: JobStatus.RUNNING });

      const counts = await manager.getJobCounts();
      expect(counts.queued).toBe(2);
      expect(counts.running).toBe(1);
      expect(counts.total).toBe(3);
    });

    it("should handle missing handler", async () => {
      const job = await manager.submitJob("unknown.type", {});

      manager.startProcessing();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updated = await manager.getJob(job.id);
      expect(updated.status).toBe(JobStatus.FAILED);
      expect(updated.error.code).toBe("NO_HANDLER");

      manager.stopProcessing();
    });

    it("should respect max concurrency", async () => {
      manager.config.maxConcurrency = 1;

      let runningCount = 0;
      let maxRunning = 0;

      const handler = async () => {
        runningCount++;
        maxRunning = Math.max(maxRunning, runningCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        runningCount--;
        return { done: true };
      };

      manager.registerHandler("test.job", handler);

      // Submit 3 jobs
      await manager.submitJob("test.job", {});
      await manager.submitJob("test.job", {});
      await manager.submitJob("test.job", {});

      manager.startProcessing();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(maxRunning).toBe(1); // Only 1 concurrent

      manager.stopProcessing();
    });

    it("should start and stop processing", () => {
      expect(manager.isRunning()).toBe(false);

      manager.startProcessing();
      expect(manager.isRunning()).toBe(true);

      manager.stopProcessing();
      expect(manager.isRunning()).toBe(false);
    });
  });

  describe("Job Events", () => {
    let emitter;

    beforeEach(() => {
      emitter = new JobEventEmitter();
    });

    it("should emit job created event", () => {
      const handler = vi.fn();
      emitter.on(JobEventType.CREATED, handler);

      const job = { id: "job-1", type: "test.job" };
      emitter.emitCreated(job);

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].type).toBe(JobEventType.CREATED);
      expect(handler.mock.calls[0][0].jobId).toBe("job-1");
    });

    it("should emit progress event with data", () => {
      const handler = vi.fn();
      emitter.on(JobEventType.PROGRESS, handler);

      const job = { id: "job-1" };
      emitter.emitProgress(job, 50, { stage: "processing" });

      expect(handler.mock.calls[0][0].progress).toBe(50);
      expect(handler.mock.calls[0][0].data).toEqual({ stage: "processing" });
    });

    it("should emit failure event with error", () => {
      const handler = vi.fn();
      emitter.on(JobEventType.FAILED, handler);

      const job = { id: "job-1" };
      const error = new Error("Test error");
      emitter.emitFailed(job, error);

      expect(handler.mock.calls[0][0].error.message).toBe("Test error");
    });
  });
});
