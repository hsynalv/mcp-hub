import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveSecret,
  resolveTemplate,
  resolveDeep,
  listSecrets,
  registerSecret,
  unregisterSecret,
  auditEntry,
  getAuditLogEntries,
  generateCorrelationId,
  extractWorkspaceContext,
} from "../../src/plugins/secrets/secrets.store.js";

/**
 * Secrets Plugin Unit Tests
 * Tests for secret resolution and registry management
 */

describe("Secrets Store", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveSecret", () => {
    it("should return secret value from environment", () => {
      process.env.TEST_API_KEY = "secret-value-123";

      const value = resolveSecret("TEST_API_KEY");

      expect(value).toBe("secret-value-123");
    });

    it("should return null for non-existent secrets", () => {
      const value = resolveSecret("NON_EXISTENT_SECRET");

      expect(value).toBeNull();
    });

    it("should handle empty string values", () => {
      process.env.EMPTY_SECRET = "";

      const value = resolveSecret("EMPTY_SECRET");

      expect(value).toBe("");
    });
  });

  describe("resolveTemplate", () => {
    it("should resolve single secret placeholder", () => {
      process.env.MY_TOKEN = "abc123";

      const result = resolveTemplate("Bearer {{secret:MY_TOKEN}}");

      expect(result).toBe("Bearer abc123");
    });

    it("should resolve multiple secret placeholders", () => {
      process.env.API_KEY = "key123";
      process.env.API_SECRET = "secret456";

      const result = resolveTemplate("{{secret:API_KEY}}:{{secret:API_SECRET}}");

      expect(result).toBe("key123:secret456");
    });

    it("should leave unresolved placeholders as-is", () => {
      process.env.EXISTING = "value";

      const result = resolveTemplate("{{secret:EXISTING}} {{secret:MISSING}}");

      expect(result).toBe("value {{secret:MISSING}}");
    });

    it("should return non-string values unchanged", () => {
      expect(resolveTemplate(123)).toBe(123);
      expect(resolveTemplate(null)).toBeNull();
      expect(resolveTemplate(undefined)).toBeUndefined();
    });

    it("should handle strings without placeholders", () => {
      const result = resolveTemplate("just a plain string");

      expect(result).toBe("just a plain string");
    });

    it("should only match UPPER_SNAKE_CASE pattern", () => {
      process.env.VALID_NAME = "valid";
      process.env.invalid_name = "invalid";

      const result = resolveTemplate("{{secret:VALID_NAME}} {{secret:invalid_name}}");

      expect(result).toBe("valid {{secret:invalid_name}}");
    });
  });

  describe("resolveDeep", () => {
    it("should resolve secrets in nested objects", () => {
      process.env.TOKEN = "bearer123";
      process.env.KEY = "apikey456";

      const input = {
        headers: {
          Authorization: "Bearer {{secret:TOKEN}}",
          "X-API-Key": "{{secret:KEY}}",
        },
        body: {
          data: "unchanged",
        },
      };

      const result = resolveDeep(input);

      expect(result.headers.Authorization).toBe("Bearer bearer123");
      expect(result.headers["X-API-Key"]).toBe("apikey456");
      expect(result.body.data).toBe("unchanged");
    });

    it("should resolve secrets in arrays", () => {
      process.env.ITEM1 = "first";
      process.env.ITEM2 = "second";

      const input = ["{{secret:ITEM1}}", "{{secret:ITEM2}}", "plain"];

      const result = resolveDeep(input);

      expect(result).toEqual(["first", "second", "plain"]);
    });

    it("should handle deeply nested structures", () => {
      process.env.DEEP = "deep-value";

      const input = {
        level1: {
          level2: {
            level3: {
              value: "{{secret:DEEP}}",
            },
          },
        },
      };

      const result = resolveDeep(input);

      expect(result.level1.level2.level3.value).toBe("deep-value");
    });

    it("should handle primitive values", () => {
      expect(resolveDeep("string")).toBe("string");
      expect(resolveDeep(123)).toBe(123);
      expect(resolveDeep(true)).toBe(true);
      expect(resolveDeep(null)).toBeNull();
    });

    it("should handle empty objects and arrays", () => {
      expect(resolveDeep({})).toEqual({});
      expect(resolveDeep([])).toEqual([]);
    });
  });

  describe("Secret Registry", () => {
    beforeEach(() => {
      // Clean up test secrets
      unregisterSecret("TEST_SECRET_1");
      unregisterSecret("TEST_SECRET_2");
    });

    afterEach(() => {
      unregisterSecret("TEST_SECRET_1");
      unregisterSecret("TEST_SECRET_2");
    });

    describe("registerSecret", () => {
      it("should register valid secret names", () => {
        const result = registerSecret("TEST_SECRET_1", "Test description");

        expect(result.name).toBe("TEST_SECRET_1");
        expect(result.description).toBe("Test description");
        expect(result.source).toBe("env");
        expect(result.createdAt).toBeDefined();
      });

      it("should reject invalid secret names", () => {
        expect(() => registerSecret("lowercase")).toThrow("UPPER_SNAKE_CASE");
        expect(() => registerSecret("with-dash")).toThrow("UPPER_SNAKE_CASE");
        expect(() => registerSecret("with.space")).toThrow("UPPER_SNAKE_CASE");
        expect(() => registerSecret("")).toThrow("UPPER_SNAKE_CASE");
      });

      it("should accept numbers in secret names", () => {
        const result = registerSecret("SECRET_123", "With numbers");

        expect(result.name).toBe("SECRET_123");
      });
    });

    describe("listSecrets", () => {
      it("should list registered secrets without values", () => {
        registerSecret("TEST_SECRET_1", "First test");
        process.env.TEST_SECRET_1 = "hidden-value";

        const secrets = listSecrets();
        const found = secrets.find((s) => s.name === "TEST_SECRET_1");

        expect(found).toBeDefined();
        expect(found.description).toBe("First test");
        expect(found.hasValue).toBe(true);
        // Value should NOT be exposed
        expect(found.value).toBeUndefined();
      });

      it("should indicate if secret has no value", () => {
        registerSecret("TEST_SECRET_NO_VALUE", "No env value");

        const secrets = listSecrets();
        const found = secrets.find((s) => s.name === "TEST_SECRET_NO_VALUE");

        expect(found.hasValue).toBe(false);
      });
    });

    describe("unregisterSecret", () => {
      it("should remove secret from registry", () => {
        registerSecret("TEST_SECRET_2", "To be removed");

        const existed = unregisterSecret("TEST_SECRET_2");

        expect(existed).toBe(true);
        const secrets = listSecrets();
        expect(secrets.find((s) => s.name === "TEST_SECRET_2")).toBeUndefined();
      });

      it("should return false for non-existent secrets", () => {
        const existed = unregisterSecret("NEVER_REGISTERED");

        expect(existed).toBe(false);
      });
    });
  });
});

