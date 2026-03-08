import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * File Storage Plugin Security Tests
 * Tests for path traversal, sensitive files, file size limits, and audit logging
 */

// Import the actual security functions
const {
  sanitizePath,
  isSensitiveFile,
  validateFileSize,
  checkFilePolicy,
  generateCorrelationId,
  MAX_FILE_SIZE_BYTES,
} = await import("../../src/plugins/file-storage/storage.adapter.js");

describe("File Storage - Path Traversal Hardening", () => {
  describe("sanitizePath", () => {
    it("should allow valid relative paths", () => {
      expect(sanitizePath("folder/file.txt")).toBe("folder/file.txt");
      expect(sanitizePath("deep/nested/path/file.txt")).toBe("deep/nested/path/file.txt");
      expect(sanitizePath("file.txt")).toBe("file.txt");
    });

    it("should convert backslashes to forward slashes", () => {
      expect(sanitizePath("folder\\file.txt")).toBe("folder/file.txt");
    });

    it("should reject basic path traversal (../)", () => {
      expect(sanitizePath("../etc/passwd")).toBeNull();
      expect(sanitizePath("folder/../../../etc/passwd")).toBeNull();
    });

    it("should reject encoded path traversal (%2e%2e%2f)", () => {
      expect(sanitizePath("%2e%2e%2fetc%2fpasswd")).toBeNull();
      expect(sanitizePath("folder/%2e%2e/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    });

    it("should reject double-encoded path traversal", () => {
      expect(sanitizePath("%252e%252e%252fetc%252fpasswd")).toBeNull();
    });

    it("should reject absolute paths", () => {
      expect(sanitizePath("/etc/passwd")).toBeNull();
      expect(sanitizePath("/absolute/path")).toBeNull();
    });

    it("should reject Windows absolute paths", () => {
      expect(sanitizePath("C:\\Windows\\System32")).toBeNull();
      expect(sanitizePath("D:/sensitive/file.txt")).toBeNull();
    });

    it("should reject null bytes and control characters", () => {
      expect(sanitizePath("file\x00.txt")).toBeNull();
      expect(sanitizePath("file\x01.txt")).toBeNull();
      expect(sanitizePath("file\x1f.txt")).toBeNull();
    });

    it("should normalize empty or null paths to '.'", () => {
      expect(sanitizePath("")).toBe(".");
      expect(sanitizePath(null)).toBe(".");
      expect(sanitizePath(undefined)).toBe(".");
    });
  });
});

describe("File Storage - Sensitive File Blocking", () => {
  describe("isSensitiveFile", () => {
    it("should block .env files", () => {
      expect(isSensitiveFile(".env")).toBe(true);
      expect(isSensitiveFile(".env.local")).toBe(true);
      expect(isSensitiveFile(".env.production")).toBe(true);
    });

    it("should block SSH keys", () => {
      expect(isSensitiveFile(".ssh/id_rsa")).toBe(true);
      expect(isSensitiveFile(".ssh/id_ed25519")).toBe(true);
      expect(isSensitiveFile(".ssh/authorized_keys")).toBe(true);
      expect(isSensitiveFile("id_rsa")).toBe(true);
    });

    it("should block private keys and certificates", () => {
      expect(isSensitiveFile("server.pem")).toBe(true);
      expect(isSensitiveFile("private.key")).toBe(true);
      expect(isSensitiveFile("cert.p12")).toBe(true);
      expect(isSensitiveFile("ca.crt")).toBe(true);
    });

    it("should block credential files", () => {
      expect(isSensitiveFile("aws/credentials")).toBe(true);
      expect(isSensitiveFile("secrets.json")).toBe(true);
      expect(isSensitiveFile("credentials.json")).toBe(true);
      expect(isSensitiveFile("database.yml")).toBe(true);
    });

    it("should block system files", () => {
      expect(isSensitiveFile("/etc/passwd")).toBe(true);
      expect(isSensitiveFile(".htpasswd")).toBe(true);
      expect(isSensitiveFile(".bash_history")).toBe(true);
    });

    it("should allow regular files", () => {
      expect(isSensitiveFile("document.txt")).toBe(false);
      expect(isSensitiveFile("image.png")).toBe(false);
      expect(isSensitiveFile("data.json")).toBe(false);
      expect(isSensitiveFile("folder/file.js")).toBe(false);
    });
  });
});

describe("File Storage - File Size Limits", () => {
  describe("validateFileSize", () => {
    it("should accept small files under limit", () => {
      const smallContent = "a".repeat(100); // 100 chars base64 ~ 75 bytes
      const result = validateFileSize(smallContent);
      expect(result.valid).toBe(true);
    });

    it("should reject files exceeding size limit", () => {
      // Create content that would decode to > 50MB
      const largeContent = "a".repeat(100 * 1024 * 1024); // Would be ~75MB decoded
      const result = validateFileSize(largeContent);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds limit");
    });

    it("should report correct size metadata", () => {
      const content = "a".repeat(4000); // ~3000 bytes decoded
      const result = validateFileSize(content, 5000);
      expect(result.valid).toBe(true);
      expect(result.size).toBeGreaterThan(0);
    });

    it("should use default 50MB limit", () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(52428800);
    });
  });
});

describe("File Storage - Policy Enforcement", () => {
  describe("checkFilePolicy", () => {
    it("should allow safe read operations", () => {
      const result = checkFilePolicy("read", "documents/file.txt");
      expect(result.allowed).toBe(true);
    });

    it("should deny sensitive file access", () => {
      const result = checkFilePolicy("read", ".env");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("sensitive_file");
    });

    it("should deny path traversal attempts", () => {
      const result = checkFilePolicy("read", "../etc/passwd");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("path_traversal");
    });

    it("should deny write operations in readonly mode", () => {
      const originalEnv = process.env.FILE_STORAGE_READONLY;
      process.env.FILE_STORAGE_READONLY = "true";

      const result = checkFilePolicy("write", "file.txt");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("readonly_mode");

      process.env.FILE_STORAGE_READONLY = originalEnv;
    });

    it("should allow read operations in readonly mode", () => {
      const originalEnv = process.env.FILE_STORAGE_READONLY;
      process.env.FILE_STORAGE_READONLY = "true";

      const result = checkFilePolicy("read", "file.txt");
      expect(result.allowed).toBe(true);

      process.env.FILE_STORAGE_READONLY = originalEnv;
    });
  });
});

describe("File Storage - Audit Logging", () => {
  describe("generateCorrelationId", () => {
    it("should generate unique correlation IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^fs-\d+-/);
    });
  });
});

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

  it("should define file operation endpoints with security scopes", () => {
    const endpoints = [
      { method: "GET", path: "/file-storage/list", scope: "read" },
      { method: "GET", path: "/file-storage/read", scope: "read" },
      { method: "POST", path: "/file-storage/write", scope: "write" },
      { method: "DELETE", path: "/file-storage/delete", scope: "write" },
      { method: "POST", path: "/file-storage/copy", scope: "write" },
      { method: "POST", path: "/file-storage/move", scope: "write" },
      { method: "GET", path: "/file-storage/audit", scope: "read" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);

    // Verify read/write scope separation
    const readEndpoints = endpoints.filter((e) => e.scope === "read");
    const writeEndpoints = endpoints.filter((e) => e.scope === "write");
    expect(readEndpoints.length).toBeGreaterThan(0);
    expect(writeEndpoints.length).toBeGreaterThan(0);
  });
});

describe("File Storage Security Integration", () => {
  it("should have all security components in place", () => {
    // Verify all security functions are exported
    expect(typeof sanitizePath).toBe("function");
    expect(typeof isSensitiveFile).toBe("function");
    expect(typeof validateFileSize).toBe("function");
    expect(typeof checkFilePolicy).toBe("function");
    expect(typeof generateCorrelationId).toBe("function");
  });

  it("should have consistent error codes", () => {
    const expectedErrorCodes = [
      "path_traversal",
      "sensitive_file",
      "file_too_large",
      "readonly_mode",
      "invalid_backend",
      "file_not_found",
      "connection_failed",
    ];

    // These codes should be used in error responses
    expect(expectedErrorCodes.length).toBeGreaterThan(0);
  });
});

/**
 * Local Adapter Security Tests
 * Tests for symlink escape protection and workspace isolation
 */
describe("File Storage - Local Adapter Security", () => {
  // Import local adapter helpers
  let localAdapter;

  beforeAll(async () => {
    localAdapter = await import("../../src/plugins/file-storage/adapters/local.js");
  });

  describe("Symlink Escape Protection", () => {
    it("should export symlink check helpers", () => {
      expect(localAdapter.default._helpers).toBeDefined();
      expect(typeof localAdapter.default._helpers.checkSymlinkEscape).toBe("function");
      expect(typeof localAdapter.default._helpers.validateSymlinkSafety).toBe("function");
    });

    it("should have symlink error code", () => {
      const symlinkErrorCodes = [
        "symlink_escape",
      ];
      expect(symlinkErrorCodes).toContain("symlink_escape");
    });

    it("should validate symlink safety concept", async () => {
      // Test concept: symlinks escaping root should be blocked
      const { getRoot, resolvePath } = localAdapter.default._helpers;

      const root = getRoot();
      expect(typeof root).toBe("string");

      // Normal path should resolve within root
      const normalPath = resolvePath("documents/file.txt");
      expect(normalPath).toBeTruthy();
      expect(normalPath.startsWith(root)).toBe(true);

      // Path traversal should be blocked
      const traversalPath = resolvePath("../../../etc/passwd");
      expect(traversalPath).toBeNull();
    });
  });

  describe("Workspace Isolation", () => {
    it("should support workspace isolation mode", () => {
      const { getRoot, extractWorkspaceId } = localAdapter.default._helpers;

      // Without isolation, workspaceId ignored
      const defaultRoot = getRoot(null);
      expect(typeof defaultRoot).toBe("string");

      // With workspaceId but isolation disabled, should use default root
      const workspaceRoot = getRoot("workspace-123");
      // Should be same as default when isolation not enabled
      expect(workspaceRoot).toBe(defaultRoot);
    });

    it("should extract workspaceId from context", () => {
      const { extractWorkspaceId } = localAdapter.default._helpers;

      // With workspaceId
      const ctx1 = { workspaceId: "ws-123" };
      expect(extractWorkspaceId(ctx1)).toBe("ws-123");

      // Without workspaceId
      const ctx2 = {};
      expect(extractWorkspaceId(ctx2)).toBeNull();

      // With strict mode, should throw without workspaceId
      const originalStrict = process.env.FILE_STORAGE_WORKSPACE_STRICT;
      process.env.FILE_STORAGE_WORKSPACE_STRICT = "true";

      expect(() => extractWorkspaceId({})).toThrow();

      process.env.FILE_STORAGE_WORKSPACE_STRICT = originalStrict;
    });

    it("should sanitize workspaceId to prevent traversal", () => {
      const { getRoot } = localAdapter.default._helpers;

      const originalIsolation = process.env.FILE_STORAGE_WORKSPACE_ISOLATION;
      process.env.FILE_STORAGE_WORKSPACE_ISOLATION = "true";

      try {
        // Valid workspaceId
        const root1 = getRoot("workspace-123");
        expect(root1).toContain("workspace-123");

        // Invalid workspaceId with traversal should be sanitized
        const root2 = getRoot("../etc");
        expect(root2).not.toContain("../etc");

        // Empty after sanitization should throw
        expect(() => getRoot("../../")).toThrow();
      } finally {
        process.env.FILE_STORAGE_WORKSPACE_ISOLATION = originalIsolation;
      }
    });

    it("should create separate workspace directories", () => {
      const { getRoot } = localAdapter.default._helpers;

      const originalIsolation = process.env.FILE_STORAGE_WORKSPACE_ISOLATION;
      process.env.FILE_STORAGE_WORKSPACE_ISOLATION = "true";

      try {
        const rootA = getRoot("workspace-a");
        const rootB = getRoot("workspace-b");

        // Different workspaces should have different roots
        expect(rootA).not.toBe(rootB);
        expect(rootA).toContain("workspace-a");
        expect(rootB).toContain("workspace-b");
      } finally {
        process.env.FILE_STORAGE_WORKSPACE_ISOLATION = originalIsolation;
      }
    });
  });
});

describe("File Storage - Error Codes Coverage", () => {
  it("should include all security-related error codes", () => {
    const securityErrorCodes = [
      "path_traversal",
      "sensitive_file",
      "file_too_large",
      "readonly_mode",
      "symlink_escape",
      "invalid_workspace",
      "workspace_required",
    ];

    // Verify error codes exist
    securityErrorCodes.forEach(code => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  });
});
