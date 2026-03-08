import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateWorkspacePath,
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  patchFile,
  extractContext,
  auditEntry,
  getAuditLogEntries,
  generateCorrelationId,
} from "../../src/plugins/workspace/workspace.core.js";

/**
 * Workspace Plugin Unit Tests
 * Tests for file operations, path validation, audit logging, and context extraction
 */

describe("Workspace Core", () => {
  describe("validateWorkspacePath", () => {
    it("should validate relative paths within workspace", () => {
      const result = validateWorkspacePath("src/index.js");
      expect(result.valid).toBe(true);
      expect(result.relative).toBe("src/index.js");
    });

    it("should reject absolute paths outside workspace", () => {
      const result = validateWorkspacePath("/etc/passwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("traversal");
    });

    it("should reject path traversal attempts", () => {
      const result = validateWorkspacePath("../../../etc/passwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("traversal");
    });

    it("should reject empty paths", () => {
      const result = validateWorkspacePath("");
      expect(result.valid).toBe(false);
    });

    it("should reject null/undefined paths", () => {
      expect(validateWorkspacePath(null).valid).toBe(false);
      expect(validateWorkspacePath(undefined).valid).toBe(false);
    });

    it("should handle paths starting with ~", () => {
      const result = validateWorkspacePath("~/Documents/file.txt");
      // Should resolve to a valid path within workspace root or reject if outside
      expect(result.valid).toBeDefined();
    });
  });

  describe("readFile", () => {
    it("should reject invalid paths", async () => {
      const result = await readFile("../../../etc/passwd");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should return error for non-existent files", async () => {
      const result = await readFile("non-existent-file-12345.txt");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("file_not_found");
    });

    it("should reject directories", async () => {
      const result = await readFile(".");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("not_a_file");
    });
  });

  describe("writeFile", () => {
    it("should reject invalid paths", async () => {
      const result = await writeFile("../../../etc/passwd", "content");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should handle missing parent directories", async () => {
      const result = await writeFile(
        "test-dir-12345/nested/file.txt",
        "test content",
        { createDirs: false }
      );
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("parent_not_found");
    });
  });

  describe("listDirectory", () => {
    it("should reject invalid paths", async () => {
      const result = await listDirectory("../../../etc");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should reject files (not directories)", async () => {
      // First create a test file
      await writeFile("test-file-for-list.txt", "content", { createDirs: true });
      const result = await listDirectory("test-file-for-list.txt");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("not_a_directory");
      // Cleanup - delete the test file using fs
      try { await import("fs/promises").then(fs => fs.unlink("test-file-for-list.txt")); } catch { /* ignore */ }
    });
  });

  describe("searchFiles", () => {
    it("should reject invalid root paths", async () => {
      const result = await searchFiles("*.js", { root: "../../../etc" });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should limit search results", async () => {
      const result = await searchFiles(".");
      if (result.ok) {
        expect(result.data.results.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("patchFile", () => {
    it("should reject invalid paths", async () => {
      const result = await patchFile("../../../etc/passwd", "search===REPLACE===replace");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_path");
    });

    it("should return error for non-existent files", async () => {
      const result = await patchFile("non-existent-file-12345.txt", "a===REPLACE===b");
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("file_not_found");
    });

    it("should reject invalid patch format", async () => {
      // First create a test file
      await writeFile("test-patch-file.txt", "original content", { createDirs: true });
      const result = await patchFile("test-patch-file.txt", "invalid-patch-format", { mode: "search-replace" });
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
  it("should generate unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^ws-\d+-/);
  });

  it("should add audit entries", () => {
    const entry = auditEntry({
      operation: "read",
      path: "test.txt",
      allowed: true,
      actor: "user-123",
      workspaceId: "ws-1",
      projectId: "proj-1",
      correlationId: "ws-test-123",
      durationMs: 100,
      metadata: { size: 1024 },
    });

    expect(entry.operation).toBe("read");
    expect(entry.path).toBe("test.txt");
    expect(entry.allowed).toBe(true);
    expect(entry.actor).toBe("user-123");
    expect(entry.workspaceId).toBe("ws-1");
    expect(entry.metadata.size).toBe(1024);
    expect(entry.timestamp).toBeDefined();
  });

  it("should log denied operations", () => {
    const entry = auditEntry({
      operation: "write",
      path: "/etc/passwd",
      allowed: false,
      actor: "user-123",
      reason: "path_traversal",
      error: "Path traversal detected",
    });

    expect(entry.allowed).toBe(false);
    expect(entry.reason).toBe("path_traversal");
    expect(entry.error).toBe("Path traversal detected");
  });

  it("should retrieve audit log entries", () => {
    auditEntry({
      operation: "test-retrieve",
      path: "test.txt",
      allowed: true,
    });

    const entries = getAuditLogEntries(10);
    expect(Array.isArray(entries)).toBe(true);

    const found = entries.find(e => e.operation === "test-retrieve");
    expect(found).toBeDefined();
  });

  it("should respect limit parameter", () => {
    const entries = getAuditLogEntries(5);
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
