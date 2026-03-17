/**
 * Workspace Paths Integration Tests
 *
 * Tests the unified workspace path validation flow:
 *   requestedPath → validateWorkspacePath → resolveWorkspacePath → file operation
 *
 * Cases: valid path, path traversal, cross-workspace access, invalid workspaceId
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  validateWorkspacePath,
  getWorkspaceRoot,
  resolveWorkspacePath,
  requireWorkspaceId,
  validatePathWithinBase,
  sanitizeWorkspaceId,
  canAccessWorkspace,
} from "../../src/core/workspace-paths.js";

describe("workspace-paths-integration - Valid Workspace Path", () => {
  it("validates and resolves a valid relative path", () => {
    const result = validateWorkspacePath("src/index.js", "global");
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBeDefined();
    expect(result.resolvedPath).toContain("src");
    expect(result.resolvedPath).toContain("index.js");
  });

  it("resolveWorkspacePath returns absolute path for valid input", () => {
    const path = resolveWorkspacePath("package.json", "global");
    expect(path).toBeDefined();
    expect(typeof path).toBe("string");
    expect(path).toContain("package.json");
  });

  it("validatePathWithinBase accepts path within base", () => {
    const base = getWorkspaceRoot("global");
    const result = validatePathWithinBase("subdir/file.txt", base);
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBeDefined();
    expect(result.resolvedPath).toContain("subdir");
  });
});

describe("workspace-paths-integration - Path Traversal Attack", () => {
  it("rejects .. in path", () => {
    const result = validateWorkspacePath("../../../etc/passwd", "global");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path_traversal|path_escape/);
  });

  it("resolveWorkspacePath throws on path traversal", () => {
    expect(() => resolveWorkspacePath("../../secret", "global")).toThrow();
  });

  it("validatePathWithinBase rejects traversal within base", () => {
    const base = getWorkspaceRoot("global");
    const result = validatePathWithinBase("../../../etc/passwd", base);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path_traversal|path_escape/);
  });

  it("rejects ~ in path", () => {
    const result = validateWorkspacePath("~/secret/file", "global");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("path_traversal");
  });
});

describe("workspace-paths-integration - Cross-Workspace Access", () => {
  it("canAccessWorkspace blocks cross-workspace when strict", () => {
    const orig = process.env.WORKSPACE_STRICT_BOUNDARIES;
    process.env.WORKSPACE_STRICT_BOUNDARIES = "true";
    const r = canAccessWorkspace("ws-a", "ws-b");
    process.env.WORKSPACE_STRICT_BOUNDARIES = orig;
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cross_workspace_access_denied");
  });

  it("allows same-workspace access", () => {
    const r = canAccessWorkspace("ws-1", "ws-1");
    expect(r.allowed).toBe(true);
  });

  it("different workspaceIds resolve to different roots", () => {
    const rootGlobal = getWorkspaceRoot("global");
    const rootWs1 = getWorkspaceRoot("ws-1");
    expect(rootGlobal).not.toBe(rootWs1);
    expect(rootWs1).toContain("ws-1");
  });
});

describe("workspace-paths-integration - Invalid WorkspaceId", () => {
  it("sanitizeWorkspaceId rejects invalid chars", () => {
    const r = sanitizeWorkspaceId("ws/../../../etc");
    expect(r.valid).toBe(false);
  });

  it("sanitizeWorkspaceId rejects empty", () => {
    const r = sanitizeWorkspaceId("");
    expect(r.valid).toBe(false);
  });

  it("requireWorkspaceId throws when WORKSPACE_REQUIRE_ID=true and workspaceId missing", () => {
    const orig = process.env.WORKSPACE_REQUIRE_ID;
    process.env.WORKSPACE_REQUIRE_ID = "true";
    expect(() => requireWorkspaceId(null, "test_op")).toThrow();
    expect(() => requireWorkspaceId("", "test_op")).toThrow();
    process.env.WORKSPACE_REQUIRE_ID = orig;
  });

  it("requireWorkspaceId does not throw when WORKSPACE_REQUIRE_ID not set", () => {
    const orig = process.env.WORKSPACE_REQUIRE_ID;
    delete process.env.WORKSPACE_REQUIRE_ID;
    expect(() => requireWorkspaceId(null, "test_op")).not.toThrow();
    process.env.WORKSPACE_REQUIRE_ID = orig;
  });
});

describe("workspace-paths-integration - Flow Consistency", () => {
  it("validateWorkspacePath and resolveWorkspacePath agree on valid paths", () => {
    const v = validateWorkspacePath("README.md", "global");
    expect(v.valid).toBe(true);
    const p = resolveWorkspacePath("README.md", "global");
    expect(p).toBe(v.resolvedPath);
  });

  it("validatePathWithinBase works for project-orchestrator style base", () => {
    const base = getWorkspaceRoot("global");
    const projectBase = join(base, "my-project");
    const result = validatePathWithinBase("src/index.js", projectBase);
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toContain("my-project");
    expect(result.resolvedPath).toContain("src");
  });
});
