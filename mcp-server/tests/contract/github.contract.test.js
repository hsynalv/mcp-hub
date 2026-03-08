import { describe, it, expect, beforeAll } from "vitest";
import { validatePluginContract, validateMetaFile } from "../framework/contract.js";
import * as plugin from "../../src/plugins/github/index.js";
import meta from "../../src/plugins/github/plugin.meta.json" assert { type: "json" };

describe("github - Contract Tests", () => {
  describe("metadata", () => {
    it("should have valid plugin.meta.json", () => {
      const result = validateMetaFile(meta, "github");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should be marked as stable", () => {
      expect(meta.status).toBe("stable");
    });

    it("should require auth", () => {
      expect(meta.requiresAuth).toBe(true);
    });

    it("should have test level >= unit", () => {
      expect(["unit", "integration", "e2e"]).toContain(meta.testLevel);
    });
  });

  describe("exports", () => {
    it("should have valid contract", () => {
      const result = validatePluginContract(plugin, "github");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should export name", () => {
      expect(plugin.name).toBe("github");
    });

    it("should export version", () => {
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("should export register function", () => {
      expect(typeof plugin.register).toBe("function");
    });
  });

  describe("endpoints", () => {
    it("should have endpoints defined", () => {
      expect(Array.isArray(plugin.endpoints)).toBe(true);
      expect(plugin.endpoints.length).toBeGreaterThan(0);
    });

    it("should have valid endpoint structure", () => {
      for (const endpoint of plugin.endpoints) {
        expect(endpoint.path).toBeDefined();
        expect(endpoint.method).toBeDefined();
        expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(endpoint.method);
        expect(endpoint.scope).toBeDefined();
        expect(["read", "write", "admin"]).toContain(endpoint.scope);
      }
    });

    it("should have read scope for list operations", () => {
      const listEndpoints = plugin.endpoints.filter(e => 
        e.path.includes("/repos") || e.path.includes("/analyze")
      );
      for (const endpoint of listEndpoints) {
        expect(endpoint.scope).toBe("read");
      }
    });
  });

  describe("tools", () => {
    it("should have tools defined", () => {
      expect(Array.isArray(plugin.tools)).toBe(true);
      expect(plugin.tools.length).toBeGreaterThan(0);
    });

    it("should have valid tool structure", () => {
      for (const tool of plugin.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(typeof tool.handler).toBe("function");
      }
    });

    it("should have input schemas", () => {
      for (const tool of plugin.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });
});
