/**
 * Jobs API Integration Tests
 *
 * Tests covering:
 * - POST /jobs with valid/unknown job types
 * - GET /jobs returns submitted jobs
 * - GET /jobs/:id returns correct job
 * - Failed jobs expose error state
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Import jobs module to register runners
import {
  registerJobRunner,
  clearHooks,
  resetForTesting,
} from "../src/core/jobs.js";

// Disable auth for job API tests (open mode)
const _origRead = process.env.HUB_READ_KEY;
const _origWrite = process.env.HUB_WRITE_KEY;
const _origAdmin = process.env.HUB_ADMIN_KEY;

// Import tool-hooks to clear between tests
import { clearHooks as clearToolHooks } from "../src/core/tool-hooks.js";

// Import server factory
import { createServer } from "../src/core/server.js";

describe("Jobs API Integration", () => {
  let app;
  let request;

  beforeEach(async () => {
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
    process.env.REDIS_URL = "";
    resetForTesting();
    clearHooks();
    clearToolHooks();

    app = await createServer();
    request = supertest(app);

    registerJobRunner("test.job", async (payload, context, updateProgress, log) => {
      await log("Starting test job");
      await updateProgress(50);

      if (payload.shouldFail) {
        throw new Error("Job failed as requested");
      }

      await updateProgress(100);
      await log("Test job completed");
      return { processed: true, input: payload, workspaceId: context.workspaceId };
    });

    registerJobRunner("slow.job", async (payload, context, updateProgress, log) => {
      await log("Starting slow job");
      await new Promise(resolve => setTimeout(resolve, 50));
      await updateProgress(100);
      return { completed: true };
    });
  });

  afterEach(() => {
    if (_origRead !== undefined) process.env.HUB_READ_KEY = _origRead;
    else delete process.env.HUB_READ_KEY;
    if (_origWrite !== undefined) process.env.HUB_WRITE_KEY = _origWrite;
    else delete process.env.HUB_WRITE_KEY;
    if (_origAdmin !== undefined) process.env.HUB_ADMIN_KEY = _origAdmin;
    else delete process.env.HUB_ADMIN_KEY;
    clearHooks();
    clearToolHooks();
  });

  describe("POST /jobs", () => {
    it("should submit job with valid registered type", async () => {
      const response = await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({
          type: "test.job",
          payload: { foo: "bar" },
        });

      expect(response.status).toBe(202);
      expect(response.body.ok).toBe(true);
      expect(response.body.data.job).toMatchObject({
        type: "test.job",
        state: "queued",
        context: expect.objectContaining({
          workspaceId: expect.any(String),
          projectId: "test-project",
          env: "test-env",
        }),
        progress: 0,
      });
      expect(response.body.data.job.id).toBeDefined();
      expect(response.body.data.job.createdAt).toBeDefined();
    });

    it("should return error for unknown job type", async () => {
      const response = await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({
          type: "unknown.job.type",
          payload: {},
        });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.error.code).toBe("job_type_not_supported");
      expect(response.body.error.message).toContain("unknown.job.type");
    });

    it("should require job type in request", async () => {
      const response = await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({
          payload: { foo: "bar" },
        });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.error.code).toBe("missing_type");
    });
  });

  describe("GET /jobs", () => {
    it("should return submitted jobs", async () => {
      // Submit a few jobs
      await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({ type: "test.job", payload: { id: 1 } });

      await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({ type: "test.job", payload: { id: 2 } });

      // List jobs
      const response = await request
        .get("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
      expect(response.body.jobs[0]).toMatchObject({
        type: "test.job",
        state: expect.any(String),
      });
    });

    it("should filter jobs by type", async () => {
      // Submit different job types
      await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({ type: "test.job", payload: {} });

      await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({ type: "slow.job", payload: {} });

      // Filter by type
      const response = await request
        .get("/jobs?type=test.job")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(200);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.jobs[0].type).toBe("test.job");
    });

    it("should return empty array when no jobs", async () => {
      const response = await request
        .get("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
      expect(response.body.jobs).toEqual([]);
    });
  });

  describe("GET /jobs/:id", () => {
    it("should return correct job by id", async () => {
      // Submit a job
      const submitResponse = await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({ type: "test.job", payload: { foo: "bar" } });

      const jobId = submitResponse.body.data.job.id;

      // Get job by ID
      const response = await request
        .get(`/jobs/${jobId}`)
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(200);
      expect(response.body.job).toMatchObject({
        id: jobId,
        type: "test.job",
        state: expect.any(String),
        context: expect.objectContaining({
          workspaceId: expect.any(String),
          projectId: "test-project",
          env: "test-env",
        }),
        progress: expect.any(Number),
        logCount: expect.any(Number),
        createdAt: expect.any(String),
      });
    });

    it("should return 404 for non-existent job", async () => {
      const response = await request
        .get("/jobs/non-existent-id")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(404);
      expect(response.body.ok).toBe(false);
      expect(response.body.error.code).toBe("job_not_found");
    });
  });

  describe("Failed job state", () => {
    it("should expose error state for failed jobs", async () => {
      // Submit a job that will fail
      const submitResponse = await request
        .post("/jobs")
        .set("x-project-id", "test-project")
        .set("x-env", "test-env")
        .send({
          type: "test.job",
          payload: { shouldFail: true },
        });

      const jobId = submitResponse.body.data.job.id;

      // Wait for job to complete (fail)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get job state
      const response = await request
        .get(`/jobs/${jobId}`)
        .set("x-project-id", "test-project")
        .set("x-env", "test-env");

      expect(response.status).toBe(200);
      expect(response.body.job.state).toBe("failed");
      expect(response.body.job.error).toBe("Job failed as requested");
      expect(response.body.job.finishedAt).toBeDefined();
    });
  });
});
