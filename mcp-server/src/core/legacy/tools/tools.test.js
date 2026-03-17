/**
 * Tools Test Suite
 *
 * Tests for the tool discovery system.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolStatus, VALID_TOOL_STATUSES } from "./tool.types.js";
import {
  extractToolName,
  normalizeTool,
  normalizeSchema,
  generateExampleFromSchema,
} from "./tool.schema.js";
import {
  validateTool,
  validateMultipleTools,
  isValidTool,
  assertValidTool,
} from "./tool.validation.js";
import {
  formatTool,
  formatTools,
  formatToolForAgent,
  formatToolForUI,
  formatToolList,
  formatToolNotFound,
} from "./tool.presenter.js";
import {
  ToolRegistry,
  createToolRegistry,
  getToolRegistry,
  setToolRegistry,
} from "./tool.registry.js";

describe("Tool System", () => {
  describe("Tool Schema", () => {
    it("should extract tool name from string", () => {
      expect(extractToolName("execute")).toBe("execute");
    });

    it("should extract tool name from object", () => {
      expect(extractToolName({ name: "execute" })).toBe("execute");
      expect(extractToolName({ id: "run" })).toBe("run");
    });

    it("should return null for invalid input", () => {
      expect(extractToolName(null)).toBeNull();
      expect(extractToolName({})).toBeNull();
    });

    it("should normalize tool from string", () => {
      const plugin = {
        name: "shell",
        enabled: true,
        metadata: {
          scopes: ["write"],
          status: "stable",
        },
      };

      const tool = normalizeTool("execute", plugin);

      expect(tool.name).toBe("shell.execute");
      expect(tool.plugin).toBe("shell");
      expect(tool.tool).toBe("execute");
      expect(tool.enabled).toBe(true);
    });

    it("should normalize tool from object", () => {
      const plugin = {
        name: "rag",
        enabled: true,
        metadata: {},
      };

      const rawTool = {
        name: "index",
        description: "Index documents",
        scopes: ["write"],
        capabilities: ["index"],
        category: "documents",
        tags: ["rag", "search"],
      };

      const tool = normalizeTool(rawTool, plugin);

      expect(tool.name).toBe("rag.index");
      expect(tool.description).toBe("Index documents");
      expect(tool.scopes).toEqual(["write"]);
      expect(tool.capabilities).toEqual(["index"]);
      expect(tool.category).toBe("documents");
      expect(tool.tags).toEqual(["rag", "search"]);
    });

    it("should normalize schema", () => {
      const rawSchema = {
        type: "object",
        description: "Input params",
        fields: {
          path: { type: "string" },
        },
        requiredFields: ["path"],
      };

      const normalized = normalizeSchema(rawSchema);

      expect(normalized.type).toBe("object");
      expect(normalized.description).toBe("Input params");
      expect(normalized.properties).toEqual({ path: { type: "string" } });
      expect(normalized.required).toEqual(["path"]);
    });

    it("should return null for null schema", () => {
      expect(normalizeSchema(null)).toBeNull();
    });

    it("should generate example from schema", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", example: "test.txt" },
          size: { type: "number" },
          active: { type: "boolean" },
          items: { type: "array" },
          meta: { type: "object" },
          status: { type: "string", enum: ["active", "inactive"] },
        },
      };

      const example = generateExampleFromSchema(schema);

      expect(example.name).toBe("test.txt");
      expect(example.size).toBe(0);
      expect(example.active).toBe(false);
      expect(example.items).toEqual([]);
      expect(example.meta).toEqual({});
      expect(example.status).toBe("active");
    });
  });

  describe("Tool Validation", () => {
    it("should validate valid tool", () => {
      const tool = {
        name: "shell.execute",
        plugin: "shell",
        description: "Execute command",
        scopes: ["write"],
        status: ToolStatus.STABLE,
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject tool without required fields", () => {
      const tool = { description: "No name" };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
      expect(result.errors).toContain("Missing required field: plugin");
    });

    it("should reject tool with invalid status", () => {
      const tool = {
        name: "test.tool",
        plugin: "test",
        status: "invalid",
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid status"))).toBe(true);
    });

    it("should warn about missing description", () => {
      const tool = {
        name: "test.tool",
        plugin: "test",
      };

      const result = validateTool(tool);

      expect(result.warnings).toContain("Missing recommended field: description");
    });

    it("should validate multiple tools", () => {
      const tools = [
        { name: "test.valid", plugin: "test", description: "Valid" },
        { name: "test.invalid" }, // missing plugin
      ];

      const result = validateMultipleTools(tools);

      expect(result.total).toBe(2);
      expect(result.valid).toBe(1);
      expect(result.invalid).toBe(1);
    });

    it("should check isValidTool", () => {
      expect(isValidTool({ name: "test.tool", plugin: "test" })).toBe(true);
      expect(isValidTool({})).toBe(false);
    });

    it("should assert valid tool", () => {
      expect(() => {
        assertValidTool({ name: "test.tool", plugin: "test" });
      }).not.toThrow();

      expect(() => {
        assertValidTool({}, "Custom error");
      }).toThrow("Custom error");
    });

    it("should reject tool with invalid name format", () => {
      const tool = {
        name: "invalidname",
        plugin: "test",
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("plugin.tool format"))).toBe(true);
    });

    it("should warn about productionReady with experimental status", () => {
      const tool = {
        name: "test.tool",
        plugin: "test",
        productionReady: true,
        status: ToolStatus.EXPERIMENTAL,
      };

      const result = validateTool(tool);

      expect(result.warnings).toContain(
        "Tool marked productionReady but status is experimental"
      );
    });
  });

  describe("Tool Presenter", () => {
    const sampleTool = {
      name: "shell.execute",
      plugin: "shell",
      tool: "execute",
      description: "Execute shell command",
      category: "execution",
      status: ToolStatus.STABLE,
      enabled: true,
      scopes: ["write"],
      capabilities: ["execute", "shell"],
      riskLevel: "critical",
      productionReady: true,
      supportsAudit: true,
      supportsPolicy: true,
      tags: ["system", "dangerous"],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      examples: [{ input: {}, output: {} }],
      notes: "Dangerous",
    };

    it("should format tool for API", () => {
      const formatted = formatTool(sampleTool);

      expect(formatted.name).toBe("shell.execute");
      expect(formatted.plugin).toBe("shell");
      expect(formatted.description).toBe("Execute shell command");
      expect(formatted.inputSchema).toBeDefined();
      expect(formatted.outputSchema).toBeDefined();
    });

    it("should format tool in compact mode", () => {
      const formatted = formatTool(sampleTool, { compact: true });

      expect(formatted.name).toBeDefined();
      expect(formatted.scopes).toBeUndefined();
      expect(formatted.capabilities).toBeUndefined();
      expect(formatted.notes).toBeUndefined();
    });

    it("should format tool without schema", () => {
      const formatted = formatTool(sampleTool, { includeSchema: false });

      expect(formatted.inputSchema).toBeUndefined();
      expect(formatted.outputSchema).toBeUndefined();
    });

    it("should filter specific fields", () => {
      const formatted = formatTool(sampleTool, { fields: ["name", "status"] });

      expect(formatted.name).toBeDefined();
      expect(formatted.status).toBeDefined();
      expect(formatted.description).toBeUndefined();
    });

    it("should format multiple tools", () => {
      const tools = [sampleTool, sampleTool];
      const formatted = formatTools(tools);

      expect(formatted).toHaveLength(2);
    });

    it("should format tool for agent", () => {
      const formatted = formatToolForAgent(sampleTool);

      expect(formatted.name).toBeDefined();
      expect(formatted.description).toBeDefined();
      expect(formatted.inputSchema).toBeDefined();
      expect(formatted.outputSchema).toBeDefined();
      expect(formatted.scopes).toBeDefined();
      expect(formatted.capabilities).toBeDefined();
      expect(formatted.plugin).toBeUndefined();
    });

    it("should format tool for UI", () => {
      const formatted = formatToolForUI(sampleTool);

      expect(formatted.name).toBeDefined();
      expect(formatted.plugin).toBeDefined();
      expect(formatted.tool).toBeDefined();
      expect(formatted.tags).toBeDefined();
      // backend and notes are optional; formatToolForUI passes them through
      expect(formatted).toHaveProperty("backend");
      expect(formatted).toHaveProperty("notes");
    });

    it("should format tool list", () => {
      const result = formatToolList([sampleTool], null, { compact: true });

      expect(result.tools).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should include pagination", () => {
      const pagination = { offset: 0, limit: 10, hasMore: false };
      const result = formatToolList([sampleTool], pagination);

      expect(result.pagination).toEqual(pagination);
    });

    it("should format not found error", () => {
      const error = formatToolNotFound("missing.tool");

      expect(error.error.message).toContain("missing.tool");
      expect(error.error.code).toBe("TOOL_NOT_FOUND");
    });
  });

  describe("Tool Registry", () => {
    let registry;

    beforeEach(() => {
      registry = createToolRegistry();
    });

    it("should create empty registry", () => {
      expect(registry.getAll()).toHaveLength(0);
      expect(registry.isInitialized()).toBe(false);
    });

    it("should add tool", () => {
      const tool = {
        name: "test.tool",
        plugin: "test",
        description: "Test",
      };

      registry.set(tool);

      expect(registry.get("test.tool")).toBe(tool);
      expect(registry.has("test.tool")).toBe(true);
    });

    it("should filter tools", () => {
      registry.set({
        name: "shell.execute",
        plugin: "shell",
        status: ToolStatus.STABLE,
        scopes: ["write"],
        capabilities: ["execute"],
        category: "system",
        enabled: true,
      });

      registry.set({
        name: "rag.index",
        plugin: "rag",
        status: ToolStatus.BETA,
        scopes: ["write"],
        capabilities: ["index"],
        category: "ai",
        enabled: true,
      });

      expect(registry.filter({ plugin: "shell" })).toHaveLength(1);
      expect(registry.filter({ scope: "write" })).toHaveLength(2);
      expect(registry.filter({ capability: "execute" })).toHaveLength(1);
      expect(registry.filter({ status: ToolStatus.STABLE })).toHaveLength(1);
      expect(registry.filter({ category: "ai" })).toHaveLength(1);
    });

    it("should get by plugin", () => {
      registry.set({
        name: "test.a",
        plugin: "test",
        enabled: true,
      });

      registry.set({
        name: "other.b",
        plugin: "other",
        enabled: true,
      });

      expect(registry.getByPlugin("test")).toHaveLength(1);
    });

    it("should get by scope", () => {
      registry.set({
        name: "test.a",
        plugin: "test",
        scopes: ["read"],
        enabled: true,
      });

      registry.set({
        name: "test.b",
        plugin: "test",
        scopes: ["write"],
        enabled: true,
      });

      expect(registry.getByScope("write")).toHaveLength(1);
    });

    it("should search tools", () => {
      registry.set({
        name: "shell.execute",
        plugin: "shell",
        description: "Run commands",
        category: "system",
        tags: ["dangerous"],
        enabled: true,
      });

      expect(registry.search("execute")).toHaveLength(1);
      expect(registry.search("system")).toHaveLength(1);
      expect(registry.search("dangerous")).toHaveLength(1);
      expect(registry.search("rag")).toHaveLength(0);
    });

    it("should get categories", () => {
      registry.set({
        name: "test.a",
        plugin: "test",
        category: "category1",
        enabled: true,
      });

      registry.set({
        name: "test.b",
        plugin: "test",
        category: "category2",
        enabled: true,
      });

      const categories = registry.getCategories();
      expect(categories).toContain("category1");
      expect(categories).toContain("category2");
    });

    it("should get statistics", () => {
      registry.set({
        name: "test.a",
        plugin: "test",
        status: ToolStatus.STABLE,
        productionReady: true,
        supportsAudit: true,
        supportsPolicy: false,
        enabled: true,
      });

      registry.set({
        name: "test.b",
        plugin: "test",
        status: ToolStatus.BETA,
        productionReady: false,
        supportsAudit: true,
        supportsPolicy: true,
        enabled: true,
      });

      const stats = registry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byStatus[ToolStatus.STABLE]).toBe(1);
      expect(stats.byStatus[ToolStatus.BETA]).toBe(1);
      expect(stats.productionReady).toBe(1);
      expect(stats.supportsAudit).toBe(2);
      expect(stats.supportsPolicy).toBe(1);
    });

    it("should delete tool", () => {
      registry.set({ name: "test.tool", plugin: "test" });

      const deleted = registry.delete("test.tool");

      expect(deleted).toBe(true);
      expect(registry.has("test.tool")).toBe(false);
    });

    it("should clear registry", () => {
      registry.set({ name: "test.tool", plugin: "test" });

      registry.clear();

      expect(registry.getAll()).toHaveLength(0);
    });

    it("should manage global instance", () => {
      setToolRegistry(null);

      const registry1 = getToolRegistry();
      const registry2 = getToolRegistry();

      expect(registry1).toBe(registry2);
    });
  });
});
