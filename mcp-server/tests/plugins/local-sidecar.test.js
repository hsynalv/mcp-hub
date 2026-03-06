/**
 * Local Sidecar Plugin Tests
 *
 * Tests for filesystem operations with whitelist protection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fsList, fsRead, fsWrite, fsHash, checkPathAllowed } from "../../src/plugins/local-sidecar/sidecar.core.js";
import { loadWhitelistConfig, clearWhitelistCache } from "../../src/plugins/local-sidecar/whitelist.config.js";
import * as localSidecar from "../../src/plugins/local-sidecar/index.js";

// Mock fs/promises
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
  };
});

// Mock whitelist config
vi.mock("../../src/plugins/local-sidecar/whitelist.config.js", () => ({
  loadWhitelistConfig: vi.fn(() => ["/allowed/path", process.cwd()]),
  clearWhitelistCache: vi.fn(),
  isPathWhitelisted: vi.fn((path) => path.includes("/allowed") || path.includes(process.cwd())),
}));

import { readdir, readFile, writeFile, stat, mkdir } from "fs/promises";

describe("Local Sidecar Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWhitelistCache();
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(localSidecar.name).toBe("local-sidecar");
      expect(localSidecar.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(localSidecar.name).toBeDefined();
      expect(localSidecar.version).toBeDefined();
      expect(localSidecar.description).toBeDefined();
      expect(localSidecar.endpoints).toBeDefined();
      expect(localSidecar.tools).toBeDefined();
      expect(localSidecar.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = localSidecar.endpoints.map(e => e.path);
      expect(paths).toContain("/local/fs/list");
      expect(paths).toContain("/local/fs/read");
      expect(paths).toContain("/local/fs/write");
      expect(paths).toContain("/local/fs/hash");
      expect(paths).toContain("/local/drive/upload");
    });
  });

  describe("MCP Tools", () => {
    it("should have fs_list tool", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_list");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("local_fs");
    });

    it("should have fs_read tool", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_read");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("local_fs");
    });

    it("should have fs_write tool", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_write");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("destructive");
    });

    it("should have fs_hash tool", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_hash");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("read_only");
    });

    it("should have drive_upload tool with needs_approval tag", () => {
      const tool = localSidecar.tools.find(t => t.name === "drive_upload");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("needs_approval");
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("network");
    });
  });

  describe("Whitelist Protection", () => {
    it("should allow access to whitelisted paths", () => {
      const result = checkPathAllowed("/allowed/path/test.txt");
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBeDefined();
    });

    it("should deny access to non-whitelisted paths", () => {
      loadWhitelistConfig.mockReturnValueOnce(["/safe"]);
      const result = checkPathAllowed("/etc/passwd");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Access denied");
    });

    it("should deny access to parent directory traversal", () => {
      loadWhitelistConfig.mockReturnValueOnce(["/safe");
      const result = checkPathAllowed("/safe/../../../etc/passwd");
      expect(result.allowed).toBe(false);
    });
  });

  describe("fs_list", () => {
    it("should list directory contents", async () => {
      const mockEntries = [
        { name: "file1.txt", isDirectory: () => false, isFile: () => true },
        { name: "folder1", isDirectory: () => true, isFile: () => false },
      ];
      readdir.mockResolvedValue(mockEntries);
      stat.mockResolvedValue({
        size: 100,
        mtime: new Date("2024-01-01"),
      });

      const result = await fsList("/allowed/path");

      expect(result.ok).toBe(true);
      expect(result.data.items).toHaveLength(2);
      expect(result.data.count).toBe(2);
    });

    it("should deny access to non-whitelisted directories", async () => {
      loadWhitelistConfig.mockReturnValueOnce(["/safe"]);
      
      const result = await fsList("/etc");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("access_denied");
    });

    it("should handle filesystem errors", async () => {
      readdir.mockRejectedValue(new Error("Permission denied"));

      const result = await fsList("/allowed/path");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("fs_error");
    });
  });

  describe("fs_read", () => {
    it("should read file contents", async () => {
      stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date("2024-01-01"),
      });
      readFile.mockResolvedValue("file content");

      const result = await fsRead("/allowed/path/file.txt");

      expect(result.ok).toBe(true);
      expect(result.data.content).toBe("file content");
      expect(result.data.size).toBe(100);
    });

    it("should reject files exceeding max size", async () => {
      stat.mockResolvedValue({
        isFile: () => true,
        size: 10 * 1024 * 1024, // 10MB
      });

      const result = await fsRead("/allowed/path/large.txt");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("file_too_large");
    });

    it("should reject directories", async () => {
      stat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true,
      });

      const result = await fsRead("/allowed/path");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("not_a_file");
    });
  });

  describe("fs_write", () => {
    it("should write file contents", async () => {
      stat.mockResolvedValue({
        size: 13,
      });

      const result = await fsWrite("/allowed/path/file.txt", "hello content");

      expect(result.ok).toBe(true);
      expect(result.data.written).toBe(13);
      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        "hello content",
        "utf8"
      );
    });

    it("should deny write to non-whitelisted paths", async () => {
      loadWhitelistConfig.mockReturnValueOnce(["/safe"]);

      const result = await fsWrite("/etc/passwd", "malicious");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("access_denied");
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  describe("fs_hash", () => {
    it("should calculate SHA-256 hash", async () => {
      stat.mockResolvedValue({ size: 100 });
      readFile.mockResolvedValue(Buffer.from("test content"));

      const result = await fsHash("/allowed/path/file.txt");

      expect(result.ok).toBe(true);
      expect(result.data.hash).toBeDefined();
      expect(result.data.hash).toHaveLength(64); // SHA-256 hex length
      expect(result.data.algorithm).toBe("sha256");
    });

    it("should deny hash calculation for non-whitelisted files", async () => {
      loadWhitelistConfig.mockReturnValueOnce(["/safe"]);

      const result = await fsHash("/etc/shadow");

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("access_denied");
    });
  });

  describe("Tool Input Schemas", () => {
    it("fs_list should require path and explanation", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_list");
      const required = tool.inputSchema.required;
      expect(required).toContain("path");
      expect(required).toContain("explanation");
    });

    it("fs_read should require path and explanation", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_read");
      const required = tool.inputSchema.required;
      expect(required).toContain("path");
      expect(required).toContain("explanation");
    });

    it("fs_write should require path, content, and explanation", () => {
      const tool = localSidecar.tools.find(t => t.name === "fs_write");
      const required = tool.inputSchema.required;
      expect(required).toContain("path");
      expect(required).toContain("content");
      expect(required).toContain("explanation");
    });

    it("drive_upload should require path and explanation", () => {
      const tool = localSidecar.tools.find(t => t.name === "drive_upload");
      const required = tool.inputSchema.required;
      expect(required).toContain("path");
      expect(required).toContain("explanation");
    });
  });
});
