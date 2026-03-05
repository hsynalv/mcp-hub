/**
 * MCP HTTP Transport
 *
 * Express middleware for MCP Streamable HTTP endpoint.
 * Handles GET/POST /mcp requests.
 */

import { createMcpServer } from "./gateway.js";
import { validateBearerToken } from "../core/auth.js";

/**
 * Create Express middleware for MCP HTTP endpoint
 * @returns {Function} Express middleware
 */
export function createMcpHttpMiddleware() {
  const server = createMcpServer();

  return async (req, res, next) => {
    // Only handle /mcp path
    if (req.path !== "/mcp") {
      return next();
    }

    // Security: Check origin for DNS rebinding protection
    const origin = req.headers.origin;
    if (origin && !isValidOrigin(origin)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "invalid_origin",
          message: "Origin not allowed",
        },
      });
    }

    // Authenticate request
    const token = extractBearerToken(req);
    let authContext = { user: null, scopes: [] };

    if (token) {
      const validation = await validateBearerToken(token);
      if (validation.valid) {
        authContext = {
          user: validation.claims?.sub || "authenticated",
          scopes: validation.scopes || [],
          type: validation.type,
        };
      } else if (process.env.HUB_AUTH_ENABLED === "true") {
        return res.status(401).json({
          ok: false,
          error: {
            code: "invalid_token",
            message: "Invalid or expired token.",
          },
        });
      }
    } else if (process.env.HUB_AUTH_ENABLED === "true") {
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message: "Authorization header required. Use: Authorization: Bearer <token>",
        },
      });
    }

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

        // Process through MCP server with auth context
        const result = await server.handleRequest(message, {
          user: authContext.user,
          scopes: authContext.scopes,
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
 * Extract Bearer token from request headers
 * @param {Object} req - Express request
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const auth = req.headers["authorization"] ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers["x-hub-api-key"]?.trim() ?? null;
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
