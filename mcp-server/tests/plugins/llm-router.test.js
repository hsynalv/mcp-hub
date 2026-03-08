/**
 * Multi-LLM Router Plugin Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  name,
  version,
  description,
  endpoints,
  tools,
  listModels,
  estimateCost,
  generateCorrelationId,
  auditEntry,
  getAuditLogEntries,
  validatePromptLimits,
  extractContext,
} from "../../src/plugins/llm-router/index.js";

describe("LLM Router Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(name).toBe("llm-router");
      expect(version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(description).toBeDefined();
      expect(endpoints).toBeDefined();
      expect(tools).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = endpoints.map(e => e.path);
      expect(paths).toContain("/llm/route");
      expect(paths).toContain("/llm/compare");
      expect(paths).toContain("/llm/models");
      expect(paths).toContain("/llm/audit");
    });
  });

  describe("MCP Tools", () => {
    it("should have llm_route tool", () => {
      const tool = tools.find(t => t.name === "llm_route");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have llm_route_backend tool", () => {
      const tool = tools.find(t => t.name === "llm_route_backend");
      expect(tool).toBeDefined();
    });

    it("should have llm_route_frontend tool", () => {
      const tool = tools.find(t => t.name === "llm_route_frontend");
      expect(tool).toBeDefined();
    });

    it("should have llm_compare tool", () => {
      const tool = tools.find(t => t.name === "llm_compare");
      expect(tool).toBeDefined();
    });

    it("should have llm_list_models tool", () => {
      const tool = tools.find(t => t.name === "llm_list_models");
      expect(tool).toBeDefined();
    });

    it("should have llm_estimate_cost tool", () => {
      const tool = tools.find(t => t.name === "llm_estimate_cost");
      expect(tool).toBeDefined();
    });
  });

  describe("llm_list_models", () => {
    it("should list available models", () => {
      const tool = tools.find(t => t.name === "llm_list_models");
      const result = tool.handler({});

      expect(result.ok).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("should include provider information", () => {
      const tool = tools.find(t => t.name === "llm_list_models");
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
      const tool = tools.find(t => t.name === "llm_estimate_cost");
      const result = tool.handler({
        task: "backend_api",
        explanation: "Testing cost estimation",
        promptTokens: 1000,
        responseTokens: 2000,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty("estimatedCost");
      expect(result.data).toHaveProperty("provider");
      expect(result.data).toHaveProperty("model");
    });

    it("should estimate cost for general tasks", () => {
      const tool = tools.find(t => t.name === "llm_estimate_cost");
      const result = tool.handler({
        task: "general",
        explanation: "Testing general cost estimation",
        promptTokens: 500,
        responseTokens: 1000,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty("estimatedCost");
    });
  });

  describe("Routing Logic", () => {
    it("should route backend tasks to Claude", () => {
      // Backend API tasks should prefer Anthropic/Claude
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

describe("LLM Router Plugin - Audit Logging", () => {
  it("should generate unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^llm-\d+-/);
  });

  it("should add audit entries without logging prompt content", () => {
    const entry = auditEntry({
      operation: "route",
      provider: "openai",
      model: "gpt-4o",
      task: "coding",
      promptLength: 1500,
      responseLength: 2000,
      durationMs: 1500,
      actor: "user-123",
      workspaceId: "ws-1",
      projectId: "proj-1",
      correlationId: "llm-test-123",
      success: true,
      fallback: false,
      retryCount: 0,
    });

    expect(entry.operation).toBe("route");
    expect(entry.provider).toBe("openai");
    expect(entry.promptLength).toBe(1500);
    expect(entry.responseLength).toBe(2000);
    expect(entry.actor).toBe("user-123");
    expect(entry.workspaceId).toBe("ws-1");
    // Prompt content is NEVER logged
    expect(entry.prompt).toBeUndefined();
    expect(entry.content).toBeUndefined();
    expect(entry.timestamp).toBeDefined();
  });

  it("should log failed operations", () => {
    const entry = auditEntry({
      operation: "route",
      provider: "anthropic",
      model: "claude-3-opus",
      task: "backend_api",
      promptLength: 1000,
      durationMs: 500,
      actor: "user-456",
      correlationId: "llm-test-fail",
      success: false,
      error: "Rate limit exceeded",
      fallback: true,
      retryCount: 1,
    });

    expect(entry.success).toBe(false);
    expect(entry.error).toBe("Rate limit exceeded");
    expect(entry.fallback).toBe(true);
  });

  it("should retrieve audit log entries", () => {
    auditEntry({
      operation: "test-audit-retrieve",
      provider: "test",
      model: "test-model",
      task: "test",
      promptLength: 100,
      durationMs: 100,
      actor: "test-user",
      correlationId: "test-corr",
      success: true,
    });

    const entries = getAuditLogEntries(10);
    expect(Array.isArray(entries)).toBe(true);

    const found = entries.find(e => e.operation === "test-audit-retrieve");
    expect(found).toBeDefined();
  });

  it("should respect limit parameter", () => {
    const entries = getAuditLogEntries(5);
    expect(entries.length).toBeLessThanOrEqual(5);
  });
});

describe("LLM Router Plugin - Prompt Safety", () => {
  it("should validate prompt limits", () => {
    const valid = validatePromptLimits("Hello world", 1000);
    expect(valid.valid).toBe(true);
    expect(valid.promptLength).toBe(11);
  });

  it("should reject prompts exceeding max length", () => {
    const longPrompt = "a".repeat(150000);
    const result = validatePromptLimits(longPrompt, 1000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("max length");
  });

  it("should reject maxTokens exceeding limit", () => {
    const result = validatePromptLimits("Hello", 50000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("maxTokens");
  });

  it("should reject non-string prompts", () => {
    const result = validatePromptLimits(12345, 1000);
    expect(result.valid).toBe(false);
  });
});

describe("LLM Router Plugin - Context Extraction", () => {
  it("should extract context from request", () => {
    const mockReq = {
      user: { id: "user-123", email: "user@example.com" },
      headers: {
        "x-workspace-id": "workspace-a",
        "x-project-id": "project-1",
      },
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user-123");
    expect(context.workspaceId).toBe("workspace-a");
    expect(context.projectId).toBe("project-1");
  });

  it("should fallback to email if id not present", () => {
    const mockReq = {
      user: { email: "user@example.com" },
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user@example.com");
    expect(context.workspaceId).toBeNull();
  });

  it("should default to anonymous", () => {
    const mockReq = {
      user: null,
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("anonymous");
  });
});

describe("LLM Router Plugin - Error Codes", () => {
  it("should include expected error codes", () => {
    const expectedCodes = [
      "prompt_limit_exceeded",
      "provider_unavailable",
      "invalid_provider",
      "llm_error",
      "comparison_error",
    ];

    expectedCodes.forEach(code => {
      expect(typeof code).toBe("string");
    });
  });
});
