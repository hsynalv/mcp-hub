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
 * If no keys are configured the server runs in open mode (dev-friendly).
 */

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

function authEnabled() {
  return !!(
    process.env.HUB_READ_KEY?.trim() ||
    process.env.HUB_WRITE_KEY?.trim() ||
    process.env.HUB_ADMIN_KEY?.trim()
  );
}

function extractKey(req) {
  const auth = req.headers["authorization"] ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // Also accept x-hub-api-key header as fallback
  return req.headers["x-hub-api-key"]?.trim() ?? null;
}

/**
 * Middleware factory.
 * requireScope("read")   — any valid key
 * requireScope("write")  — write or admin key
 * requireScope("danger") — admin key only
 */
export function requireScope(scope = "read") {
  return (req, res, next) => {
    if (!authEnabled()) return next(); // open mode — no keys configured

    const requiredScope = normalizeScope(scope);

    const key = extractKey(req);
    if (!key) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message: "Authorization header required. Use: Authorization: Bearer <HUB_API_KEY>",
        },
      });
    }

    const keyMap = getKeyMap();
    const scopes = keyMap.get(key);
    if (!scopes) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "invalid_key",
          message: "Invalid API key.",
        },
      });
    }

    const requiredIndex = SCOPE_HIERARCHY.indexOf(requiredScope);
    const hasScope = scopes.some(
      (s) => SCOPE_HIERARCHY.indexOf(normalizeScope(s)) >= requiredIndex
    );

    if (!hasScope) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "forbidden",
          message: `This endpoint requires '${scope}' scope. Your key does not have sufficient permissions.`,
        },
      });
    }

    // Attach scopes to request for downstream use
    req.authScopes = scopes.map(normalizeScope);
    req.actor = {
      type: "api_key",
      scopes: req.authScopes,
    };
    next();
  };
}

/** Returns whether the server is running with auth enabled. */
export function isAuthEnabled() {
  return authEnabled();
}
