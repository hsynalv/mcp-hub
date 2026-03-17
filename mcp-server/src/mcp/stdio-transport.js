/**
 * MCP STDIO Transport
 *
 * Handles MCP protocol over stdin/stdout for Claude Desktop and other
 * MCP clients that use stdio transport.
 *
 * Workspace context: When authInfo is not provided by the transport layer,
 * the gateway falls back to process.env (HUB_WORKSPACE_ID, HUB_PROJECT_ID,
 * HUB_ENV). Set these before starting for workspace-aware tool execution.
 */

import { createMcpServer } from "./gateway.js";
import { setDebug } from "../core/debug.js";

/**
 * Start MCP server with stdio transport
 * This is the main entry point for Claude Desktop and other stdio-based MCP clients
 */
export function startStdioTransport() {
  const server = createMcpServer();

  // Enable debug mode if requested
  if (process.env.DEBUG === "true") {
    setDebug(true, { traceRequests: true, traceTools: true });
  }

  // Handle incoming messages from stdin
  process.stdin.on("data", async (data) => {
    try {
      const lines = data.toString().split("\n").filter((line) => line.trim());

      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch (parseErr) {
          sendErrorResponse(null, -32700, "Parse error", parseErr.message);
          continue;
        }

        // Handle the message
        const response = await handleMessage(server, message);
        if (response) {
          sendResponse(response);
        }
      }
    } catch (err) {
      console.error("[stdio] Error handling message:", err);
      sendErrorResponse(null, -32603, "Internal error", err.message);
    }
  });

  // Handle process termination
  process.on("SIGINT", () => {
    console.error("[stdio] Received SIGINT, shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[stdio] Received SIGTERM, shutting down...");
    process.exit(0);
  });

  // Log startup (to stderr, not stdout)
  console.error("[stdio] MCP server started on stdio transport");
  console.error("[stdio] Waiting for messages...");
}

/**
 * Handle a single MCP message
 */
async function handleMessage(server, message) {
  const { jsonrpc, id, method, params } = message;

  if (jsonrpc !== "2.0") {
    return createErrorResponse(id, -32600, "Invalid Request", "Expected jsonrpc 2.0");
  }

  try {
    // Map MCP protocol methods to server handlers
    switch (method) {
      case "initialize":
        return createSuccessResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "mcp-hub",
            version: "1.0.0",
          },
        });

      case "initialized":
        // Client confirmed initialization, no response needed
        return null;

      case "tools/list":
        const toolsResult = await server.request(
          { method: "tools/list" },
          { timeout: 30000 }
        );
        return createSuccessResponse(id, toolsResult);

      case "tools/call":
        const callResult = await server.request(
          { method: "tools/call", params },
          { timeout: 120000 }
        );
        return createSuccessResponse(id, callResult);

      default:
        return createErrorResponse(id, -32601, "Method not found", `Method ${method} not supported`);
    }
  } catch (err) {
    console.error(`[stdio] Error handling method ${method}:`, err);
    return createErrorResponse(id, -32603, "Internal error", err.message);
  }
}

/**
 * Create a successful JSON-RPC response
 */
function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * Create an error JSON-RPC response
 */
function createErrorResponse(id, code, message, data = null) {
  const response = {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
  if (data) {
    response.error.data = data;
  }
  return response;
}

/**
 * Send a response to stdout
 */
function sendResponse(response) {
  const line = JSON.stringify(response);
  process.stdout.write(line + "\n");
}

/**
 * Send an error response
 */
function sendErrorResponse(id, code, message, data) {
  sendResponse(createErrorResponse(id, code, message, data));
}

// Auto-start if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioTransport();
}
