/**
 * Authentication & RBAC middleware.
 *
 * Keys and scopes (set via .env):
 *   HUB_READ_KEY   → scopes: ["read"]
 *   HUB_WRITE_KEY  → scopes: ["read", "write"]
 *   HUB_ADMIN_KEY  → scopes: ["read", "write", "admin"]
 *
 * Usage:
 *   import { requireScope } from "./auth.js";
 *   router.post("/apply", requireScope("write"), handler);
 *
 * Enforced credentials and scope checks run after enforceSecurityContext (unified principal).
 * Local anonymous access only when HUB_ALLOW_OPEN_HUB=true and no hub keys are configured.
 */

import { getSecurityRuntime, hubKeysConfigured } from "./security/resolve-runtime-security.js";
import { emitHttpDenyHubEvent } from "./audit/emit-http-events.js";

const SCOPE_HIERARCHY = ["read", "write", "admin"];

function normalizeScope(scope) {
  if (scope === "danger") return "admin";
  return scope;
}

function getKeyMap() {
  const map = new Map();
  const readKey  = process.env.HUB_READ_KEY?.trim();
  const writeKey = process.env.HUB_WRITE_KEY?.trim();
  const adminKey = process.env.HUB_ADMIN_KEY?.trim();

  if (readKey)  map.set(readKey,  ["read"]);
  if (writeKey) map.set(writeKey, ["read", "write"]);
  if (adminKey) map.set(adminKey, ["read", "write", "admin"]);

  return map;
}

function hasVerifierInfrastructure() {
  return (
    hubKeysConfigured() || !!process.env.OAUTH_INTROSPECTION_ENDPOINT?.trim()
  );
}

function extractKey(req) {
  const auth = req.headers["authorization"] ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // Also accept x-hub-api-key header as fallback
  return req.headers["x-hub-api-key"]?.trim() ?? null;
}

/**
 * Scope gate — relies on {@link ../security/enforce-security-context.js enforceSecurityContext}
 * having attached req.securityContext / req.authScopes / req.actor.
 *
 * requireScope("read")   — any valid key
 * requireScope("write")  — write or admin key
 * requireScope("danger") — admin key only
 */
export function requireScope(scope = "read") {
  return (req, res, next) => {
    if (!req.securityContext?.authenticated) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message:
            "Security context missing. Ensure enforceSecurityContext runs before protected routes.",
        },
        meta: { requestId: req.requestId ?? null },
      });
    }

    const requiredScope = normalizeScope(scope);

    const scopes = req.securityContext.scopes || req.authScopes || [];
    const requiredIndex = SCOPE_HIERARCHY.indexOf(requiredScope);
    const hasScope = scopes.some(
      (s) => SCOPE_HIERARCHY.indexOf(normalizeScope(s)) >= requiredIndex
    );

    if (!hasScope) {
      void emitHttpDenyHubEvent(req, {
        source: "require_scope",
        statusCode: 403,
        errorCode: "forbidden",
        requiredScope: scope,
      }).catch(() => {});
      return res.status(403).json({
        ok: false,
        error: {
          code: "forbidden",
          message: `This endpoint requires '${scope}' scope. Your credentials do not have sufficient permissions.`,
        },
        meta: { requestId: req.requestId ?? null },
      });
    }

    next();
  };
}

/**
 * Whether the hub is configured to verify credentials (health / diagnostics).
 * Production is fail-closed via credentialRequired unless HUB_AUTH_ENABLED=false (blocked at startup).
 */
export function isAuthEnabled() {
  const rt = getSecurityRuntime();
  if (process.env.HUB_AUTH_ENABLED === "false" && !rt.isProduction) {
    return false;
  }
  return rt.credentialRequired || hasVerifierInfrastructure();
}

// ── OAuth 2.1 Bearer Token Support ───────────────────────────────────────────

/**
 * OAuth 2.1 Token Introspection (RFC 7662)
 * Validates a Bearer token against an authorization server.
 *
 * Environment variables:
 *   OAUTH_INTROSPECTION_ENDPOINT - Token introspection URL
 *   OAUTH_INTROSPECTION_AUTH     - Basic auth credentials (optional)
 *
 * @param {string} token - The Bearer token to validate
 * @returns {Promise<Object|null>} Token claims or null if invalid
 */
export async function introspectOAuthToken(token) {
  const endpoint = process.env.OAUTH_INTROSPECTION_ENDPOINT;
  if (!endpoint) {
    return null;
  }

  try {
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Add Basic auth if configured
    const auth = process.env.OAUTH_INTROSPECTION_AUTH;
    if (auth) {
      headers["Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: new URLSearchParams({ token }),
    });

    if (!response.ok) {
      console.error(`[auth] Token introspection failed: ${response.status}`);
      return null;
    }

    const claims = await response.json();

    // RFC 7662: active=true means token is valid
    if (!claims.active) {
      return null;
    }

    return claims;
  } catch (err) {
    console.error("[auth] Token introspection error:", err.message);
    return null;
  }
}

/**
 * Validate a Bearer token (API key or OAuth 2.1)
 * @param {string} token
 * @returns {Promise<{valid: boolean, scopes?: string[], claims?: Object}>}
 */
export async function validateBearerToken(token) {
  // First check if it's a configured API key
  const keyMap = getKeyMap();
  const apiKeyScopes = keyMap.get(token);
  if (apiKeyScopes) {
    return { valid: true, scopes: apiKeyScopes, type: "api_key" };
  }

  // Try OAuth 2.1 introspection
  const claims = await introspectOAuthToken(token);
  if (claims) {
    // Extract scopes from claims (space-separated per RFC 6749)
    const scopes = claims.scope?.split(" ") || [];
    return { valid: true, scopes, claims, type: "oauth" };
  }

  return { valid: false };
}

/**
 * Middleware for OAuth 2.1 Bearer token validation
 * Usage: app.use('/mcp', requireOAuthScope('read'))
 *
 * @param {string} scope - Required scope
 * @returns {Function} Express middleware
 */
export function requireOAuthScope(scope = "read") {
  return async (req, res, next) => {
    if (!hasVerifierInfrastructure()) {
      return next();
    }

    const token = extractKey(req);
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message: "Authorization header required. Use: Authorization: Bearer <token>",
        },
      });
    }

    const validation = await validateBearerToken(token);
    if (!validation.valid) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "invalid_token",
          message: "Invalid or expired token.",
        },
      });
    }

    // Check scope
    const requiredScope = normalizeScope(scope);
    const requiredIndex = SCOPE_HIERARCHY.indexOf(requiredScope);
    const hasScope = validation.scopes.some(
      (s) => SCOPE_HIERARCHY.indexOf(normalizeScope(s)) >= requiredIndex
    );

    if (!hasScope) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "insufficient_scope",
          message: `This endpoint requires '${scope}' scope. Token has: ${validation.scopes.join(", ")}`,
        },
      });
    }

    // Attach auth info to request
    req.authScopes = validation.scopes.map(normalizeScope);
    req.actor = {
      type: validation.type,
      scopes: req.authScopes,
      ...(validation.claims?.sub ? { subject: validation.claims.sub } : {}),
    };

    next();
  };
}
