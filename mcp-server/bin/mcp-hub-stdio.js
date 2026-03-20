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

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

// Cursor/STDIO expects ONLY JSON-RPC frames on stdout.
// Send all logs to stderr to avoid breaking JSON parsing.
console.log = (...args) => process.stderr.write(args.join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");
// keep console.error as-is (already stderr)

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envCandidates = [
  process.env.ENV_FILE,
  join(__dirname, "..", ".env"),
  join(process.cwd(), ".env"),
].filter(Boolean);

for (const p of envCandidates) {
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apiKey: process.env.HUB_API_KEY || null,
    scope: process.env.HUB_SCOPE || "read",
    workspaceId: process.env.HUB_WORKSPACE_ID || null,
    projectId: process.env.HUB_PROJECT_ID || null,
    tenantId: process.env.HUB_TENANT_ID?.trim() || null,
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
      case "--workspace-id":
        options.workspaceId = args[++i];
        break;
      case "--project-id":
        options.projectId = args[++i];
        break;
      case "--env":
        options.env = args[++i];
        break;
      case "--tenant-id":
        options.tenantId = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(`
MCP Hub STDIO Server

Usage: npx mcp-hub-stdio [options]

Options:
  --api-key <key>      API key for authentication (env: HUB_API_KEY)
  --scope <scope>      Default scope: read|write|admin (env: HUB_SCOPE)
  --workspace-id <id>  Workspace for tool execution (env: HUB_WORKSPACE_ID)
  --project-id <id>    Default project ID (env: HUB_PROJECT_ID)
  --env <env>          Default environment (env: HUB_ENV)
  --help, -h           Show this help

Examples:
  npx mcp-hub-stdio --api-key secret123 --scope write
  npx mcp-hub-stdio --workspace-id ws-123 --project-id myproj
  HUB_WORKSPACE_ID=ws-1 HUB_PROJECT_ID=proj-1 npx mcp-hub-stdio
`);
        process.exit(0);
        break;
    }
  }

  return options;
}

function normalizeHubScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  return [
    ...new Set(
      scopes
        .map((s) => (String(s).toLowerCase() === "danger" ? "admin" : String(s).toLowerCase()))
        .filter((s) => s === "read" || s === "write" || s === "admin")
    ),
  ];
}

async function applyStdioSessionAuth(options) {
  const { validateBearerToken, isAuthEnabled } = await import("../src/core/auth.js");
  const { getSecurityRuntime } = await import("../src/core/security/resolve-runtime-security.js");
  const { setStdioSessionContext } = await import("../src/core/authorization/stdio-session-context.js");

  const workspaceId = options.workspaceId || process.env.HUB_WORKSPACE_ID || null;
  const projectId = options.projectId || process.env.HUB_PROJECT_ID || null;
  const envVal = options.env || process.env.HUB_ENV || null;
  const tenantId = options.tenantId || process.env.HUB_TENANT_ID?.trim() || null;

  const baseInfo = {
    workspaceId,
    projectId,
    env: envVal,
    tenantId,
  };

   if (!isAuthEnabled()) {
    const rt = getSecurityRuntime();
    if (!rt.allowOpenPrincipal) {
      setStdioSessionContext({
        authInfo: {
          ...baseInfo,
          user: null,
          scopes: [],
          type: null,
          actor: null,
        },
        correlationId: null,
      });
      return;
    }
    setStdioSessionContext({
      authInfo: {
        ...baseInfo,
        user: null,
        scopes: ["read", "write", "admin"],
        type: "open_hub",
        actor: { type: "open_hub", scopes: ["read", "write", "admin"] },
      },
      correlationId: null,
    });
    return;
  }

  if (!options.apiKey) {
    setStdioSessionContext({
      authInfo: {
        ...baseInfo,
        user: null,
        scopes: [],
        type: null,
        actor: null,
      },
      correlationId: null,
    });
    return;
  }

  const v = await validateBearerToken(options.apiKey);
  if (!v.valid) {
    setStdioSessionContext({
      authInfo: {
        ...baseInfo,
        user: null,
        scopes: [],
        type: null,
        actor: null,
      },
      correlationId: null,
    });
    return;
  }

  const normScopes = normalizeHubScopes(v.scopes || []);
  setStdioSessionContext({
    authInfo: {
      ...baseInfo,
      user: v.claims?.sub || "authenticated",
      scopes: normScopes,
      type: v.type,
      actor: {
        type: v.type || "api_key",
        scopes: normScopes,
        ...(v.claims?.sub ? { subject: v.claims.sub } : {}),
      },
    },
    correlationId: null,
  });
}

async function main() {
  const options = parseArgs();

   const [{ createMcpServer }, { StdioServerTransport }, { loadPlugins }, { initializeToolHooks }] = await Promise.all([
     import("../src/mcp/gateway.js"),
     import("@modelcontextprotocol/sdk/server/stdio.js"),
     import("../src/core/plugins.js"),
     import("../src/core/tool-registry.js"),
   ]);

  const { default: express } = await import("express");

  // Validate API key if auth is enabled
  if (process.env.HUB_AUTH_ENABLED === "true" && !options.apiKey) {
    console.error("Error: API key required. Provide --api-key or set HUB_API_KEY");
    process.exit(1);
  }

  // Set context for the session (gateway reads these for STDIO workspace propagation)
  process.env.HUB_SCOPE = options.scope;
  if (options.workspaceId) process.env.HUB_WORKSPACE_ID = options.workspaceId;
  if (options.projectId) process.env.HUB_PROJECT_ID = options.projectId;
  if (options.env) process.env.HUB_ENV = options.env;
  if (options.tenantId) process.env.HUB_TENANT_ID = options.tenantId;

  // Load plugins before starting MCP server
  console.error("[mcp-hub-stdio] Loading plugins...");
  initializeToolHooks();
  const app = express();
  await loadPlugins(app);
  console.error("[mcp-hub-stdio] Plugins loaded");

  await applyStdioSessionAuth(options);

  // Create and start MCP server with STDIO transport
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  console.error("[mcp-hub-stdio] Starting MCP Hub STDIO server...");
  console.error(`[mcp-hub-stdio] Scope: ${options.scope}`);
  if (options.workspaceId) console.error(`[mcp-hub-stdio] Workspace: ${options.workspaceId}`);
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
