import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { filterVisibleTools, filterOptionsFromContext } from "../../../src/core/authorization/filter-visible-tools.js";
import { resolvePrincipalScopes, maxScopeRank } from "../../../src/core/authorization/resolve-principal.js";
import { authorizeToolCall } from "../../../src/core/authorization/authorize-tool-call.js";
import { registerTool, clearTools } from "../../../src/core/tool-registry.js";
import { ToolTags } from "../../../src/core/tool-tags.js";

describe("authorization helpers", () => {
  const prevKeys = {
    HUB_READ_KEY: process.env.HUB_READ_KEY,
    HUB_WRITE_KEY: process.env.HUB_WRITE_KEY,
    HUB_ADMIN_KEY: process.env.HUB_ADMIN_KEY,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prevKeys)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("resolvePrincipalScopes is full when hub auth disabled", () => {
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
    expect(resolvePrincipalScopes({})).toEqual(["read", "write", "admin"]);
  });

  it("resolvePrincipalScopes uses actor.scopes when auth enabled", () => {
    process.env.HUB_READ_KEY = "test-read-key-for-authz-unit";
    expect(
      resolvePrincipalScopes({
        actor: { type: "api_key", scopes: ["read"] },
      })
    ).toEqual(["read"]);
  });

  it("maxScopeRank orders scopes", () => {
    expect(maxScopeRank(["read"])).toBe(0);
    expect(maxScopeRank(["read", "write"])).toBe(1);
    expect(maxScopeRank(["admin"])).toBe(2);
  });

  it("filterVisibleTools hides write tools for read-only principal", () => {
    const tools = [
      { name: "a", plugin: "p", tags: [ToolTags.READ_ONLY] },
      { name: "b", plugin: "p", tags: [ToolTags.WRITE] },
    ];
    const visible = filterVisibleTools(tools, { workspaceId: "global", scopes: ["read"] });
    expect(visible.map((t) => t.name)).toEqual(["a"]);
  });

  it("filterOptionsFromContext maps context fields", () => {
    const o = filterOptionsFromContext({
      workspaceId: "ws1",
      actor: { scopes: ["read"] },
    });
    expect(o.workspaceId).toBe("ws1");
    expect(o.scopes).toContain("read");
  });
});

describe("authorizeToolCall", () => {
  beforeEach(() => {
    clearTools();
  });

  afterEach(() => {
    clearTools();
    delete process.env.HUB_READ_KEY;
  });

  it("denies when auth enabled and no scopes on context", async () => {
    process.env.HUB_READ_KEY = "k-authz-gate";
    registerTool({
      name: "authz_ping",
      description: "t",
      inputSchema: { type: "object", properties: { noop: { type: "string" } } },
      plugin: "test",
      tags: [ToolTags.READ_ONLY],
      handler: async () => ({ ok: true, data: {} }),
    });
    const tool = { name: "authz_ping", plugin: "test", tags: [ToolTags.READ_ONLY] };
    const block = await authorizeToolCall({
      name: "authz_ping",
      tool,
      args: {},
      context: { workspaceId: "global" },
    });
    expect(block?.ok).toBe(false);
    expect(block.error.code).toBe("insufficient_scope");
  });
});
