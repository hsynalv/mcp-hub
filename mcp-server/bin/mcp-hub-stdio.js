#!/usr/bin/env node
/**
 * MCP Hub STDIO Entrypoint
 *
 * CLI entrypoint for MCP STDIO transport.
 * Usage: npx mcp-hub-stdio [options]
 *
 * Options:
 *   --api-key <key>      API key for authentication
 *   --scope <scope>      Default scope (read/write/admin)
 *   --project-id <id>    Default project ID
 *   --env <env>          Default environment
 */

import { createMcpServer } from "../src/mcp/gateway.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apiKey: process.env.HUB_API_KEY || null,
    scope: process.env.HUB_SCOPE || "read",
    projectId: process.env.HUB_PROJECT_ID || null,
    env: process.env.HUB_ENV || "development",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--api-key":
        options.apiKey = args[++i];
        break;
      case "--scope":
        options.scope = args[++i];
        break;
      case "--project-id":
        options.projectId = args[++i];
        break;
      case "--env":
        options.env = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(`
MCP Hub STDIO Server

Usage: npx mcp-hub-stdio [options]

Options:
  --api-key <key>      API key for authentication (env: HUB_API_KEY)
  --scope <scope>      Default scope: read|write|admin (env: HUB_SCOPE)
  --project-id <id>    Default project ID (env: HUB_PROJECT_ID)
  --env <env>          Default environment (env: HUB_ENV)
  --help, -h           Show this help

Examples:
  npx mcp-hub-stdio --api-key secret123 --scope write
  HUB_PROJECT_ID=myproj npx mcp-hub-stdio
`);
        process.exit(0);
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  // Validate API key if auth is enabled
  if (process.env.HUB_AUTH_ENABLED === "true" && !options.apiKey) {
    console.error("Error: API key required. Provide --api-key or set HUB_API_KEY");
    process.exit(1);
  }

  // Set context for the session
  process.env.HUB_SCOPE = options.scope;
  if (options.projectId) process.env.HUB_PROJECT_ID = options.projectId;
  if (options.env) process.env.HUB_ENV = options.env;

  // Create and start MCP server with STDIO transport
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  console.error("[mcp-hub-stdio] Starting MCP Hub STDIO server...");
  console.error(`[mcp-hub-stdio] Scope: ${options.scope}`);
  if (options.projectId) console.error(`[mcp-hub-stdio] Project: ${options.projectId}`);
  console.error(`[mcp-hub-stdio] Environment: ${options.env}`);

  await server.connect(transport);

  console.error("[mcp-hub-stdio] MCP server connected via STDIO");

  // Handle shutdown gracefully
  process.on("SIGINT", async () => {
    console.error("\n[mcp-hub-stdio] Shutting down...");
    await transport.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("\n[mcp-hub-stdio] Shutting down...");
    await transport.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[mcp-hub-stdio] Fatal error:", err);
  process.exit(1);
});
