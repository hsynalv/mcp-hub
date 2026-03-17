/**
 * Job Workspace Context Tests
 *
 * Tests workspace-aware job execution:
 * - job receives workspaceId in context
 * - job executes within workspace scope
 * - backward compatibility: fallback to "global" when workspaceId missing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { submitJob, registerJobRunner, clearHooks, getJob, resetForTesting } from "../../src/core/jobs.js";
import { clearHooks as clearToolHooks } from "../../src/core/tool-hooks.js";

describe("Job Workspace Context", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "";
    resetForTesting();
    clearHooks();
    clearToolHooks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearHooks();
    clearToolHooks();
  });

  async function waitForJob(id, maxWait = 500) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const j = await getJob(id);
      if (j && j.state !== "queued" && j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 20));
    }
    return getJob(id);
  }

  it("job receives workspaceId in context", async () => {
    let receivedContext = null;
    registerJobRunner("ws.receive", async (payload, context, updateProgress, log) => {
      receivedContext = context;
      await log("Received context");
      return { workspaceId: context.workspaceId };
    });

    const job = submitJob("ws.receive", { test: true }, {
      workspaceId: "ws-123",
      projectId: "proj-1",
      userId: "user-1",
    });

    await waitForJob(job.id);

    expect(receivedContext).not.toBeNull();
    expect(receivedContext.workspaceId).toBe("ws-123");
    expect(receivedContext.projectId).toBe("proj-1");
    expect(receivedContext.userId).toBe("user-1");
  });

  it("job executes within workspace scope", async () => {
    let executedWorkspaceId = null;
    registerJobRunner("ws.scope", async (payload, context, updateProgress, log) => {
      executedWorkspaceId = context.workspaceId ?? "global";
      await log(`Executing in workspace: ${executedWorkspaceId}`);
      return { scope: executedWorkspaceId };
    });

    const job = submitJob("ws.scope", {}, { workspaceId: "ws-abc" });
    const result = await waitForJob(job.id);

    expect(executedWorkspaceId).toBe("ws-abc");
    expect(result?.result?.scope).toBe("ws-abc");
  });

  it("job falls back to global when workspaceId missing (backward compatibility)", async () => {
    let receivedWorkspaceId = null;
    registerJobRunner("ws.fallback", async (payload, context, updateProgress, log) => {
      receivedWorkspaceId = context.workspaceId ?? "global";
      return { workspaceId: receivedWorkspaceId };
    });

    const job = submitJob("ws.fallback", {}, { projectId: "p1", userId: "u1" });
    await waitForJob(job.id);

    expect(receivedWorkspaceId).toBe("global");
  });

  it("job context is stored and returned in public view", async () => {
    registerJobRunner("ws.stored", async (payload, context) => {
      return { ok: true };
    });

    const job = submitJob("ws.stored", {}, {
      workspaceId: "ws-stored",
      projectId: "proj-stored",
      userId: "user-stored",
    });

    expect(job.context).toMatchObject({
      workspaceId: "ws-stored",
      projectId: "proj-stored",
      userId: "user-stored",
    });
  });
});
