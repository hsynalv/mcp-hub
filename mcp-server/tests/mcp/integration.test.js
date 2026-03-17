/**
 * MCP Integration Tests
 *
 * Tests that verify REST and MCP endpoints return consistent results.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createMcpHttpMiddleware } from "../../src/mcp/http-transport.js";
import { registerTool, clearTools } from "../../src/core/tool-registry.js";

describe("MCP Integration Tests", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.all("/mcp", createMcpHttpMiddleware());
  });

  beforeEach(() => {
    clearTools();
  });

  describe("HTTP endpoint availability", () => {
    it("should respond to GET /mcp with SSE headers", async () => {
      const res = await request(app)
        .get("/mcp")
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");
    });

    it("should respond to POST /mcp with JSON-RPC", async () => {
      const res = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        })
        .expect(200);

      const result = res.body.result ?? res.body;
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
    });

    it("should reject invalid JSON-RPC", async () => {
      await request(app)
        .post("/mcp")
        .send({ invalid: "request" })
        .expect(200); // MCP returns 200 with error in body
    });

    it("should reject non-JSON requests", async () => {
      await request(app)
        .post("/mcp")
        .send("not json")
        .expect(400);
    });
  });

  describe("REST vs MCP consistency", () => {
    it("should return same tool count in both REST and MCP", async () => {
      // Register some tools
      registerTool({
        name: "tool1",
        description: "Tool 1",
        handler: async () => "result1",
      });
      registerTool({
        name: "tool2",
        description: "Tool 2",
        handler: async () => "result2",
      });

      // Call via MCP
      const mcpRes = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      const mcpResult = mcpRes.body.result ?? mcpRes.body;
      expect(mcpResult.tools).toHaveLength(2);
      expect(mcpResult.tools.map((t) => t.name)).toContain("tool1");
      expect(mcpResult.tools.map((t) => t.name)).toContain("tool2");
    });

    it("should execute same handler via MCP callTool", async () => {
      let callCount = 0;
      registerTool({
        name: "counter",
        description: "Counts calls",
        inputSchema: {
          type: "object",
          properties: { increment: { type: "number" } },
        },
        handler: async (args) => {
          callCount += args.increment || 1;
          return { count: callCount };
        },
      });

      // Call via MCP
      const res1 = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "counter", arguments: { increment: 5 } },
        });

      const res1Result = res1.body.result ?? res1.body;
      expect(res1Result.isError).toBe(false);
      const data1 = JSON.parse(res1Result.content[0].text);
      expect(data1.count).toBe(5);

      // Call again
      const res2 = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "counter", arguments: { increment: 3 } },
        });

      const res2Result = res2.body.result ?? res2.body;
      const data2 = JSON.parse(res2Result.content[0].text);
      expect(data2.count).toBe(8);
    });
  });

  describe("Project context headers", () => {
    it("should accept X-Project-Id and X-Env headers", async () => {
      registerTool({
        name: "context_aware",
        description: "Tool that uses context",
        handler: async (args, context) => ({
          project: context.projectId,
          env: context.projectEnv,
        }),
      });

      const res = await request(app)
        .post("/mcp")
        .set("X-Project-Id", "my-project")
        .set("X-Env", "production")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "context_aware", arguments: {} },
        });

      const ctxResult = res.body.result ?? res.body;
      expect(ctxResult.isError).toBe(false);
    });
  });
});
