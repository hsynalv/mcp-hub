/**
 * Global Express middleware: unified authentication for every non-public request.
 */

import { resolveHubPrincipalFromRequest } from "./resolve-principal.js";
import { getSecurityRuntime } from "./resolve-runtime-security.js";
import { emitHttpDenyHubEvent } from "../audit/emit-http-events.js";
import { isPublicSecurityPath } from "./public-http-paths.js";

export { isPublicSecurityPath } from "./public-http-paths.js";

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
        void emitHttpDenyHubEvent(req, {
          source: "enforce_security_context",
          statusCode: 401,
          errorCode: "invalid_token",
        }).catch(() => {});
        return res.status(401).json(envelope401(req, "invalid_token", "Invalid or expired token."));
      }
      void emitHttpDenyHubEvent(req, {
        source: "enforce_security_context",
        statusCode: 401,
        errorCode: "unauthorized",
      }).catch(() => {});
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
