/**
 * STDIO Workspace Context Tests
 *
 * Tests that STDIO tool calls receive workspace context from env vars
 * (HUB_WORKSPACE_ID, HUB_PROJECT_ID, HUB_ENV) when authInfo is not provided
 * by the transport. Mirrors HTTP behavior for workspace-aware execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMcpServerWithHandleRequest } from "../../src/mcp/gateway.js";
import { registerTool, clearTools } from "../../src/core/tool-registry.js";

// Mock policy engine
vi.mock("../../src/plugins/policy/policy.engine.js", () => ({
  evaluate: vi.fn(() => ({ allowed: true })),
}));

const originalEnv = process.env;

describe("STDIO Workspace Context", () => {
  beforeEach(() => {
    clearTools();
    // Reset env to avoid leakage between tests
    process.env = { ...originalEnv };
    delete process.env.HUB_WORKSPACE_ID;
    delete process.env.HUB_PROJECT_ID;
    delete process.env.HUB_ENV;
    // Open hub: empty authInfo mirrors STDIO unless session injects principal (host .env keys would block callTool)
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("workspaceId from env var HUB_WORKSPACE_ID when authInfo has no workspaceId", async () => {
    process.env.HUB_WORKSPACE_ID = "ws-env-123";

    let capturedContext = null;
    registerTool({
      name: "stdio_ctx_capture",
      description: "Captures context",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, context) => {
        capturedContext = context;
        return { received: true };
      },
    });

    const mcp = await createMcpServerWithHandleRequest();
    await mcp.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "stdio_ctx_capture", arguments: {} },
      },
      {} // Empty context simulates STDIO transport not passing authInfo
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.workspaceId).toBe("ws-env-123");
  });

  it("workspaceId from explicit context overrides env var", async () => {
    process.env.HUB_WORKSPACE_ID = "ws-env-override";

    let capturedContext = null;
    registerTool({
      name: "stdio_ctx_explicit",
      description: "Captures context",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, context) => {
        capturedContext = context;
        return { received: true };
      },
    });

    const mcp = await createMcpServerWithHandleRequest();
    await mcp.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "stdio_ctx_explicit", arguments: {} },
      },
      { workspaceId: "ws-explicit-456", projectId: "proj-explicit" }
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.workspaceId).toBe("ws-explicit-456");
    expect(capturedContext.projectId).toBe("proj-explicit");
  });

  it("fallback to null when no workspaceId in env or context (tools use global)", async () => {
    let capturedContext = null;
    registerTool({
      name: "stdio_ctx_fallback",
      description: "Captures context",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, context) => {
        capturedContext = context;
        const wsId = context.workspaceId || "global";
        return { workspaceId: wsId };
      },
    });

    const mcp = await createMcpServerWithHandleRequest();
    const response = await mcp.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "stdio_ctx_fallback", arguments: {} },
      },
      {}
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.workspaceId).toBeNull();
    const result = response?.result ?? response;
    const data = JSON.parse(result.content[0].text);
    expect(data.workspaceId).toBe("global");
  });

  it("projectId from env var HUB_PROJECT_ID when authInfo has no projectId", async () => {
    process.env.HUB_WORKSPACE_ID = "ws-proj";
    process.env.HUB_PROJECT_ID = "proj-env-789";

    let capturedContext = null;
    registerTool({
      name: "stdio_ctx_project",
      description: "Captures context",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, context) => {
        capturedContext = context;
        return { received: true };
      },
    });

    const mcp = await createMcpServerWithHandleRequest();
    await mcp.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "stdio_ctx_project", arguments: {} },
      },
      {}
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.workspaceId).toBe("ws-proj");
    expect(capturedContext.projectId).toBe("proj-env-789");
  });

  it("env from HUB_ENV when authInfo has no env", async () => {
    process.env.HUB_WORKSPACE_ID = "ws-env";
    process.env.HUB_ENV = "staging";

    let capturedContext = null;
    registerTool({
      name: "stdio_ctx_env",
      description: "Captures context",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, context) => {
        capturedContext = context;
        return { env: context.env };
      },
    });

    const mcp = await createMcpServerWithHandleRequest();
    await mcp.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "stdio_ctx_env", arguments: {} },
      },
      {}
    );

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.env).toBe("staging");
  });
});
