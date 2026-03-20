import { describe, it, expect, beforeEach } from "vitest";
import {
  emitHubAuditEvent,
  emitDiscoveryRequestedEvent,
  emitDiscoveryFilteredEvent,
} from "../../src/core/audit/emit-hub-event.js";
import { emitJobLifecycleHubEvent } from "../../src/core/audit/emit-job-event.js";
import { HubEventTypes, HubOutcomes } from "../../src/core/audit/event-types.js";
import { getAuditManager } from "../../src/core/audit/index.js";
import { getMetricsRegistry } from "../../src/core/observability/metrics.js";
import { hubEventTypeFromAuthzPhase } from "../../src/core/audit/normalize-deny-event.js";
import { DiscoverySurfaces } from "../../src/core/audit/discovery-surfaces.js";

describe("hub telemetry", () => {
  beforeEach(() => {
    getMetricsRegistry().clear();
  });

  it("emitHubAuditEvent writes tool.execution.completed to AuditManager", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    await emitHubAuditEvent({
      eventType: HubEventTypes.TOOL_EXECUTION_COMPLETED,
      outcome: HubOutcomes.SUCCESS,
      plugin: "test-plugin",
      actor: "u1",
      workspaceId: "ws1",
      correlationId: "corr-test-1",
      durationMs: 12,
      allowed: true,
      success: true,
      metadata: {
        hubToolName: "my_tool",
        hubPlugin: "test-plugin",
      },
    });

    const entries = await manager.getRecentEntries({ limit: 5 });
    const hit = entries.find((e) => e.operation === HubEventTypes.TOOL_EXECUTION_COMPLETED);
    expect(hit).toBeDefined();
    expect(hit?.metadata?.hubEventType).toBe(HubEventTypes.TOOL_EXECUTION_COMPLETED);
    expect(hit?.metadata?.hubToolName).toBe("my_tool");
  });

  it("emitJobLifecycleHubEvent writes job.cancelled to AuditManager and metrics", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    getMetricsRegistry().clear();

    await emitJobLifecycleHubEvent(
      {
        id: "job-cancel-1",
        type: "demo.job",
        context: {
          workspaceId: "w1",
          userId: "u1",
          correlationId: "corr-can",
          invokeSource: "internal",
        },
        state: "cancelled",
        finishedAt: new Date().toISOString(),
      },
      "cancelled",
      { queueBackend: "memory", cancelSource: "user", durationMs: 12 }
    );

    const entries = await manager.getRecentEntries({ limit: 15 });
    const hit = entries.find((e) => e.operation === HubEventTypes.JOB_CANCELLED);
    expect(hit?.metadata?.hubCancelSource).toBe("user");
    expect(hit?.metadata?.hubInvokeSource).toBe("internal");

    const snap = getMetricsRegistry().snapshot();
    expect(
      Object.values(snap.counters).some(
        (c) =>
          c.name === "job_lifecycle_events_total" &&
          c.labels?.event_type === HubEventTypes.JOB_CANCELLED
      )
    ).toBe(true);
  });

  it("emitJobLifecycleHubEvent writes job.submitted to AuditManager and metrics", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    getMetricsRegistry().clear();

    await emitJobLifecycleHubEvent(
      {
        id: "job-telemetry-1",
        type: "rag.ingestion",
        context: {
          workspaceId: "w1",
          projectId: "p1",
          userId: "actor-1",
          correlationId: "corr-job-tel-1",
          tenantId: "t1",
        },
      },
      "submitted",
      { queueBackend: "memory" }
    );

    const entries = await manager.getRecentEntries({ limit: 15 });
    const hit = entries.find((e) => e.operation === HubEventTypes.JOB_SUBMITTED);
    expect(hit?.metadata?.hubJobType).toBe("rag.ingestion");
    expect(hit?.plugin).toBe("rag");
    expect(hit?.correlationId).toBe("corr-job-tel-1");

    const snap = getMetricsRegistry().snapshot();
    expect(
      Object.values(snap.counters).some(
        (c) =>
          c.name === "job_lifecycle_events_total" &&
          c.labels?.event_type === HubEventTypes.JOB_SUBMITTED &&
          c.labels?.job_type === "rag.ingestion"
      )
    ).toBe(true);
  });

  it("recordMetricFromHubEvent increments tool_calls on completed", async () => {
    getMetricsRegistry().clear();
    await emitHubAuditEvent({
      eventType: HubEventTypes.TOOL_EXECUTION_COMPLETED,
      outcome: HubOutcomes.SUCCESS,
      plugin: "p",
      workspaceId: "global",
      correlationId: "c2",
      durationMs: 5,
      allowed: true,
      success: true,
      metadata: { hubToolName: "t1", hubPlugin: "p" },
    });
    const snap = getMetricsRegistry().snapshot();
    const counters = Object.values(snap.counters);
    expect(counters.some((c) => c.name === "tool_calls_total" && c.value >= 1)).toBe(true);
  });

  it("hubEventTypeFromAuthzPhase maps phases to deny event types", () => {
    expect(hubEventTypeFromAuthzPhase("scope")).toBe(HubEventTypes.AUTH_DENIED);
    expect(hubEventTypeFromAuthzPhase("policy")).toBe(HubEventTypes.POLICY_DENIED);
    expect(hubEventTypeFromAuthzPhase("tenant")).toBe(HubEventTypes.TENANT_DENIED);
    expect(hubEventTypeFromAuthzPhase("workspace_permission")).toBe(HubEventTypes.WORKSPACE_DENIED);
  });

  it("emitDiscoveryRequestedEvent writes hubDiscoverySurface and increments discovery metrics", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    getMetricsRegistry().clear();

    await emitDiscoveryRequestedEvent({
      transport: "mcp",
      discoverySurface: DiscoverySurfaces.MCP_TOOLS_LIST,
      correlationId: "disc-req-1",
      workspaceId: "global",
      actor: "anonymous",
    });

    const entries = await manager.getRecentEntries({ limit: 10 });
    const hit = entries.find((e) => e.operation === HubEventTypes.DISCOVERY_REQUESTED);
    expect(hit?.metadata?.hubDiscoverySurface).toBe(DiscoverySurfaces.MCP_TOOLS_LIST);

    const snap = getMetricsRegistry().snapshot();
    expect(
      Object.values(snap.counters).some(
        (c) => c.name === "discovery_events_total" && c.labels?.surface === DiscoverySurfaces.MCP_TOOLS_LIST
      )
    ).toBe(true);
  });

  it("emitDiscoveryFilteredEvent sets hubFilteredCount", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    await emitDiscoveryFilteredEvent({
      transport: "mcp",
      discoverySurface: DiscoverySurfaces.MCP_TOOLS_LIST,
      correlationId: "disc-filt-1",
      workspaceId: "global",
      actor: "u",
      totalCount: 10,
      visibleCount: 4,
    });

    const entries = await manager.getRecentEntries({ limit: 10 });
    const hit = entries.find((e) => e.operation === HubEventTypes.DISCOVERY_FILTERED);
    expect(hit?.metadata?.hubFilteredCount).toBe(6);
  });
});
