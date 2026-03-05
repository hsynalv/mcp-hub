/**
 * MCP Gateway Server
 *
 * Creates an MCP server instance that exposes tools from the tool registry.
 * Supports both HTTP (Streamable HTTP) and STDIO transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { listTools, callTool } from "../core/tool-registry.js";

/**
 * Create an MCP server instance
 * @returns {Server} MCP server instance
 */
export function createMcpServer() {
  const server = new Server(
    {
      name: "mcp-hub",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        // resources and prompts can be added later
      },
    }
  );

  // Handle listTools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listTools();
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || { type: "object" },
      })),
    };
  });

  // Handle callTool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const context = {
      method: "MCP",
      user: request.context?.user || null,
      requestId: request.id,
    };

    const result = await callTool(name, args || {}, context);

    // Convert result to MCP format
    if (result.ok) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
        isError: false,
      };
    } else {
      // Handle policy-driven responses
      if (result.error?.code === "require_approval") {
        return {
          content: [
            {
              type: "text",
              text: `⏳ Approval Required\n\n${result.error.message}\n\nApproval ID: ${result.error.approval?.id}`,
            },
          ],
          isError: false, // Not an error, just needs approval
        };
      }

      if (result.error?.code === "dry_run") {
        return {
          content: [
            {
              type: "text",
              text: `🔍 Dry Run Mode\n\n${result.error.message}\n\nPreview:\n\`\`\`json\n${JSON.stringify(result.error.preview, null, 2)}\n\`\`\``,
            },
          ],
          isError: false,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.code}\n\n${result.error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
