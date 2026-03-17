/**
 * MCP Security Tests
 *
 * Tests that verify authentication and authorization on MCP endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createMcpHttpMiddleware } from "../../src/mcp/http-transport.js";
import { registerTool, clearTools } from "../../src/core/tool-registry.js";

// Mock policy engine to allow all requests
vi.mock("../src/plugins/policy/policy.engine.js", () => ({
  evaluate: vi.fn(() => ({ allowed: true })),
}));

describe("MCP Security Tests", () => {
  let app;
  let originalEnv;

  beforeAll(() => {
    originalEnv = process.env;
  });

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.HUB_AUTH_ENABLED;
    delete process.env.HUB_READ_KEY;
    delete process.env.HUB_WRITE_KEY;
    delete process.env.HUB_ADMIN_KEY;
    delete process.env.OAUTH_INTROSPECTION_ENDPOINT;

    app = express();
    app.use(express.json());
    app.all("/mcp", createMcpHttpMiddleware());

    clearTools();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Authentication disabled", () => {
    it("should allow requests without auth when disabled", async () => {
      registerTool({
        name: "public_tool",
        description: "A public tool",
        handler: async () => "success",
      });

      const res = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "public_tool", arguments: {} },
        });

      expect(res.status).toBe(200);
      expect(res.body.isError).toBe(false);
    });
  });

  describe("API Key authentication", () => {
    beforeEach(() => {
      process.env.HUB_AUTH_ENABLED = "true";
      process.env.HUB_READ_KEY = "read-secret-key";
      process.env.HUB_WRITE_KEY = "write-secret-key";
      process.env.HUB_ADMIN_KEY = "admin-secret-key";
    });

    it("should reject requests without auth header", async () => {
      const res = await request(app)
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("unauthorized");
    });

    it("should reject invalid API keys", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer invalid-key")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("invalid_token");
    });

    it("should accept valid read key", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer read-secret-key")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(200);
      expect(res.body.tools).toBeDefined();
    });

    it("should accept valid write key", async () => {
      registerTool({
        name: "write_tool",
        description: "A write tool",
        handler: async () => "written",
      });

      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer write-secret-key")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "write_tool", arguments: {} },
        });

      expect(res.status).toBe(200);
    });

    it("should accept x-hub-api-key header as fallback", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("X-Hub-Api-Key", "read-secret-key")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(200);
    });
  });

  describe("Origin validation", () => {
    it("should reject requests from invalid origins", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Origin", "https://evil.com")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("invalid_origin");
    });

    it("should allow localhost origins", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Origin", "http://localhost:3000")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(200);
    });

    it("should allow configured origins via env var", async () => {
      process.env.MCP_ALLOWED_ORIGINS = "https://trusted.com,https://app.example.com";

      const res = await request(app)
        .post("/mcp")
        .set("Origin", "https://trusted.com")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        });

      expect(res.status).toBe(200);
    });
  });

  describe("Method validation", () => {
    it("should reject unsupported HTTP methods", async () => {
      const res = await request(app)
        .put("/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe("method_not_allowed");
    });

    it("should reject DELETE requests", async () => {
      const res = await request(app).delete("/mcp");
      expect(res.status).toBe(405);
    });
  });
});
