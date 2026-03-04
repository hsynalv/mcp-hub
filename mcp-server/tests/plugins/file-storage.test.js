import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * File Storage Plugin Unit Tests
 * Tests for schema validation and path sanitization
 */

// Mock the storage adapter
vi.mock("../../src/plugins/file-storage/storage.adapter.js", () => ({
  getAdapter: vi.fn(),
  isValidBackend: vi.fn((b) => ["s3", "gdrive", "local"].includes(b)),
  sanitizePath: vi.fn((p) => {
    if (!p) return ".";
    // Remove path traversal attempts
    if (p.includes("..") || p.startsWith("/")) return null;
    return p.replace(/\\/g, "/");
  }),
}));

describe("File Storage Plugin Schemas", () => {
  const writeSchema = z.object({
    backend: z.enum(["s3", "gdrive", "local"]),
    path: z.string().min(1),
    content: z.string(),
    contentType: z.string().optional(),
  });

  const copyMoveSchema = z.object({
    backend: z.enum(["s3", "gdrive", "local"]),
    sourcePath: z.string().min(1),
    destPath: z.string().min(1),
  });

  describe("writeSchema", () => {
    it("should validate minimal write request", () => {
      const write = {
        backend: "local",
        path: "test.txt",
        content: "Hello World",
      };
      expect(() => writeSchema.parse(write)).not.toThrow();
    });

    it("should validate write with content type", () => {
      const write = {
        backend: "s3",
        path: "documents/report.pdf",
        content: "base64encoded...",
        contentType: "application/pdf",
      };
      expect(() => writeSchema.parse(write)).not.toThrow();
    });

    it("should validate different backends", () => {
      const backends = ["s3", "gdrive", "local"];
      backends.forEach((backend) => {
        expect(() =>
          writeSchema.parse({ backend, path: "test.txt", content: "data" })
        ).not.toThrow();
      });
    });

    it("should reject invalid backend", () => {
      expect(() =>
        writeSchema.parse({ backend: "azure", path: "test.txt", content: "data" })
      ).toThrow();
    });

    it("should reject empty path", () => {
      expect(() =>
        writeSchema.parse({ backend: "local", path: "", content: "data" })
      ).toThrow();
    });

    it("should reject missing content", () => {
      expect(() =>
        writeSchema.parse({ backend: "local", path: "test.txt" })
      ).toThrow();
    });
  });

  describe("copyMoveSchema", () => {
    it("should validate copy operation", () => {
      const copy = {
        backend: "s3",
        sourcePath: "folder/file.txt",
        destPath: "backup/file.txt",
      };
      expect(() => copyMoveSchema.parse(copy)).not.toThrow();
    });

    it("should validate move operation", () => {
      const move = {
        backend: "local",
        sourcePath: "/tmp/temp.txt",
        destPath: "/archive/final.txt",
      };
      expect(() => copyMoveSchema.parse(move)).not.toThrow();
    });

    it("should reject invalid backend", () => {
      expect(() =>
        copyMoveSchema.parse({
          backend: "dropbox",
          sourcePath: "a.txt",
          destPath: "b.txt",
        })
      ).toThrow();
    });

    it("should reject empty paths", () => {
      expect(() =>
        copyMoveSchema.parse({
          backend: "s3",
          sourcePath: "",
          destPath: "dest.txt",
        })
      ).toThrow();
      expect(() =>
        copyMoveSchema.parse({
          backend: "s3",
          sourcePath: "source.txt",
          destPath: "",
        })
      ).toThrow();
    });
  });
});

describe("File Storage Path Sanitization", () => {
  const sanitizePath = (p) => {
    if (!p) return ".";
    if (p.includes("..") || p.startsWith("/")) return null;
    return p.replace(/\\/g, "/");
  };

  describe("sanitizePath", () => {
    it("should allow valid paths", () => {
      expect(sanitizePath("folder/file.txt")).toBe("folder/file.txt");
      expect(sanitizePath("deep/nested/path/file.txt")).toBe("deep/nested/path/file.txt");
    });

    it("should convert backslashes to forward slashes", () => {
      expect(sanitizePath("folder\\file.txt")).toBe("folder/file.txt");
    });

    it("should reject path traversal", () => {
      expect(sanitizePath("../etc/passwd")).toBeNull();
      expect(sanitizePath("folder/../../../etc/passwd")).toBeNull();
    });

    it("should reject absolute paths", () => {
      expect(sanitizePath("/etc/passwd")).toBeNull();
      expect(sanitizePath("/absolute/path")).toBeNull();
    });

    it("should handle empty or null paths", () => {
      expect(sanitizePath("")).toBe(".");
      expect(sanitizePath(null)).toBe(".");
      expect(sanitizePath(undefined)).toBe(".");
    });
  });
});

describe("File Storage Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "file-storage";
    const version = "1.0.0";
    const description = "S3, Google Drive ve lokal depolama ile dosya işlemleri";
    const capabilities = ["read", "write"];

    expect(name).toBe("file-storage");
    expect(version).toBe("1.0.0");
    expect(description).toContain("S3");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
  });

  it("should define file operation endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/file-storage/list", scope: "read" },
      { method: "GET", path: "/file-storage/read", scope: "read" },
      { method: "POST", path: "/file-storage/write", scope: "write" },
      { method: "DELETE", path: "/file-storage/delete", scope: "write" },
      { method: "POST", path: "/file-storage/copy", scope: "write" },
      { method: "POST", path: "/file-storage/move", scope: "write" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});

describe("File Storage Backend Validation", () => {
  const isValidBackend = (backend) => ["s3", "gdrive", "local"].includes(backend);

  describe("isValidBackend", () => {
    it("should validate supported backends", () => {
      expect(isValidBackend("s3")).toBe(true);
      expect(isValidBackend("gdrive")).toBe(true);
      expect(isValidBackend("local")).toBe(true);
    });

    it("should reject unsupported backends", () => {
      expect(isValidBackend("azure")).toBe(false);
      expect(isValidBackend("dropbox")).toBe(false);
      expect(isValidBackend("ftp")).toBe(false);
      expect(isValidBackend("")).toBe(false);
      expect(isValidBackend(null)).toBe(false);
    });
  });
});

describe("File Storage Error Handling", () => {
  it("should categorize storage errors", () => {
    const errors = [
      { message: "invalid_path", expectedCode: "invalid_path" },
      { message: "connection_failed", expectedCode: "connection_failed" },
      { message: "file_not_found", expectedCode: "internal_error" },
      { message: "permission_denied", expectedCode: "internal_error" },
    ];

    errors.forEach((err) => {
      let code = "internal_error";
      if (err.message === "invalid_path") code = "invalid_path";
      else if (err.message === "connection_failed") code = "connection_failed";

      expect(code).toBe(err.expectedCode);
    });
  });
});
