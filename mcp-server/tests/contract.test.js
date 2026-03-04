import { describe, it, expect } from "vitest";

/**
 * Contract Tests
 * Response envelope contract validation.
 */

describe("Response Envelope Contract", () => {
  const validateEnvelope = (data) => {
    // Must have ok boolean
    expect(typeof data.ok).toBe("boolean");
    // Must have meta with requestId
    expect(data.meta).toBeDefined();
    expect(typeof data.meta.requestId).toBe("string");

    if (data.ok) {
      // Success: must have data
      expect(data.data).toBeDefined();
      expect(data.error).toBeUndefined();
    } else {
      // Error: must have error object with code and message
      expect(data.error).toBeDefined();
      expect(typeof data.error.code).toBe("string");
      expect(typeof data.error.message).toBe("string");
      expect(data.data).toBeUndefined();
    }
  };

  it("validates success envelope structure", () => {
    const successResponse = {
      ok: true,
      data: { status: "ok" },
      meta: { requestId: "req-123" },
    };
    validateEnvelope(successResponse);
  });

  it("validates error envelope structure", () => {
    const errorResponse = {
      ok: false,
      error: {
        code: "validation_error",
        message: "Field required",
        details: { fieldErrors: { name: ["Required"] } },
      },
      meta: { requestId: "req-456" },
    };
    validateEnvelope(errorResponse);
  });

  it("validates error without details", () => {
    const errorResponse = {
      ok: false,
      error: {
        code: "not_found",
        message: "Resource not found",
      },
      meta: { requestId: "req-789" },
    };
    validateEnvelope(errorResponse);
  });
});

describe("Plugin Manifest Contract", () => {
  const validateManifest = (manifest) => {
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.version).toBe("string");
    expect(Array.isArray(manifest.endpoints)).toBe(true);

    for (const ep of manifest.endpoints) {
      expect(typeof ep.method).toBe("string");
      expect(typeof ep.path).toBe("string");
      expect(typeof ep.description).toBe("string");
      if (ep.scope) {
        expect(["read", "write", "admin", "danger"]).toContain(ep.scope);
      }
    }
  };

  it("validates minimal manifest", () => {
    const manifest = {
      name: "test-plugin",
      version: "1.0.0",
      endpoints: [
        { method: "GET", path: "/test", description: "Test endpoint" },
      ],
    };
    validateManifest(manifest);
  });

  it("validates full manifest with scopes", () => {
    const manifest = {
      name: "test-plugin",
      version: "1.0.0",
      description: "Test plugin",
      capabilities: ["read", "write"],
      endpoints: [
        { method: "GET", path: "/test", description: "Test endpoint", scope: "read" },
        { method: "POST", path: "/test", description: "Create test", scope: "write" },
      ],
      requires: ["API_KEY"],
    };
    validateManifest(manifest);
  });
});
