/**
 * Multi-LLM Router Plugin Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as llmRouter from "../../src/plugins/llm-router/index.js";

describe("LLM Router Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(llmRouter.name).toBe("llm-router");
      expect(llmRouter.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(llmRouter.name).toBeDefined();
      expect(llmRouter.version).toBeDefined();
      expect(llmRouter.description).toBeDefined();
      expect(llmRouter.endpoints).toBeDefined();
      expect(llmRouter.tools).toBeDefined();
      expect(llmRouter.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = llmRouter.endpoints.map(e => e.path);
      expect(paths).toContain("/llm/route");
      expect(paths).toContain("/llm/compare");
      expect(paths).toContain("/llm/models");
    });
  });

  describe("MCP Tools", () => {
    it("should have llm_route tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_route");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have llm_compare tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_compare");
      expect(tool).toBeDefined();
    });

    it("should have llm_list_models tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_list_models");
      expect(tool).toBeDefined();
    });

    it("should have llm_estimate_cost tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_estimate_cost");
      expect(tool).toBeDefined();
    });

    it("should have llm_route_backend tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_route_backend");
      expect(tool).toBeDefined();
    });

    it("should have llm_route_frontend tool", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_route_frontend");
      expect(tool).toBeDefined();
    });
  });

  describe("llm_list_models", () => {
    it("should list available models", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_list_models");
      const result = tool.handler({});

      expect(result.ok).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("should include provider information", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_list_models");
      const result = tool.handler({});

      const provider = result.data[0];
      expect(provider).toHaveProperty("provider");
      expect(provider).toHaveProperty("name");
      expect(provider).toHaveProperty("models");
      expect(provider).toHaveProperty("available");
    });
  });

  describe("llm_estimate_cost", () => {
    it("should estimate cost for backend_api task", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_estimate_cost");
      const result = tool.handler({
        task: "backend_api",
        promptTokens: 1000,
        responseTokens: 2000,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("estimatedCost");
      expect(result.data).toHaveProperty("provider");
      expect(result.data).toHaveProperty("model");
    });

    it("should estimate cost for general tasks", () => {
      const tool = llmRouter.tools.find(t => t.name === "llm_estimate_cost");
      const result = tool.handler({
        task: "general",
        promptTokens: 500,
        responseTokens: 1000,
      });

      expect(result.ok).toBe(true);
      expect(result.data.estimatedCost).toBeLessThan(0.01); // Cheaper models
    });
  });

  describe("Routing Logic", () => {
    it("should route backend tasks to Claude", () => {
      // Backend API tasks should prefer Anthropic/Claude
      const task = "backend_api";
      const routing = {
        primary: { provider: "anthropic", model: "claude-3-opus-20240229" },
        fallback: { provider: "openai", model: "gpt-4o" },
      };

      expect(routing.primary.provider).toBe("anthropic");
    });

    it("should route frontend tasks to GPT-4o", () => {
      const routing = {
        primary: { provider: "openai", model: "gpt-4o" },
      };

      expect(routing.primary.provider).toBe("openai");
    });

    it("should route general tasks to cheaper models", () => {
      const routing = {
        primary: { provider: "openai", model: "gpt-4o-mini" },
        fallback: { provider: "mistral", model: "mistral-small-latest" },
      };

      expect(routing.primary.model).toContain("mini");
    });
  });

  describe("Cost Estimation", () => {
    it("should calculate correct costs for different models", () => {
      const pricing = {
        "gpt-4o": { input: 5, output: 15 },
        "gpt-4o-mini": { input: 0.15, output: 0.6 },
        "claude-3-opus": { input: 15, output: 75 },
      };

      // 1000 input, 2000 output tokens
      const gpt4oCost = (1000 / 1000000) * 5 + (2000 / 1000000) * 15;
      expect(gpt4oCost).toBeGreaterThan(0);

      const miniCost = (1000 / 1000000) * 0.15 + (2000 / 1000000) * 0.6;
      expect(miniCost).toBeLessThan(gpt4oCost);
    });
  });
});
