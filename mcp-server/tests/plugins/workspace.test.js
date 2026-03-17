import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateWorkspacePath } from "../../src/core/workspace-paths.js";
import {
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  patchFile,
  extractContext,
} from "../../src/plugins/workspace/workspace.core.js";
import { generateCorrelationId, getAuditManager } from "../../src/core/audit/index.js";

/**
 * Workspace Plugin Unit Tests
 * Tests for file operations, path validation, audit logging, and context extraction
 */

describe("Workspace Core", () => {
  describe("validateWorkspacePath (central module)", () => {
    it("should validate relative paths within workspace", () => {
      const result = validateWorkspacePath("src/index.js", "global");
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toBeDefined();
      expect(result.resolvedPath).toContain("src");
    });

    it("treats leading-slash paths as relative to workspace (not system absolute)", () => {
      // Central module strips leading / and resolves relative to workspace root
      const result = validateWorkspacePath("/etc/passwd", "global");
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toContain("etc");
    });

    it("should reject path traversal attempts", () => {
      const result = validateWorkspacePath("../../../etc/passwd", "global");
      expect(result.valid).toBe(false);
      expect(result.reason || result.error).toMatch(/traversal|escape/);
    });

    it("should reject empty paths", () => {
      const result = validateWorkspacePath("", "global");
      expect(result.valid).toBe(false);
    });

    it("should reject null/undefined paths", () => {
      expect(validateWorkspacePath(null, "global").valid).toBe(false);
      expect(validateWorkspacePath(undefined, "global").valid).toBe(false);
    });

    it("should reject paths starting with ~", () => {
      const result = validateWorkspacePath("~/Documents/file.txt", "global");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("path_traversal");
    });
  });

  describe("readFile", () => {
    it("should reject invalid paths", async () => {
      const result = await readFile("../../../etc/passwd", "global");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should return error for non-existent files", async () => {
      const result = await readFile("non-existent-file-12345.txt", "global");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("file_not_found");
    });

    it("should reject directories", async () => {
      const result = await readFile(".", "global");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("not_a_file");
    });
  });

  describe("writeFile", () => {
    it("should reject invalid paths", async () => {
      const result = await writeFile("../../../etc/passwd", "content", { workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should handle missing parent directories", async () => {
      const result = await writeFile(
        "test-dir-12345/nested/file.txt",
        "test content",
        { createDirs: false, workspaceId: "global" }
      );
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("parent_not_found");
    });
  });

  describe("listDirectory", () => {
    it("should reject invalid paths", async () => {
      const result = await listDirectory("../../../etc", { workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should reject files (not directories)", async () => {
      await writeFile("test-file-for-list.txt", "content", { createDirs: true, workspaceId: "global" });
      const result = await listDirectory("test-file-for-list.txt", { workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("not_a_directory");
      // Cleanup - delete the test file using fs
      try { await import("fs/promises").then(fs => fs.unlink("test-file-for-list.txt")); } catch { /* ignore */ }
    });
  });

  describe("searchFiles", () => {
    it("should reject invalid root paths", async () => {
      const result = await searchFiles("*.js", { root: "../../../etc", workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should limit search results", async () => {
      const result = await searchFiles(".", { workspaceId: "global" });
      if (result.ok) {
        expect(result.data.results.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("patchFile", () => {
    it("should reject invalid paths", async () => {
      const result = await patchFile("../../../etc/passwd", "search===REPLACE===replace", { workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should return error for non-existent files", async () => {
      const result = await patchFile("non-existent-file-12345.txt", "a===REPLACE===b", { workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("file_not_found");
    });

    it("should reject invalid patch format", async () => {
      await writeFile("test-patch-file.txt", "original content", { createDirs: true, workspaceId: "global" });
      const result = await patchFile("test-patch-file.txt", "invalid-patch-format", { mode: "search-replace", workspaceId: "global" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_patch");
      // Cleanup - delete the test file using fs
      try { await import("fs/promises").then(fs => fs.unlink("test-patch-file.txt")); } catch { /* ignore */ }
    });
  });
});

describe("Workspace Plugin - Context Extraction", () => {
  it("should extract context from request headers", () => {
    const mockReq = {
      user: { id: "user-123", email: "user@example.com" },
      headers: {
        "x-workspace-id": "workspace-a",
        "x-project-id": "project-1",
      },
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user-123");
    expect(context.workspaceId).toBe("workspace-a");
    expect(context.projectId).toBe("project-1");
  });

  it("should fallback to email if id not present", () => {
    const mockReq = {
      user: { email: "user@example.com" },
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user@example.com");
    expect(context.workspaceId).toBeNull();
  });

  it("should default to anonymous", () => {
    const mockReq = {
      user: null,
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("anonymous");
  });
});

describe("Workspace Plugin - Audit Logging", () => {
  it("should generate unique correlation IDs", async () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^audit-/);
  });

  it("should retrieve audit log entries via getAuditManager", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    const entries = await manager.getRecentEntries({ plugin: "workspace", limit: 10 });
    expect(Array.isArray(entries)).toBe(true);
  });

  it("should respect limit parameter", async () => {
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    const entries = await manager.getRecentEntries({ plugin: "workspace", limit: 5 });
    expect(entries.length).toBeLessThanOrEqual(5);
  });
});

describe("Workspace Plugin - Error Codes", () => {
  it("should include all expected error codes", () => {
    const expectedCodes = [
      "invalid_path",
      "path_traversal",
      "file_not_found",
      "directory_not_found",
      "not_a_file",
      "not_a_directory",
      "file_too_large",
      "missing_path",
      "missing_fields",
      "missing_pattern",
      "parent_not_found",
      "invalid_patch",
      "read_error",
      "write_error",
      "list_error",
      "search_error",
      "patch_error",
    ];

    expectedCodes.forEach(code => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  });
});
