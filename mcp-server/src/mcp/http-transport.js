/**
 * MCP HTTP Transport
 *
 * Express middleware for MCP Streamable HTTP endpoint.
 * Handles GET/POST /mcp requests.
 * Propagates workspace context (x-workspace-id, x-project-id) to tool handlers.
 */

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./gateway.js";
import { resolveHubPrincipalFromRequest } from "../core/security/resolve-principal.js";
import { runWithMcpRequestContext } from "../core/authorization/mcp-request-context.js";
import { emitHttpDenyHubEvent } from "../core/audit/emit-http-events.js";

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

/**
 * Create Express middleware for MCP HTTP endpoint
 * @returns {Function} Express middleware
 */
export function createMcpHttpMiddleware() {
  let initPromise = null;

  const ensureInit = async () => {
    if (!initPromise) {
      initPromise = (async () => {
        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const pending = new Map();
        clientTransport.onmessage = (message) => {
          const id = message?.id;
          if (id !== undefined && pending.has(id)) {
            const { resolve } = pending.get(id);
            pending.delete(id);
            resolve(message);
          }
        };
        return { server, clientTransport, pending };
      })();
    }
    return initPromise;
  };

  return async (req, res, next) => {
    // Only handle /mcp path
    if (req.path !== "/mcp") {
      return next();
    }

    // Security: Check origin for DNS rebinding protection
    const origin = req.headers.origin;
    if (origin && !isValidOrigin(origin)) {
      void emitHttpDenyHubEvent(req, {
        source: "mcp_http_transport",
        statusCode: 403,
        errorCode: "invalid_origin",
        hubTransport: "mcp_http",
      }).catch(() => {});
      return res.status(403).json({
        ok: false,
        error: {
          code: "invalid_origin",
          message: "Origin not allowed",
        },
        meta: { requestId: req.requestId ?? null },
      });
    }

    let principal;
    if (req.securityContext?.authenticated) {
      principal = {
        authenticated: true,
        scopes: req.securityContext.scopes,
        actor: req.securityContext.actor,
        user: req.securityContext.user,
        authType: req.securityContext.authType,
      };
    } else {
      principal = await resolveHubPrincipalFromRequest(req);
    }

    if (!principal.authenticated) {
      if (principal.reason === "invalid_token") {
        void emitHttpDenyHubEvent(req, {
          source: "mcp_http_transport",
          statusCode: 401,
          errorCode: "invalid_token",
          hubTransport: "mcp_http",
        }).catch(() => {});
        return res.status(401).json({
          ok: false,
          error: {
            code: "invalid_token",
            message: "Invalid or expired token.",
          },
          meta: { requestId: req.requestId ?? null },
        });
      }
      void emitHttpDenyHubEvent(req, {
        source: "mcp_http_transport",
        statusCode: 401,
        errorCode: "unauthorized",
        hubTransport: "mcp_http",
      }).catch(() => {});
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message: "Authorization required. Use: Authorization: Bearer <HUB_API_KEY>",
        },
        meta: { requestId: req.requestId ?? null },
      });
    }

    const authContext = {
      user: principal.user,
      scopes: principal.scopes,
      type: principal.authType,
      actor: principal.actor,
    };

    try {
      // Handle GET request (SSE stream setup - simplified)
      if (req.method === "GET") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Send initial session info
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 0, result: { sessionId: req.requestId } })}\n\n`);

        // Keep connection alive for SSE
        const keepAlive = setInterval(() => {
          res.write(`: ping\n\n`);
        }, 30000);

        req.on("close", () => {
          clearInterval(keepAlive);
        });

        return;
      }

      // Handle POST request (JSON-RPC messages)
      if (req.method === "POST") {
        const message = req.body;

        if (!message || typeof message !== "object") {
          return res.status(400).json({
            ok: false,
            error: {
              code: "invalid_request",
              message: "Invalid JSON-RPC message",
            },
          });
        }

        if (message.jsonrpc !== "2.0") {
          return res.status(200).json({
            jsonrpc: "2.0",
            id: message.id ?? null,
            error: { code: -32600, message: "Invalid Request" },
          });
        }

        // Prefer workspaceContextMiddleware; fall back to headers (e.g. minimal Express apps / tests)
        const workspaceId =
          req.workspaceId ?? req.headers["x-workspace-id"]?.toString().trim() ?? null;
        const projectId =
          req.projectId ?? req.headers["x-project-id"]?.toString().trim() ?? null;
        const tenantId = req.headers["x-tenant-id"]?.toString().trim() || undefined;

        const authInfo = {
          user: authContext.user,
          scopes: authContext.scopes,
          type: authContext.type,
          actor: authContext.actor,
          workspaceId,
          projectId,
          env: req.projectEnv,
          tenantId,
        };

        const { clientTransport, pending } = await ensureInit();

        const id = message?.id;
        const isNotification = id === undefined && message?.method;

        const storePayload = { authInfo, correlationId: req.requestId ?? null };

        if (isNotification) {
          await runWithMcpRequestContext(storePayload, () =>
            clientTransport.send(message, { authInfo })
          );
          return res.status(202).json(null);
        }

        const result = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error("Request timed out"));
            }
          }, 120000);
          pending.set(id, {
            resolve: (msg) => {
              clearTimeout(timeout);
              resolve(msg);
            },
          });
          runWithMcpRequestContext(storePayload, () =>
            clientTransport.send(message, { authInfo })
          ).catch(reject);
        });

        return res.json(result);
      }

      // Method not allowed
      return res.status(405).json({
        ok: false,
        error: {
          code: "method_not_allowed",
          message: "Only GET and POST methods are supported",
        },
      });
    } catch (err) {
      console.error("[mcp-http] error:", err);
      return res.status(500).json({
        ok: false,
        error: {
          code: "internal_error",
          message: err.message || "Internal server error",
        },
      });
    }
  };
}

/**
 * Validate origin for security
 * @param {string} origin
 * @returns {boolean}
 */
function isValidOrigin(origin) {
  // Allow localhost and common development origins
  const allowedOrigins = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^https:\/\/localhost:\d+$/,
    /^https:\/\/127\.0\.0\.1:\d+$/,
  ];

  // In production, configure via env var
  const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(",") || [];
  if (configuredOrigins.length > 0) {
    return configuredOrigins.some((allowed) => origin === allowed);
  }

  return allowedOrigins.some((pattern) => pattern.test(origin));
}