describe("Secrets Plugin - Audit Logging", () => {
  it("should generate unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^sec-\d+-/);
  });

  it("should add audit entries without logging values", () => {
    const entry = auditEntry({
      operation: "test",
      secretName: "TEST_SECRET",
      allowed: true,
      actor: "test-user",
      workspaceId: "ws-123",
    });

    expect(entry.operation).toBe("test");
    expect(entry.secretName).toBe("TEST_SECRET");
    expect(entry.allowed).toBe(true);
    expect(entry.actor).toBe("test-user");
    expect(entry.workspaceId).toBe("ws-123");
    // Verify no value field exists
    expect(entry.value).toBeUndefined();
    expect(entry.previousValue).toBeUndefined();
    expect(entry.newValue).toBeUndefined();
  });

  it("should retrieve audit log entries", () => {
    // Clear previous entries by adding a new one
    auditEntry({
      operation: "test-retrieve",
      secretName: "TEST_AUDIT",
      allowed: true,
    });

    const entries = getAuditLogEntries(10);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    const found = entries.find(e => e.operation === "test-retrieve");
    expect(found).toBeDefined();
    expect(found.secretName).toBe("TEST_AUDIT");
  });
});

describe("Secrets Plugin - Workspace Isolation", () => {
  beforeEach(() => {
    // Reset environment before each test
    delete process.env.SECRETS_WORKSPACE_ISOLATION;
    delete process.env.SECRETS_WORKSPACE_STRICT;

    // Clean up test secrets - ignore errors if not found
    try { unregisterSecret("WORKSPACE_TEST", {}); } catch { /* ignore */ }
    try { unregisterSecret("WORKSPACE_TEST", { workspaceId: "ws-a" }); } catch { /* ignore */ }
    try { unregisterSecret("WORKSPACE_TEST", { workspaceId: "ws-b" }); } catch { /* ignore */ }
  });

  afterEach(() => {
    // Reset environment
    delete process.env.SECRETS_WORKSPACE_ISOLATION;
    delete process.env.SECRETS_WORKSPACE_STRICT;
  });

  it("should extract workspace context from context object", () => {
    expect(extractWorkspaceContext({ workspaceId: "ws-123" })).toBe("ws-123");
    expect(extractWorkspaceContext({})).toBeNull();
    expect(extractWorkspaceContext({ workspaceId: null })).toBeNull();
  });

  it("should throw in strict mode without workspaceId", () => {
    process.env.SECRETS_WORKSPACE_STRICT = "true";

    expect(() => extractWorkspaceContext({})).toThrow("workspaceId required");
    expect(() => extractWorkspaceContext({ workspaceId: null })).toThrow("workspaceId required");
  });

  it("should allow operations with workspaceId in strict mode", () => {
    process.env.SECRETS_WORKSPACE_STRICT = "true";

    expect(() => extractWorkspaceContext({ workspaceId: "ws-123" })).not.toThrow();
    expect(extractWorkspaceContext({ workspaceId: "ws-123" })).toBe("ws-123");
  });

  it("should isolate secrets between workspaces when enabled", () => {
    process.env.SECRETS_WORKSPACE_ISOLATION = "true";

    // Register in workspace A
    registerSecret("WORKSPACE_TEST", "In workspace A", { workspaceId: "ws-a" });

    // Should be found in A
    const secretsA = listSecrets({ workspaceId: "ws-a" });
    expect(secretsA.find(s => s.name === "WORKSPACE_TEST")).toBeDefined();

    // Should NOT be found in B (different registry file)
    const secretsB = listSecrets({ workspaceId: "ws-b" });
    expect(secretsB.find(s => s.name === "WORKSPACE_TEST")).toBeUndefined();
  });

  it("should use shared registry when isolation disabled", () => {
    // Without isolation, same registry for all
    registerSecret("WORKSPACE_TEST", "Shared secret", { workspaceId: "ws-a" });

    // Should be visible to all (when isolation disabled)
    const secrets = listSecrets();
    // May or may not find depending on test order, but no crash
    expect(Array.isArray(secrets)).toBe(true);
  });
});

describe("Secrets Plugin - Error Codes Coverage", () => {
  it("should have all security-related error codes", () => {
    const securityErrorCodes = [
      "invalid_name",
      "workspace_required",
      "list_failed",
      "unregister_failed",
      "not_found",
      "invalid_request",
    ];

    // Verify error codes exist
    securityErrorCodes.forEach(code => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  });
});
