/**
 * Terminal lifecycle: cancel, failure reasons, correlation chain (core jobs.js).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerJobRunner,
  submitJob,
  resetForTesting,
  clearHooks,
  cancelJob,
} from "../../src/core/jobs.js";
import {
  getAuditManager,
  HubEventTypes,
  resetHubJobLifecycleEmitFailuresForTesting,
  getHubJobLifecycleEmitFailureCount,
} from "../../src/core/audit/index.js";
import * as hubEmit from "../../src/core/audit/emit-hub-event.js";
import { getMetricsRegistry } from "../../src/core/observability/metrics.js";

describe("job lifecycle terminal states", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "";
    resetForTesting();
    clearHooks();
    getMetricsRegistry().clear();
    resetHubJobLifecycleEmitFailuresForTesting();
  });

  it("cancel queued job emits job.cancelled with stable correlationId", async () => {
    let releaseRun;
    const hold = new Promise((r) => {
      releaseRun = r;
    });
    registerJobRunner("gate.job", async () => {
      await hold;
      return { ok: true };
    });

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const view = submitJob("gate.job", {}, {
      workspaceId: "w-can",
      correlationId: "corr-terminal-q",
      invokeSource: "internal",
    });

    const ok = await cancelJob(view.id, { cancelSource: "user" });
    expect(ok).toBe(true);

    await vi.waitFor(async () => {
      const entries = await manager.getRecentEntries({ limit: 80 });
      const c = entries.find((e) => e.operation === HubEventTypes.JOB_CANCELLED);
      expect(c?.correlationId).toBe("corr-terminal-q");
      expect(c?.metadata?.hubCancelSource).toBe("user");
      expect(c?.metadata?.hubJobStatus).toBe("cancelled");
      expect(c?.metadata?.hubPreCancelState).toBe("queued");
    });

    releaseRun();
  });

  it("cancel running job emits job.cancelled after started", async () => {
    let proceed;
    const hold = new Promise((r) => {
      proceed = r;
    });
    registerJobRunner("slow.cancel", async () => {
      await hold;
      return { ok: true };
    });

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const view = submitJob("slow.cancel", {}, {
      correlationId: "corr-terminal-r",
      invokeSource: "internal",
    });

    await vi.waitFor(async () => {
      const entries = await manager.getRecentEntries({ limit: 80 });
      if (!entries.some((e) => e.operation === HubEventTypes.JOB_STARTED)) {
        throw new Error("no started");
      }
    }, { timeout: 3000 });

    const ok = await cancelJob(view.id, { cancelSource: "system" });
    expect(ok).toBe(true);

    await vi.waitFor(async () => {
      const entries = await manager.getRecentEntries({ limit: 100 });
      const c = entries.find((e) => e.operation === HubEventTypes.JOB_CANCELLED);
      expect(c?.metadata?.hubCancelSource).toBe("system");
      expect(c?.metadata?.hubPreCancelState).toBe("running");
    });

    proceed();
  });

  it("failed runner emits hubFailureReason runner_error", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    registerJobRunner("throw.job", async () => {
      throw new Error("boom");
    });

    submitJob("throw.job", {}, { correlationId: "corr-fail-reason", invokeSource: "internal" });

    await vi.waitFor(async () => {
      const entries = await manager.getRecentEntries({ limit: 60 });
      const f = entries.find((e) => e.operation === HubEventTypes.JOB_FAILED);
      expect(f?.metadata?.hubFailureReason).toBe("runner_error");
      expect(f?.correlationId).toBe("corr-fail-reason");
    }, { timeout: 4000 });
  });

  it("increments job_lifecycle for cancelled with cancel_source label", async () => {
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    registerJobRunner("metric.gate", async () => {
      await hold;
      return { ok: true };
    });
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    getMetricsRegistry().clear();

    const view = submitJob("metric.gate", {}, { invokeSource: "internal" });
    await cancelJob(view.id, { cancelSource: "user" });

    await vi.waitFor(async () => {
      const snap = getMetricsRegistry().snapshot();
      const hit = Object.values(snap.counters).find(
        (c) =>
          c.name === "job_lifecycle_events_total" &&
          c.labels?.event_type === HubEventTypes.JOB_CANCELLED
      );
      expect(hit?.labels?.cancel_source).toBe("user");
    });
    release();
  });

  it("failed hub job emit increments counter and logs when emitHubAuditEvent throws", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    const spy = vi.spyOn(hubEmit, "emitHubAuditEvent").mockRejectedValue(new Error("audit_sink_down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerJobRunner("emit.fail.job", async () => ({ ok: 1 }));
    submitJob("emit.fail.job", {}, { invokeSource: "internal" });

    await vi.waitFor(() => {
      expect(getHubJobLifecycleEmitFailureCount()).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
    expect(warnSpy).toHaveBeenCalled();
    const payload = warnSpy.mock.calls.find((c) => {
      try {
        const j = JSON.parse(c[0]);
        return j.msg === "hub_job_lifecycle_emit_failed";
      } catch {
        return false;
      }
    });
    expect(payload).toBeDefined();

    spy.mockRestore();
    warnSpy.mockRestore();
  });
});
