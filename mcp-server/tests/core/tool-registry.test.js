/**
 * Tool Registry Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerTool,
  unregisterTool,
  getTool,
  listTools,
  clearTools,
  callTool,
} from "../../src/core/tool-registry.js";

// Mock policy engine
vi.mock("../../src/plugins/policy/policy.engine.js", () => ({
  evaluate: vi.fn(() => ({ allowed: true })),
}));

describe("Tool Registry", () => {
  beforeEach(() => {
    clearTools();
  });

  describe("registerTool", () => {
    it("should register a tool", () => {
      registerTool({
        name: "test_tool",
        description: "A test tool",
        handler: async () => "result",
      });

      const tool = getTool("test_tool");
      expect(tool).toBeDefined();
      expect(tool.name).toBe("test_tool");
      expect(tool.description).toBe("A test tool");
    });

    it("should throw if tool has no name", () => {
      expect(() =>
        registerTool({
          description: "A test tool",
          handler: async () => "result",
        })
      ).toThrow("Tool must have a name");
    });

    it("should throw if tool has no handler", () => {
      expect(() =>
        registerTool({
          name: "test_tool",
          description: "A test tool",
        })
      ).toThrow("Tool must have a handler function");
    });
  });

  describe("listTools", () => {
    it("should return empty array when no tools", () => {
      expect(listTools()).toEqual([]);
    });

    it("should return all registered tools", () => {
      registerTool({
        name: "tool1",
        description: "First tool",
        handler: async () => "result1",
      });
      registerTool({
        name: "tool2",
        description: "Second tool",
        handler: async () => "result2",
      });

      const tools = listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("tool1");
      expect(tools.map((t) => t.name)).toContain("tool2");
    });
  });

  describe("getTool", () => {
    it("should return undefined for non-existent tool", () => {
      expect(getTool("nonexistent")).toBeUndefined();
    });

    it("should return the tool", () => {
      registerTool({
        name: "my_tool",
        description: "My tool",
        handler: async () => "result",
      });

      const tool = getTool("my_tool");
      expect(tool).toBeDefined();
      expect(tool.name).toBe("my_tool");
    });
  });

  describe("callTool", () => {
    it("should return error for non-existent tool", async () => {
      const result = await callTool("nonexistent", {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("tool_not_found");
    });

    it("should call the tool handler", async () => {
      registerTool({
        name: "greet",
        description: "Greet someone",
        handler: async (args) => ({ message: `Hello ${args.name}` }),
      });

      const result = await callTool("greet", { name: "World" });
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ message: "Hello World" });
    });

    it("should wrap successful result in envelope", async () => {
      registerTool({
        name: "simple",
        description: "Simple tool",
        handler: async () => "raw result",
      });

      const result = await callTool("simple", {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe("raw result");
    });

    it("should handle tool errors", async () => {
      registerTool({
        name: "failing",
        description: "Failing tool",
        handler: async () => {
          throw new Error("Something went wrong");
        },
      });

      const result = await callTool("failing", {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("tool_execution_error");
    });
  });
});
