/**
 * Global Express middleware: unified authentication for every non-public request.
 */

import { resolveHubPrincipalFromRequest } from "./resolve-principal.js";
import { getSecurityRuntime } from "./resolve-runtime-security.js";

/**
 * Paths that skip principal resolution (health, static UI, CORS preflight).
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function isPublicSecurityPath(req) {
  if (req.method === "OPTIONS") return true;
  const p = req.path || "";

  if (p === "/health") return true;

  if (req.method === "GET" && (p === "/" || p.startsWith("/landing/"))) return true;

  if (
    req.method === "GET" &&
    (p === "/ui" || p === "/ui/" || p.startsWith("/ui/"))
  ) {
    return true;
  }

  if (
    req.method === "GET" &&
    (p === "/admin" || p === "/admin/" || p.startsWith("/admin/"))
  ) {
    return true;
  }

  if (req.method === "POST" && p === "/ui/token") return true;

  return false;
}

function envelope401(req, code, message) {
  return {
    ok: false,
    error: { code, message },
    meta: { requestId: req.requestId ?? req.correlationId ?? null },
  };
}

/**
 * Attaches req.securityContext, req.authScopes, req.actor, req.user when authenticated.
 */
export async function enforceSecurityContext(req, res, next) {
  if (isPublicSecurityPath(req)) {
    return next();
  }

  try {
    const principal = await resolveHubPrincipalFromRequest(req);
    const rt = getSecurityRuntime();

    if (!principal.authenticated) {
      if (principal.reason === "invalid_token") {
        return res.status(401).json(envelope401(req, "invalid_token", "Invalid or expired token."));
      }
      return res
        .status(401)
        .json(
          envelope401(
            req,
            "unauthorized",
            "Authorization required. Use: Authorization: Bearer <HUB_API_KEY>"
          )
        );
    }

    req.securityContext = {
      authenticated: true,
      scopes: principal.scopes,
      actor: principal.actor,
      user: principal.user,
      authType: principal.authType,
      runtime: rt,
    };
    req.authScopes = principal.scopes;
    req.actor = principal.actor;
    if (principal.user) {
      req.user = principal.user;
    }

    return next();
  } catch (err) {
    return next(err);
  }
}
