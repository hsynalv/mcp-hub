/**
 * MCP Workspace Context Tests
 *
 * Tests that verify workspace context (x-workspace-id, x-project-id) is
 * propagated from HTTP headers to MCP tool handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createMcpHttpMiddleware } from "../../src/mcp/http-transport.js";
import { createMcpServerWithHandleRequest } from "../../src/mcp/gateway.js";
import { registerTool, clearTools } from "../../src/core/tool-registry.js";

// Mock policy engine
vi.mock("../../src/plugins/policy/policy.engine.js", () => ({
  evaluate: vi.fn(() => ({ allowed: true })),
}));

describe("MCP Workspace Context", () => {
  let app;

  beforeAll(() => {
    // MCP calls in this suite omit Bearer; avoid host .env keys + empty token => insufficient_scope
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
    process.env.HUB_ALLOW_OPEN_HUB = "true";

    app = express();
    app.use(express.json());
    app.all("/mcp", createMcpHttpMiddleware());
  });

  beforeEach(() => {
    clearTools();
  });

  describe("HTTP request with workspace headers", () => {
    it("should pass workspaceId to tool handler via x-workspace-id header", async () => {
      let capturedContext = null;
      registerTool({
        name: "ctx_capture",
        description: "Captures context",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async (_args, context) => {
          capturedContext = context;
          return { received: true };
        },
      });

      await request(app)
        .post("/mcp")
        .set("x-workspace-id", "ws-123")
        .set("x-project-id", "proj-456")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ctx_capture", arguments: {} },
        })
        .expect(200);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.workspaceId).toBe("ws-123");
      expect(capturedContext.projectId).toBe("proj-456");
    });

    it("should pass projectId to tool handler via x-project-id header", async () => {
      let capturedContext = null;
      registerTool({
        name: "ctx_capture2",
        description: "Captures context",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async (_args, context) => {
          capturedContext = context;
          return { received: true };
        },
      });

      await request(app)
        .post("/mcp")
        .set("x-project-id", "my-project")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ctx_capture2", arguments: {} },
        })
        .expect(200);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.projectId).toBe("my-project");
    });

    it("should use global workspace when no headers provided", async () => {
      let capturedContext = null;
      registerTool({
        name: "ctx_capture3",
        description: "Captures context",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async (_args, context) => {
          capturedContext = context;
          return { received: true };
        },
      });

      await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ctx_capture3", arguments: {} },
        })
        .expect(200);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.workspaceId).toBeNull();
      expect(capturedContext.projectId).toBeNull();
    });
  });

  describe("handleRequest helper with context", () => {
    it("should receive workspaceId in tool handler", async () => {
      let capturedContext = null;
      registerTool({
        name: "ctx_tool",
        description: "Uses workspace",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async (_args, context) => {
          capturedContext = context;
          const wsId = context.workspaceId || "global";
          return { workspaceId: wsId };
        },
      });

      const mcp = await createMcpServerWithHandleRequest();
      await mcp.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ctx_tool", arguments: {} },
        },
        { workspaceId: "ws-test-123", projectId: "proj-test" }
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.workspaceId).toBe("ws-test-123");
      expect(capturedContext.projectId).toBe("proj-test");
    });

    it("should index in correct workspace when context provided", async () => {
      let indexedWorkspace = null;
      registerTool({
        name: "mock_index",
        description: "Mock index",
        inputSchema: {
          type: "object",
          properties: { doc: { type: "string" } },
        },
        handler: async (_args, context) => {
          indexedWorkspace = context.workspaceId || "global";
          return { indexed: true, workspaceId: indexedWorkspace };
        },
      });

      const mcp = await createMcpServerWithHandleRequest();
      const response = await mcp.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "mock_index", arguments: { doc: "test" } },
        },
        { workspaceId: "ws-indexed" }
      );

      const result = response?.result ?? response;
      expect(result.isError).toBe(false);
      expect(indexedWorkspace).toBe("ws-indexed");
      const data = JSON.parse(result.content[0].text);
      expect(data.workspaceId).toBe("ws-indexed");
    });
  });
});
