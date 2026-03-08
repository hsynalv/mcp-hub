import { describe, it, expect } from "vitest";
import { validatePluginContract, validateMetaFile } from "../framework/contract.js";
import * as plugin from "../../src/plugins/notion/index.js";
import meta from "../../src/plugins/notion/plugin.meta.json" assert { type: "json" };

describe("notion - Contract Tests", () => {
  describe("metadata", () => {
    it("should have valid plugin.meta.json", () => {
      const result = validateMetaFile(meta, "notion");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should be marked as stable", () => {
      expect(meta.status).toBe("stable");
    });

    it("should require auth", () => {
      expect(meta.requiresAuth).toBe(true);
    });

    it("should have write scope for security", () => {
      expect(meta.security.scope).toBe("write");
    });
  });

  describe("exports", () => {
    it("should have valid contract", () => {
      const result = validatePluginContract(plugin, "notion");
      expect(result.valid).toBe(true);
    });

    it("should export name", () => {
      expect(plugin.name).toBe("notion");
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

    it("should have proper scope separation", () => {
      const writeEndpoints = plugin.endpoints.filter(e => e.method !== "GET");
      for (const endpoint of writeEndpoints) {
        expect(endpoint.scope).toBe("write");
      }
    });
  });

  describe("tools", () => {
    it("should have tools defined", () => {
      expect(Array.isArray(plugin.tools)).toBe(true);
      expect(plugin.tools.length).toBeGreaterThan(0);
    });

    it("should have proper tool tags", () => {
      for (const tool of plugin.tools) {
        expect(tool.tags).toBeDefined();
        expect(tool.tags.length).toBeGreaterThan(0);
      }
    });
  });
});
