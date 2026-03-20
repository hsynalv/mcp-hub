import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { createServer } from "../../src/core/server.js";
import { getAuditManager } from "../../src/core/audit/index.js";
import { HubEventTypes } from "../../src/core/audit/event-types.js";
import { DiscoverySurfaces } from "../../src/core/audit/discovery-surfaces.js";
import { getMetricsRegistry } from "../../src/core/observability/metrics.js";

describe("REST discovery telemetry", () => {
  const saved = {
    open: process.env.HUB_ALLOW_OPEN_HUB,
    read: process.env.HUB_READ_KEY,
    write: process.env.HUB_WRITE_KEY,
    admin: process.env.HUB_ADMIN_KEY,
  };

  beforeEach(() => {
    getMetricsRegistry().clear();
  });

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

  it("GET /plugins emits discovery.requested and discovery.filtered with rest.plugins.list", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "false";
    process.env.HUB_READ_KEY = "rest-disc-read-key";
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const app = await createServer();
    const request = supertest(app);

    const res = await request.get("/plugins").set("Authorization", "Bearer rest-disc-read-key");
    expect(res.status).toBe(200);

    const entries = await manager.getRecentEntries({ limit: 120 });
    const reqd = entries.filter(
      (e) =>
        e.operation === HubEventTypes.DISCOVERY_REQUESTED &&
        e.metadata?.hubDiscoverySurface === DiscoverySurfaces.REST_PLUGINS_LIST
    );
    const filt = entries.filter(
      (e) =>
        e.operation === HubEventTypes.DISCOVERY_FILTERED &&
        e.metadata?.hubDiscoverySurface === DiscoverySurfaces.REST_PLUGINS_LIST
    );
    expect(reqd.length).toBeGreaterThanOrEqual(1);
    expect(filt.length).toBeGreaterThanOrEqual(1);
    expect(typeof filt[0]?.metadata?.hubTotalCount).toBe("number");
    expect(typeof filt[0]?.metadata?.hubVisibleCount).toBe("number");
    expect(filt[0]?.metadata?.hubFilteredCount).toBe(
      Math.max(0, filt[0].metadata.hubTotalCount - filt[0].metadata.hubVisibleCount)
    );

    const snap = getMetricsRegistry().snapshot();
    const discoveryCounters = Object.values(snap.counters).filter((c) => c.name === "discovery_events_total");
    expect(discoveryCounters.length).toBeGreaterThan(0);
    expect(discoveryCounters.some((c) => c.labels?.surface === DiscoverySurfaces.REST_PLUGINS_LIST)).toBe(true);
  });

  it("GET /openapi.json emits discovery events with rest.openapi.aggregate", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "false";
    process.env.HUB_READ_KEY = "rest-disc-openapi-key";
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;

    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const app = await createServer();
    const request = supertest(app);

    const res = await request.get("/openapi.json").set("Authorization", "Bearer rest-disc-openapi-key");
    expect(res.status).toBe(200);

    const entries = await manager.getRecentEntries({ limit: 120 });
    const surf = entries.filter(
      (e) =>
        (e.operation === HubEventTypes.DISCOVERY_REQUESTED ||
          e.operation === HubEventTypes.DISCOVERY_FILTERED) &&
        e.metadata?.hubDiscoverySurface === DiscoverySurfaces.REST_OPENAPI_AGGREGATE
    );
    expect(surf.length).toBeGreaterThanOrEqual(2);
  });

  it("GET unknown manifest emits discovery.denied", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "false";
    process.env.HUB_READ_KEY = "rest-disc-manifest-key";
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;

    getMetricsRegistry().clear();
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const app = await createServer();
    const request = supertest(app);

    const res = await request
      .get("/plugins/does-not-exist-plugin-xyz/manifest")
      .set("Authorization", "Bearer rest-disc-manifest-key");
    expect(res.status).toBe(404);

    const entries = await manager.getRecentEntries({ limit: 80 });
    const denied = entries.find(
      (e) =>
        e.operation === HubEventTypes.DISCOVERY_DENIED &&
        e.metadata?.hubDiscoverySurface === DiscoverySurfaces.REST_PLUGIN_MANIFEST
    );
    expect(denied).toBeDefined();
    expect(denied?.metadata?.hubErrorCode).toBe("plugin_not_found");

    const snap = getMetricsRegistry().snapshot();
    expect(Object.values(snap.counters).some((c) => c.name === "discovery_denials_total")).toBe(true);
  });
});
