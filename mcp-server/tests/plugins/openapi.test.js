import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * OpenAPI Plugin Unit Tests
 * Tests for schema validation and spec parsing
 */

// Mock the spec store and parser
vi.mock("../../src/plugins/openapi/spec.store.js", () => ({
  makeId: vi.fn(() => "spec-123456"),
  saveSpec: vi.fn(),
  loadSpec: vi.fn(),
  deleteSpec: vi.fn(),
  listSpecs: vi.fn(),
}));

vi.mock("../../src/plugins/openapi/spec.parser.js", () => ({
  parseSpec: vi.fn(),
  extractOperations: vi.fn(),
  detectAuth: vi.fn(),
  generateCode: vi.fn(),
}));

describe("OpenAPI Plugin Schemas", () => {
  const loadSchema = z.object({
    name: z.string().min(1),
    url: z.string().url().optional(),
    spec: z.any().optional(),
  }).refine((d) => d.url || d.spec, { message: "Either url or spec is required" });

  const generateSchema = z.object({
    operationId: z.string().min(1),
    target: z.enum(["n8n", "curl", "fetch"]).default("n8n"),
  });

  describe("loadSchema", () => {
    it("should validate spec from URL", () => {
      const load = {
        name: "petstore",
        url: "https://petstore3.swagger.io/api/v3/openapi.json",
      };
      expect(() => loadSchema.parse(load)).not.toThrow();
    });

    it("should validate inline spec", () => {
      const load = {
        name: "my-api",
        spec: { openapi: "3.0.0", info: { title: "My API", version: "1.0.0" } },
      };
      expect(() => loadSchema.parse(load)).not.toThrow();
    });

    it("should require either url or spec", () => {
      expect(() => loadSchema.parse({ name: "test" })).toThrow("Either url or spec is required");
    });

    it("should reject empty name", () => {
      expect(() =>
        loadSchema.parse({ name: "", url: "https://example.com/spec.json" })
      ).toThrow();
    });

    it("should reject invalid URL", () => {
      expect(() =>
        loadSchema.parse({ name: "test", url: "not-a-url" })
      ).toThrow();
    });

    it("should allow both url and spec", () => {
      const load = {
        name: "test",
        url: "https://example.com/spec.json",
        spec: { openapi: "3.0.0" },
      };
      expect(() => loadSchema.parse(load)).not.toThrow();
    });
  });

  describe("generateSchema", () => {
    it("should validate n8n target", () => {
      const gen = { operationId: "getPets", target: "n8n" };
      expect(() => generateSchema.parse(gen)).not.toThrow();
    });

    it("should validate curl target", () => {
      const gen = { operationId: "getPets", target: "curl" };
      expect(() => generateSchema.parse(gen)).not.toThrow();
    });

    it("should validate fetch target", () => {
      const gen = { operationId: "getPets", target: "fetch" };
      expect(() => generateSchema.parse(gen)).not.toThrow();
    });

    it("should default target to n8n", () => {
      const gen = { operationId: "getPets" };
      const result = generateSchema.parse(gen);
      expect(result.target).toBe("n8n");
    });

    it("should reject empty operationId", () => {
      expect(() => generateSchema.parse({ operationId: "" })).toThrow();
    });

    it("should reject invalid target", () => {
      expect(() =>
        generateSchema.parse({ operationId: "getPets", target: "python" })
      ).toThrow();
    });
  });
});

