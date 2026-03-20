import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { bootstrapStdioAuthContext } from "../../src/core/security/stdio-session-bootstrap.js";
import { getStdioSessionContext, clearStdioSessionContext } from "../../src/core/authorization/stdio-session-context.js";
import { getAuditManager } from "../../src/core/audit/index.js";
import { HubEventTypes } from "../../src/core/audit/event-types.js";
import { emitStdioBootstrapAuthDenied } from "../../src/core/audit/emit-stdio-auth.js";

const saved = {
  read: process.env.HUB_READ_KEY,
  write: process.env.HUB_WRITE_KEY,
  admin: process.env.HUB_ADMIN_KEY,
  open: process.env.HUB_ALLOW_OPEN_HUB,
  oauth: process.env.OAUTH_INTROSPECTION_ENDPOINT,
};

describe("stdio-session-bootstrap", () => {
  beforeEach(() => {
    clearStdioSessionContext();
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
    delete process.env.HUB_ALLOW_OPEN_HUB;
    delete process.env.OAUTH_INTROSPECTION_ENDPOINT;
  });

  afterEach(() => {
    clearStdioSessionContext();
    if (saved.read !== undefined) process.env.HUB_READ_KEY = saved.read;
    else delete process.env.HUB_READ_KEY;
    if (saved.write !== undefined) process.env.HUB_WRITE_KEY = saved.write;
    else delete process.env.HUB_WRITE_KEY;
    if (saved.admin !== undefined) process.env.HUB_ADMIN_KEY = saved.admin;
    else delete process.env.HUB_ADMIN_KEY;
    if (saved.open !== undefined) process.env.HUB_ALLOW_OPEN_HUB = saved.open;
    else delete process.env.HUB_ALLOW_OPEN_HUB;
    if (saved.oauth !== undefined) process.env.OAUTH_INTROSPECTION_ENDPOINT = saved.oauth;
    else delete process.env.OAUTH_INTROSPECTION_ENDPOINT;
  });

  it("open hub allows bootstrap without api key when keys are not configured", async () => {
    process.env.HUB_ALLOW_OPEN_HUB = "true";

    const sid = randomUUID();
    const out = await bootstrapStdioAuthContext({
      apiKey: null,
      scope: "read",
      workspaceId: "ws-1",
      sessionId: sid,
    });

    expect(out.ok).toBe(true);
    const ctx = getStdioSessionContext();
    expect(ctx?.authInfo?.scopes).toEqual(["read", "write", "admin"]);
    expect(ctx?.correlationId).toBe(`stdio-session-${sid}`);
  });

  it("fails when keys are configured but api key is missing", async () => {
    process.env.HUB_READ_KEY = "stdio-read-key-test";

    const sid = randomUUID();
    const out = await bootstrapStdioAuthContext({
      apiKey: null,
      sessionId: sid,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("unauthorized");
    expect(getStdioSessionContext()).toBeNull();
  });

  it("fails on invalid api key when keys are configured", async () => {
    process.env.HUB_READ_KEY = "stdio-read-key-test";

    const sid = randomUUID();
    const out = await bootstrapStdioAuthContext({
      apiKey: "wrong-key",
      sessionId: sid,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("invalid_token");
  });

  it("succeeds with valid read key and read scope", async () => {
    process.env.HUB_READ_KEY = "stdio-read-key-ok";

    const sid = randomUUID();
    const out = await bootstrapStdioAuthContext({
      apiKey: "stdio-read-key-ok",
      scope: "read",
      sessionId: sid,
    });

    expect(out.ok).toBe(true);
    expect(getStdioSessionContext()?.authInfo?.scopes).toContain("read");
  });

  it("fails when session requires write but token is read-only", async () => {
    process.env.HUB_READ_KEY = "stdio-read-only";
    process.env.HUB_WRITE_KEY = "stdio-write-key";

    const sid = randomUUID();
    const out = await bootstrapStdioAuthContext({
      apiKey: "stdio-read-only",
      scope: "write",
      sessionId: sid,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("insufficient_scope");
    expect(out.requiredScope).toBe("write");
  });

  it("emitStdioBootstrapAuthDenied records auth.denied with stdio metadata", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();

    const sid = randomUUID();
    await emitStdioBootstrapAuthDenied({
      sessionId: sid,
      reason: "invalid_token",
      errorCode: "invalid_token",
      workspaceId: "ws-a",
      projectId: null,
    });

    const entries = await manager.getRecentEntries({ limit: 50 });
    const hit = entries.find(
      (e) =>
        e.operation === HubEventTypes.AUTH_DENIED &&
        e.metadata?.hubDenySource === "stdio_auth" &&
        e.metadata?.hubSessionId === sid &&
        e.metadata?.hubTransport === "stdio"
    );
    expect(hit).toBeDefined();
  });
});
