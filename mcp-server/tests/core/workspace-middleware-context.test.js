/**
 * Workspace Context Middleware Tests
 *
 * Tests workspaceContextMiddleware resolution:
 * - x-workspace-id only
 * - x-project-id only
 * - both present (precedence)
 * - neither present
 */

import { describe, it, expect, beforeEach } from "vitest";
import { workspaceContextMiddleware, resolveWorkspaceContext } from "../../src/core/workspace.js";

function createMockReq(overrides = {}) {
  return {
    headers: {},
    projectId: null,
    ...overrides,
  };
}

function createMockRes() {
  const res = {};
  res.json = () => res;
  res.status = () => res;
  return res;
}

function runMiddleware(req, done = () => {}) {
  return new Promise((resolve, reject) => {
    const res = createMockRes();
    const next = (err) => {
      if (err) reject(err);
      else resolve();
    };
    workspaceContextMiddleware(req, res, next);
  });
}

describe("workspaceContextMiddleware", () => {
  describe("x-workspace-id only", () => {
    it("sets req.workspaceId from header", async () => {
      const req = createMockReq({
        headers: { "x-workspace-id": "ws-123" },
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-123");
    });

    it("trims whitespace from header", async () => {
      const req = createMockReq({
        headers: { "x-workspace-id": "  ws-trimmed  " },
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-trimmed");
    });
  });

  describe("x-project-id only", () => {
    it("resolves workspaceId from project via resolveWorkspaceContext", async () => {
      const req = createMockReq({
        headers: { "x-project-id": "my-project" },
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-my-project");
      expect(req.workspaceContext).toBeDefined();
      expect(req.workspaceContext.workspaceId).toBe("ws-my-project");
      expect(req.workspaceContext.projectId).toBeDefined();
    });

    it("sets req.projectId from resolved context", async () => {
      const req = createMockReq({
        headers: { "x-project-id": "proj-alpha" },
      });
      await runMiddleware(req);
      expect(req.projectId).toBeDefined();
      expect(req.workspaceContext.projectId).toBe(req.projectId);
    });
  });

  describe("both x-workspace-id and x-project-id present", () => {
    it("x-workspace-id takes precedence", async () => {
      const req = createMockReq({
        headers: {
          "x-workspace-id": "ws-explicit",
          "x-project-id": "some-project",
        },
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-explicit");
      expect(req.projectId).toBe("some-project");
    });
  });

  describe("neither header present", () => {
    it("sets req.workspaceId to global", async () => {
      const req = createMockReq();
      await runMiddleware(req);
      expect(req.workspaceId).toBe("global");
    });

    it("does not set req.workspaceContext", async () => {
      const req = createMockReq();
      await runMiddleware(req);
      expect(req.workspaceContext).toBeUndefined();
    });
  });

  describe("precedence rules", () => {
    it("empty x-workspace-id falls through to x-project-id", async () => {
      const req = createMockReq({
        headers: {
          "x-workspace-id": "   ",
          "x-project-id": "fallback-proj",
        },
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-fallback-proj");
    });

    it("req.projectId from projectContextMiddleware is used when no x-project-id header", async () => {
      const req = createMockReq({
        headers: {},
        projectId: "pre-set-project",
      });
      await runMiddleware(req);
      expect(req.workspaceId).toBe("ws-pre-set-project");
    });
  });
});
