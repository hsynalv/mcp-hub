/**
 * MCP STDIO Transport (legacy)
 *
 * This module is not the supported production entry. Use the package binary
 * {@link ../../bin/mcp-hub-stdio.js mcp-hub-stdio.js} (see package.json "bin").
 *
 * Direct execution of this file skips plugin loading, security bootstrap, and
 * validated session auth — unsafe for production unless intentionally allowed.
 */

import { pathToFileURL } from "url";
import { createMcpServer } from "./gateway.js";
import { setDebug } from "../core/debug.js";

function isDirectExecutionAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

function assertLegacyStdioEntryAllowed() {
  console.error(
    "[mcp-hub-stdio] DEPRECATED: src/mcp/stdio-transport.js is not a supported production entry. Use: npx mcp-hub-stdio (bin/mcp-hub-stdio.js)."
  );
  if (process.env.NODE_ENV === "production" && process.env.HUB_ALLOW_LEGACY_STDIO_TRANSPORT !== "true") {
    console.error(
      "[mcp-hub-stdio] Refusing legacy stdio entry in production. Set HUB_ALLOW_LEGACY_STDIO_TRANSPORT=true only for deliberate testing."
    );
    process.exit(1);
  }
}

/**
 * @deprecated Use `bin/mcp-hub-stdio.js`. This path does not run security validation or session auth.
 */
export function startStdioTransport() {
  const server = createMcpServer();

  if (process.env.DEBUG === "true") {
    setDebug(true, { traceRequests: true, traceTools: true });
  }

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

  process.on("SIGINT", () => {
    console.error("[stdio] Received SIGINT, shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[stdio] Received SIGTERM, shutting down...");
    process.exit(0);
  });

  console.error("[stdio] MCP server started on stdio transport (legacy path)");
  console.error("[stdio] Waiting for messages...");
}

async function handleMessage(server, message) {
  const { jsonrpc, id, method } = message;

  if (jsonrpc !== "2.0") {
    return createErrorResponse(id, -32600, "Invalid Request", "Expected jsonrpc 2.0");
  }

  try {
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
        return null;

      case "tools/list": {
        const toolsResult = await server.request({ method: "tools/list" }, { timeout: 30000 });
        return createSuccessResponse(id, toolsResult);
      }

      case "tools/call": {
        const callResult = await server.request(
          { method: "tools/call", params: message.params },
          { timeout: 120000 }
        );
        return createSuccessResponse(id, callResult);
      }

      default:
        return createErrorResponse(id, -32601, "Method not found", `Method ${method} not supported`);
    }
  } catch (err) {
    console.error(`[stdio] Error handling method ${method}:`, err);
    return createErrorResponse(id, -32603, "Internal error", err.message);
  }
}

function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

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

function sendResponse(response) {
  const line = JSON.stringify(response);
  process.stdout.write(line + "\n");
}

function sendErrorResponse(id, code, message, data) {
  sendResponse(createErrorResponse(id, code, message, data));
}

if (isDirectExecutionAsCli()) {
  assertLegacyStdioEntryAllowed();
  startStdioTransport();
}
