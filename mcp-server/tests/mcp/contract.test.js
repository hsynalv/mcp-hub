/**
 * MCP Contract Tests
 *
 * Tests that verify MCP protocol compliance and tool registry consistency.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpServer } from "../src/mcp/gateway.js";
import {
  registerTool,
  clearTools,
  listTools,
  ToolTags,
} from "../src/core/tool-registry.js";

// Mock policy engine
vi.mock("../src/plugins/policy/policy.engine.js", () => ({
  evaluate: vi.fn(() => ({ allowed: true })),
}));

describe("MCP Contract Tests", () => {
  beforeEach(() => {
    clearTools();
  });

  describe("listTools contract", () => {
    it("should return empty tools list when registry is empty", async () => {
      const server = createMcpServer();
      const result = await server.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { user: null }
      );

      expect(result.tools).toEqual([]);
    });

    it("should return all registered tools with correct schema", async () => {
      registerTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        handler: async () => "result",
        tags: [ToolTags.READ],
      });

      registerTool({
        name: "another_tool",
        description: "Another test tool",
        inputSchema: { type: "object" },
        handler: async () => "result",
        tags: [ToolTags.WRITE, ToolTags.NETWORK],
      });

      const server = createMcpServer();
      const result = await server.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { user: null }
      );

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toContain("test_tool");
      expect(result.tools.map((t) => t.name)).toContain("another_tool");

      // Verify schema structure
      const testTool = result.tools.find((t) => t.name === "test_tool");
      expect(testTool.description).toBe("A test tool");
      expect(testTool.inputSchema.type).toBe("object");
      expect(testTool.inputSchema.properties).toBeDefined();
    });

    it("should not expose handler or internal fields in listTools", async () => {
      registerTool({
        name: "secure_tool",
        description: "A secure tool",
        inputSchema: { type: "object" },
        handler: async () => "secret",
        plugin: "test",
        tags: [ToolTags.READ],
      });

      const server = createMcpServer();
      const result = await server.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { user: null }
      );

      const tool = result.tools[0];
      expect(tool.handler).toBeUndefined();
      expect(tool.plugin).toBeUndefined();
      expect(tool.tags).toBeUndefined();
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe("callTool contract", () => {
    it("should return error for non-existent tool", async () => {
      const server = createMcpServer();
      const result = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "nonexistent", arguments: {} },
        },
        { user: null }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("tool_not_found");
    });

    it("should execute tool and return result in MCP format", async () => {
      registerTool({
        name: "greet",
        description: "Greet someone",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        handler: async (args) => ({ message: `Hello ${args.name}` }),
        tags: [ToolTags.READ],
      });

      const server = createMcpServer();
      const result = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "greet", arguments: { name: "World" } },
        },
        { user: null }
      );

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const data = JSON.parse(result.content[0].text);
      expect(data.message).toBe("Hello World");
    });

    it("should handle tool execution errors gracefully", async () => {
      registerTool({
        name: "failing_tool",
        description: "A tool that fails",
        inputSchema: { type: "object" },
        handler: async () => {
          throw new Error("Intentional failure");
        },
        tags: [ToolTags.READ],
      });

      const server = createMcpServer();
      const result = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "failing_tool", arguments: {} },
        },
        { user: null }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("tool_execution_error");
    });
  });

  describe("tool tags in registry", () => {
    it("should preserve tags in tool registry", () => {
      registerTool({
        name: "tagged_tool",
        description: "A tagged tool",
        handler: async () => "result",
        tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
      });

      const tools = listTools();
      expect(tools[0].tags).toEqual([
        ToolTags.READ,
        ToolTags.NETWORK,
        ToolTags.EXTERNAL_API,
      ]);
    });

    it("should filter invalid tags", () => {
      registerTool({
        name: "partial_tool",
        description: "A tool with some invalid tags",
        handler: async () => "result",
        tags: [ToolTags.READ, "INVALID_TAG", ToolTags.WRITE, "ANOTHER_INVALID"],
      });

      const tools = listTools();
      expect(tools[0].tags).toEqual([ToolTags.READ, ToolTags.WRITE]);
    });
  });
});
