/**
 * Job lifecycle hub events for rag.ingestion-shaped jobs (production runner type + context)
 * without loading the full rag-ingestion plugin.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerJobRunner,
  submitJob,
  resetForTesting,
  clearHooks,
} from "../../src/core/jobs.js";
import { getAuditManager, HubEventTypes } from "../../src/core/audit/index.js";

describe("job lifecycle hub events (rag.ingestion-shaped)", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "";
    resetForTesting();
    clearHooks();
    registerJobRunner("rag.ingestion", async () => ({ ok: true }));
  });

  it("emits submitted, started, completed with shared correlation id", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    submitJob(
      "rag.ingestion",
      { request: {}, context: {} },
      {
        workspaceId: "ws-rag",
        projectId: "proj-rag",
        userId: "user-rag",
        correlationId: "corr-rag-lifecycle",
        tenantId: "ten-rag",
      }
    );

    await vi.waitFor(async () => {
      const entries = await manager.getRecentEntries({ limit: 80 });
      const types = new Set(entries.map((e) => e.operation));
      if (!types.has(HubEventTypes.JOB_SUBMITTED)) throw new Error("missing submitted");
      if (!types.has(HubEventTypes.JOB_STARTED)) throw new Error("missing started");
      if (!types.has(HubEventTypes.JOB_COMPLETED)) throw new Error("missing completed");
    }, { timeout: 4000 });

    const entries = await manager.getRecentEntries({ limit: 80 });
    const withCorr = entries.filter(
      (e) => e.correlationId === "corr-rag-lifecycle" && e.metadata?.hubJobType === "rag.ingestion"
    );
    expect(withCorr.length).toBeGreaterThanOrEqual(3);
  });
});
