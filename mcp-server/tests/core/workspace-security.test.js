/**
 * Workspace Security Tests
 *
 * Tests for:
 * - Workspace breakout attempts (path traversal)
 * - Invalid paths
 * - Permission denial
 * - Cross-workspace access
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeWorkspaceId,
  getWorkspaceRoot,
  validateWorkspacePath,
  resolvePathInWorkspace,
  canAccessWorkspace,
  resolveAndValidatePath,
} from "../../src/core/workspace-paths.js";
import {
  canReadWorkspace,
  canWriteWorkspace,
  canRunTool,
  canModifyIndex,
  checkCrossWorkspaceAccess,
} from "../../src/core/workspace-permissions.js";
import { getOrCreateWorkspace, getWorkspace } from "../../src/core/workspace.js";

describe("workspace-paths - Workspace Breakout", () => {
  it("should reject path traversal with ..", () => {
    const r = validateWorkspacePath("../../../etc/passwd", "ws-1");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/path_traversal|path_escape/);
  });

  it("should reject path traversal with ~", () => {
    const r = validateWorkspacePath("~/secret/file", "ws-1");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("path_traversal");
  });

  it("should reject path that escapes workspace boundary", () => {
    const r = validateWorkspacePath("../../../outside", "ws-1");
    expect(r.valid).toBe(false);
  });

  it("should allow valid relative paths within workspace", () => {
    const r = validateWorkspacePath("src/index.js", "ws-1");
    expect(r.valid).toBe(true);
    expect(r.resolvedPath).toBeDefined();
  });

  it("should allow empty path", () => {
    const r = validateWorkspacePath("", "ws-1");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("path_required");
  });
});

describe("workspace-paths - Invalid Paths", () => {
  it("should reject null path", () => {
    const r = validateWorkspacePath(null, "ws-1");
    expect(r.valid).toBe(false);
  });

  it("should reject non-string path", () => {
    const r = validateWorkspacePath(123, "ws-1");
    expect(r.valid).toBe(false);
  });

  it("resolvePathInWorkspace returns null for invalid path", () => {
    const r = resolvePathInWorkspace("../../../etc/passwd", "ws-1");
    expect(r).toBeNull();
  });
});

describe("workspace-paths - sanitizeWorkspaceId", () => {
  it("should accept valid workspace IDs", () => {
    expect(sanitizeWorkspaceId("ws-1").valid).toBe(true);
    expect(sanitizeWorkspaceId("ws_123").valid).toBe(true);
    expect(sanitizeWorkspaceId("myWorkspace").valid).toBe(true);
  });

  it("should reject workspace IDs with invalid chars", () => {
    const r = sanitizeWorkspaceId("ws/1");
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("should reject empty workspace ID", () => {
    const r = sanitizeWorkspaceId("");
    expect(r.valid).toBe(false);
  });

  it("should reject null workspace ID", () => {
    const r = sanitizeWorkspaceId(null);
    expect(r.valid).toBe(false);
  });
});

describe("workspace-paths - getWorkspaceRoot", () => {
  it("should return path for valid workspace", () => {
    const root = getWorkspaceRoot("ws-1");
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
    expect(root).toContain("ws-1");
  });

  it("should use per-workspace root when set", () => {
    const ws = getOrCreateWorkspace("ws-custom", "Custom", "owner", {
      workspace_root: "/custom/path",
    });
    const root = getWorkspaceRoot("ws-custom");
    expect(root).toContain("custom");
  });
});

describe("workspace-paths - canAccessWorkspace", () => {
  it("should allow same-workspace access", () => {
    const r = canAccessWorkspace("ws-1", "ws-1");
    expect(r.allowed).toBe(true);
  });

  it("should allow when caller has no workspace (global)", () => {
    const r = canAccessWorkspace(null, "ws-2");
    expect(r.allowed).toBe(true);
  });

  it("may reject cross-workspace when WORKSPACE_STRICT_BOUNDARIES=true", () => {
    const orig = process.env.WORKSPACE_STRICT_BOUNDARIES;
    process.env.WORKSPACE_STRICT_BOUNDARIES = "true";
    const r = canAccessWorkspace("ws-1", "ws-2");
    process.env.WORKSPACE_STRICT_BOUNDARIES = orig;
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cross_workspace_access_denied");
  });
});

describe("workspace-permissions - Permission Denial", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("canReadWorkspace allows when no workspace", async () => {
    const r = await canReadWorkspace({ workspaceId: "global" });
    expect(r.allowed).toBe(true);
  });

  it("canReadWorkspace allows valid workspace", async () => {
    getOrCreateWorkspace("ws-perm", "Test", "owner");
    const r = await canReadWorkspace({ workspaceId: "ws-perm", plugin: "rag" });
    expect(r.allowed).toBe(true);
  });

  it("canReadWorkspace denies when plugin not in allowed list", async () => {
    getOrCreateWorkspace("ws-restricted", "Restricted", "owner", {
      allowedPlugins: ["rag"],
    });
    const r = await canReadWorkspace({ workspaceId: "ws-restricted", plugin: "shell" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("plugin_not_allowed_in_workspace");
  });

  it("canWriteWorkspace denies when workspace is read-only", async () => {
    getOrCreateWorkspace("ws-ro", "ReadOnly", "owner", { readOnly: true });
    const r = await canWriteWorkspace({ workspaceId: "ws-ro", plugin: "rag" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("workspace_read_only");
  });

  it("canModifyIndex denies when canWriteWorkspace denies", async () => {
    getOrCreateWorkspace("ws-ro2", "ReadOnly2", "owner", { readOnly: true });
    const r = await canModifyIndex({ workspaceId: "ws-ro2", plugin: "rag-ingestion" });
    expect(r.allowed).toBe(false);
  });

  it("canRunTool denies when operation not in allowed_operations", async () => {
    getOrCreateWorkspace("ws-ops", "Ops", "owner", {
      allowed_operations: ["read"],
    });
    const r = await canRunTool("git_status", { workspaceId: "ws-ops", plugin: "git" }, "git");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("operation_not_allowed");
  });
});

describe("workspace-permissions - Denial Returns Reason", () => {
  it("denied operations return structured reason", async () => {
    getOrCreateWorkspace("ws-audit", "Audit", "owner", { readOnly: true });
    const r = await canWriteWorkspace({ workspaceId: "ws-audit", plugin: "rag", actor: "test" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("workspace_read_only");
  });
});
