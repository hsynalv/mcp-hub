import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { createServer } from "../../src/core/server.js";
import { getAuditManager } from "../../src/core/audit/index.js";
import { HubEventTypes } from "../../src/core/audit/event-types.js";
import { getMetricsRegistry } from "../../src/core/observability/metrics.js";
import {
  normalizeHttpDenyEvent,
  emitHttpRequestReceived,
  emitHttpRequestCompleted,
} from "../../src/core/audit/index.js";

describe("HTTP hub telemetry", () => {
  beforeEach(() => {
    getMetricsRegistry().clear();
  });

  it("normalizeHttpDenyEvent maps enforce / scope / policy variants", () => {
    expect(
      normalizeHttpDenyEvent({
        source: "enforce_security_context",
        statusCode: 401,
        errorCode: "invalid_token",
      }).eventType
    ).toBe(HubEventTypes.AUTH_DENIED);

    expect(
      normalizeHttpDenyEvent({
        source: "require_scope",
        statusCode: 403,
        errorCode: "forbidden",
        requiredScope: "write",
      }).metadata.hubDenyKind
    ).toBe("insufficient_scope");

    expect(
      normalizeHttpDenyEvent({
        source: "policy_guard",
        statusCode: 503,
        errorCode: "policy_unavailable",
      }).metadata.hubDenyKind
    ).toBe("policy_unavailable");

    expect(
      normalizeHttpDenyEvent({
        source: "policy_guard",
        statusCode: 429,
        errorCode: "policy_rate_limit",
        policyLimit: 10,
        policyWindow: 60,
      }).metadata.hubDenyKind
    ).toBe("policy_rate_limit");
  });

  it("emitHttpRequestReceived and completed write AuditManager and metrics", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    /** @type {import("express").Request} */
    const req = {
      method: "GET",
      path: "/plugins",
      requestId: "rid-1",
      correlationId: "cid-1",
      workspaceId: "ws-a",
      actor: { type: "api_key", scopes: ["read"] },
    };
    /** @type {import("express").Response} */
    const res = { statusCode: 200 };

    await emitHttpRequestReceived(req);
    await emitHttpRequestCompleted(req, res, 42);

    const entries = await manager.getRecentEntries({ limit: 20 });
    expect(entries.some((e) => e.operation === HubEventTypes.HTTP_REQUEST_RECEIVED)).toBe(true);
    expect(entries.some((e) => e.operation === HubEventTypes.HTTP_REQUEST_COMPLETED)).toBe(true);

    const snap = getMetricsRegistry().snapshot();
    const counterNames = Object.values(snap.counters).map((c) => c.name);
    expect(counterNames.filter((n) => n === "http_request_events_total").length).toBeGreaterThan(0);
    expect(counterNames.some((n) => n === "http_requests_total")).toBe(true);
  });
});

describe("HTTP hub telemetry integration", () => {
  const saved = {
    open: process.env.HUB_ALLOW_OPEN_HUB,
    read: process.env.HUB_READ_KEY,
    write: process.env.HUB_WRITE_KEY,
    admin: process.env.HUB_ADMIN_KEY,
  };

  afterEach(() => {
    if (saved.open !== undefined) process.env.HUB_ALLOW_OPEN_HUB = saved.open;
    else delete process.env.HUB_ALLOW_OPEN_HUB;
    if (saved.read !== undefined) process.env.HUB_READ_KEY = saved.read;
    else delete process.env.HUB_READ_KEY;
    if (saved.write !== undefined) process.env.HUB_WRITE_KEY = saved.write;
    else delete process.env.HUB_WRITE_KEY;
    if (saved.admin !== undefined) process.env.HUB_ADMIN_KEY = saved.admin;
    else delete process.env.HUB_ADMIN_KEY;
  });

  it("records auth.denied in AuditManager on 401 when hub is not open", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "false";
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const app = await createServer();
    const request = supertest(app);

    const res = await request.get("/whoami");
    expect(res.status).toBe(401);

    const entries = await manager.getRecentEntries({ limit: 200 });
    const hit = entries.find(
      (e) =>
        e.operation === HubEventTypes.AUTH_DENIED &&
        e.metadata?.hubHttpPath === "/whoami" &&
        e.metadata?.hubDenySource === "enforce_security_context"
    );
    expect(hit).toBeDefined();
  });

  it("records auth.denied on insufficient scope (read key to write route)", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "false";
    process.env.HUB_READ_KEY = "test-read-http-hub";
    process.env.HUB_WRITE_KEY = "test-write-http-hub";
    delete process.env.HUB_ADMIN_KEY;

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const app = await createServer();
    const request = supertest(app);

    const res = await request
      .post("/jobs")
      .set("Authorization", "Bearer test-read-http-hub")
      .set("x-project-id", "p")
      .set("x-env", "e")
      .send({ type: "noop", payload: {} });

    expect(res.status).toBe(403);

    const entries = await manager.getRecentEntries({ limit: 80 });
    const hit = entries.find(
      (e) =>
        e.operation === HubEventTypes.AUTH_DENIED &&
        e.metadata?.hubDenyKind === "insufficient_scope"
    );
    expect(hit).toBeDefined();
  });
});
