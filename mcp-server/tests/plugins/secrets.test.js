import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveSecret,
  resolveTemplate,
  resolveDeep,
  listSecrets,
  registerSecret,
  unregisterSecret,
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
