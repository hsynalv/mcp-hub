#!/usr/bin/env node
/**
 * MCP Hub STDIO Entrypoint
 *
 * CLI entrypoint for MCP STDIO transport.
 * Usage: npx mcp-hub-stdio [options]
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";

// Cursor/STDIO expects ONLY JSON-RPC frames on stdout.
console.log = (...args) => process.stderr.write(args.join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");

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
    apiKey: process.env.HUB_API_KEY?.trim() || null,
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
        options.apiKey = args[++i]?.trim() || null;
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
  --api-key <key>      Credential (API key / Bearer secret; env: HUB_API_KEY)
  --scope <scope>      Minimum scope required for this session: read|write|admin (env: HUB_SCOPE). Must be satisfied by the credential (same idea as HTTP requireScope).
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

async function main() {
  const options = parseArgs();

  const { validateSecurityConfigOrExit } = await import("../src/core/security/validate-security-config.js");
  validateSecurityConfigOrExit();

  const [{ createMcpServer }, { StdioServerTransport }, { loadPlugins }, { initializeToolHooks }, { bootstrapStdioAuthContext }, { emitStdioBootstrapAuthDenied }] = await Promise.all([
    import("../src/mcp/gateway.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("../src/core/plugins.js"),
    import("../src/core/tool-registry.js"),
    import("../src/core/security/stdio-session-bootstrap.js"),
    import("../src/core/audit/emit-stdio-auth.js"),
  ]);

  const { default: express } = await import("express");

  if (options.workspaceId) process.env.HUB_WORKSPACE_ID = options.workspaceId;
  if (options.projectId) process.env.HUB_PROJECT_ID = options.projectId;
  if (options.env) process.env.HUB_ENV = options.env;
  if (options.tenantId) process.env.HUB_TENANT_ID = options.tenantId;

  console.error("[mcp-hub-stdio] Loading plugins...");
  initializeToolHooks();
  const app = express();
  await loadPlugins(app);
  console.error("[mcp-hub-stdio] Plugins loaded");

  const sessionId = randomUUID();

  const workspaceId = options.workspaceId || process.env.HUB_WORKSPACE_ID || null;
  const projectId = options.projectId || process.env.HUB_PROJECT_ID || null;

  const authOutcome = await bootstrapStdioAuthContext({
    apiKey: options.apiKey,
    scope: options.scope,
    workspaceId,
    projectId,
    env: options.env || process.env.HUB_ENV || null,
    tenantId: options.tenantId || process.env.HUB_TENANT_ID?.trim() || null,
    sessionId,
  });

  const wsAudit = workspaceId != null && String(workspaceId).length > 0 ? String(workspaceId) : "global";

  if (!authOutcome.ok) {
    await emitStdioBootstrapAuthDenied({
      sessionId,
      reason: authOutcome.reason,
      errorCode: authOutcome.errorCode,
      workspaceId: wsAudit,
      projectId,
      requiredScope: authOutcome.requiredScope,
    }).catch(() => {});

    if (authOutcome.errorCode === "invalid_token") {
      console.error("[mcp-hub-stdio] Error: invalid API key or token (--api-key / HUB_API_KEY)");
    } else if (authOutcome.errorCode === "insufficient_scope") {
      console.error(
        `[mcp-hub-stdio] Error: credential does not satisfy required scope '${authOutcome.requiredScope}'. Use a key with sufficient privileges or lower --scope / HUB_SCOPE.`
      );
    } else {
      console.error(
        "[mcp-hub-stdio] Error: authentication required. Provide --api-key / HUB_API_KEY, or enable local open-hub only where appropriate (non-production)."
      );
    }
    process.exit(1);
  }

  process.env.HUB_SCOPE = options.scope;

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  console.error("[mcp-hub-stdio] Starting MCP Hub STDIO server...");
  console.error(`[mcp-hub-stdio] Required scope: ${options.scope}`);
  if (options.workspaceId) console.error(`[mcp-hub-stdio] Workspace: ${options.workspaceId}`);
  if (options.projectId) console.error(`[mcp-hub-stdio] Project: ${options.projectId}`);
  console.error(`[mcp-hub-stdio] Environment: ${options.env}`);

  await server.connect(transport);

  console.error("[mcp-hub-stdio] MCP server connected via STDIO");

  const sessionStartedAt = Date.now();
  try {
    const { emitHubAuditEvent } = await import("../src/core/audit/emit-hub-event.js");
    const { HubEventTypes, HubOutcomes } = await import("../src/core/audit/event-types.js");
    const { resolveActorString } = await import("../src/core/audit/base-envelope.js");
    const { getStdioSessionContext } = await import("../src/core/authorization/stdio-session-context.js");
    const sc = getStdioSessionContext();
    await emitHubAuditEvent({
      eventType: HubEventTypes.STDIO_SESSION_STARTED,
      outcome: HubOutcomes.SUCCESS,
      plugin: "core",
      actor: sc?.authInfo ? resolveActorString(sc.authInfo.actor ?? sc.authInfo.user) : "anonymous",
      workspaceId: process.env.HUB_WORKSPACE_ID ?? "global",
      projectId: process.env.HUB_PROJECT_ID ?? null,
      correlationId: `stdio-session-${sessionId}`,
      durationMs: 0,
      allowed: true,
      success: true,
      toolContext: {
        workspaceId: process.env.HUB_WORKSPACE_ID ?? null,
        sessionId,
        source: "mcp",
        method: "MCP",
        correlationId: `stdio-session-${sessionId}`,
      },
      metadata: {
        hubSessionId: sessionId,
        hubTransport: "stdio",
      },
    });
  } catch {
    /* optional telemetry */
  }

  async function shutdownTelemetry() {
    try {
      const { emitHubAuditEvent } = await import("../src/core/audit/emit-hub-event.js");
      const { HubEventTypes, HubOutcomes } = await import("../src/core/audit/event-types.js");
      const { resolveActorString } = await import("../src/core/audit/base-envelope.js");
      const { getStdioSessionContext } = await import("../src/core/authorization/stdio-session-context.js");
      const sc = getStdioSessionContext();
      await emitHubAuditEvent({
        eventType: HubEventTypes.STDIO_SESSION_ENDED,
        outcome: HubOutcomes.SUCCESS,
        plugin: "core",
        actor: sc?.authInfo ? resolveActorString(sc.authInfo.actor ?? sc.authInfo.user) : "anonymous",
        workspaceId: process.env.HUB_WORKSPACE_ID ?? "global",
        projectId: process.env.HUB_PROJECT_ID ?? null,
        correlationId: `stdio-session-${sessionId}`,
        durationMs: Math.max(0, Date.now() - sessionStartedAt),
        allowed: true,
        success: true,
        toolContext: {
          workspaceId: process.env.HUB_WORKSPACE_ID ?? null,
          sessionId,
          source: "mcp",
          method: "MCP",
          correlationId: `stdio-session-${sessionId}`,
        },
        metadata: {
          hubSessionId: sessionId,
          hubTransport: "stdio",
        },
      });
    } catch {
      /* optional */
    }
  }

  process.on("SIGINT", async () => {
    console.error("\n[mcp-hub-stdio] Shutting down...");
    await shutdownTelemetry();
    await transport.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("\n[mcp-hub-stdio] Shutting down...");
    await shutdownTelemetry();
    await transport.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[mcp-hub-stdio] Fatal error:", err);
  process.exit(1);
});
