import { describe, it, expect } from "vitest";
import { validatePluginContract, validateMetaFile } from "../framework/contract.js";
import * as plugin from "../../src/plugins/llm-router/index.js";
import meta from "../../src/plugins/llm-router/plugin.meta.json" assert { type: "json" };

describe("llm-router - Contract Tests", () => {
  describe("metadata", () => {
    it("should have valid plugin.meta.json", () => {
      const result = validateMetaFile(meta, "llm-router");
      expect(result.valid).toBe(true);
    });

    it("should be marked as stable", () => {
      expect(meta.status).toBe("stable");
    });

    it("should support jobs", () => {
      expect(meta.supportsJobs).toBe(true);
    });

    it("should have resilience enabled", () => {
      expect(meta.resilience.retry).toBe(true);
      expect(meta.resilience.circuitBreaker).toBe(true);
    });
  });

  describe("exports", () => {
    it("should have valid contract", () => {
      const result = validatePluginContract(plugin, "llm-router");
      expect(result.valid).toBe(true);
    });

    it("should export routing functions", () => {
      expect(typeof plugin.routeTask).toBe("function");
      expect(typeof plugin.listModels).toBe("function");
      expect(typeof plugin.estimateCost).toBe("function");
    });
  });

  describe("tools", () => {
    it("should have routing tools", () => {
      const routeTool = plugin.tools.find(t => t.name === "llm_route");
      expect(routeTool).toBeDefined();
      expect(routeTool.inputSchema.properties.task).toBeDefined();
    });

    it("should have cost estimation", () => {
      const costTool = plugin.tools.find(t => t.name === "llm_estimate_cost");
      expect(costTool).toBeDefined();
    });
  });
});