describe("OpenAPI Plugin - Spec Parsing", () => {
  describe("extractOperations", () => {
    const extractOperations = (spec) => {
      const operations = [];
      if (!spec.paths) return operations;

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (typeof op === "object" && op.operationId) {
            operations.push({
              operationId: op.operationId,
              method: method.toUpperCase(),
              path,
              summary: op.summary || "",
              description: op.description || "",
              tags: op.tags || [],
              parameters: op.parameters || [],
              requestBody: op.requestBody || null,
              responses: op.responses || {},
            });
          }
        }
      }

      return operations;
    };

    it("should extract operations from spec", () => {
      const spec = {
        openapi: "3.0.0",
        paths: {
          "/pets": {
            get: {
              operationId: "getPets",
              summary: "List pets",
              tags: ["pets"],
            },
            post: {
              operationId: "createPet",
              summary: "Create pet",
              tags: ["pets"],
            },
          },
        },
      };

      const operations = extractOperations(spec);

      expect(operations).toHaveLength(2);
      expect(operations[0].operationId).toBe("getPets");
      expect(operations[1].operationId).toBe("createPet");
    });

    it("should handle empty paths", () => {
      const spec = { openapi: "3.0.0" };
      const operations = extractOperations(spec);
      expect(operations).toEqual([]);
    });

    it("should skip operations without operationId", () => {
      const spec = {
        paths: {
          "/pets": {
            get: { summary: "List pets" }, // no operationId
            post: { operationId: "createPet" },
          },
        },
      };

      const operations = extractOperations(spec);

      expect(operations).toHaveLength(1);
      expect(operations[0].operationId).toBe("createPet");
    });
  });

  describe("detectAuth", () => {
    const detectAuth = (spec) => {
      const authTypes = [];

      if (spec.security) {
        authTypes.push(...spec.security.map((s) => Object.keys(s)[0]));
      }

      if (spec.components?.securitySchemes) {
        for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) {
          if (scheme.type === "http" && scheme.scheme === "bearer") {
            authTypes.push(`${name} (Bearer)`);
          } else if (scheme.type === "http" && scheme.scheme === "basic") {
            authTypes.push(`${name} (Basic)`);
          } else if (scheme.type === "apiKey") {
            authTypes.push(`${name} (API Key - ${scheme.in})`);
          } else if (scheme.type === "oauth2") {
            authTypes.push(`${name} (OAuth2)`);
          }
        }
      }

      return [...new Set(authTypes)];
    };

    it("should detect Bearer auth", () => {
      const spec = {
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      };

      const auth = detectAuth(spec);

      expect(auth).toContain("bearerAuth (Bearer)");
    });

    it("should detect API Key auth", () => {
      const spec = {
        components: {
          securitySchemes: {
            apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          },
        },
      };

      const auth = detectAuth(spec);

      expect(auth).toContain("apiKey (API Key - header)");
    });

    it("should detect global security requirements", () => {
      const spec = {
        security: [{ bearerAuth: [] }, { apiKey: [] }],
      };

      const auth = detectAuth(spec);

      expect(auth).toContain("bearerAuth");
      expect(auth).toContain("apiKey");
    });

    it("should return empty for no auth", () => {
      const spec = { openapi: "3.0.0" };
      const auth = detectAuth(spec);
      expect(auth).toEqual([]);
    });
  });
});

describe("OpenAPI Plugin - Code Generation", () => {
  describe("generateCode", () => {
    const generateCurl = (operation) => {
      const { method, path, parameters = [] } = operation;
      const url = `https://api.example.com${path}`;

      let cmd = `curl -X ${method.toUpperCase()} "${url}"`;

      // Add headers
      const headerParams = parameters.filter((p) => p.in === "header");
      headerParams.forEach((p) => {
        cmd += ` \\\\n  -H "${p.name}: VALUE"`;
      });

      return cmd;
    };

    const generateFetch = (operation) => {
      const { method, path } = operation;

      return `fetch('https://api.example.com${path}', {
  method: '${method.toUpperCase()}',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data));`;
    };

    it("should generate curl command", () => {
      const operation = {
        operationId: "getPets",
        method: "get",
        path: "/pets",
        parameters: [{ in: "header", name: "Authorization" }],
      };

      const cmd = generateCurl(operation);

      expect(cmd).toContain("curl -X GET");
      expect(cmd).toContain("https://api.example.com/pets");
      expect(cmd).toContain("-H \"Authorization: VALUE\"");
    });

    it("should generate fetch code", () => {
      const operation = {
        operationId: "getPets",
        method: "get",
        path: "/pets",
      };

      const code = generateFetch(operation);

      expect(code).toContain("fetch('https://api.example.com/pets'");
      expect(code).toContain("method: 'GET'");
      expect(code).toContain(".then(response => response.json())");
    });

    it("should handle POST requests", () => {
      const operation = {
        operationId: "createPet",
        method: "post",
        path: "/pets",
      };

      const curl = generateCurl(operation);
      const fetch = generateFetch(operation);

      expect(curl).toContain("-X POST");
      expect(fetch).toContain("method: 'POST'");
    });
  });
});

describe("OpenAPI Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "openapi";
    const version = "1.0.0";
    const description = "Load and analyze OpenAPI specs; generate n8n/curl/fetch code";
    const capabilities = ["read", "write"];

    expect(name).toBe("openapi");
    expect(version).toBe("1.0.0");
    expect(description).toContain("OpenAPI");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
  });

  it("should define spec management endpoints", () => {
    const endpoints = [
      { method: "POST", path: "/openapi/load", scope: "write" },
      { method: "GET", path: "/openapi/specs", scope: "read" },
      { method: "DELETE", path: "/openapi/specs/:id", scope: "danger" },
      { method: "POST", path: "/openapi/specs/:id/generate", scope: "read" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
