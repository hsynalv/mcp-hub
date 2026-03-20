/**
 * Unified hub principal resolution for REST, MCP HTTP, and any Express request.
 */

import { validateBearerToken } from "../auth.js";
import { validateUiToken } from "../ui-tokens.js";
import { getSecurityRuntime } from "./resolve-runtime-security.js";

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

function extractCredential(req) {
  if (!req?.headers) return null;
  const auth = req.headers.authorization ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers["x-hub-api-key"]?.trim?.() ?? null;
}

/**
 * @typedef {object} ResolvedHubPrincipal
 * @property {boolean} authenticated
 * @property {string[]} scopes
 * @property {object|null} actor
 * @property {string|null} user
 * @property {string|null} authType
 * @property {"unauthorized"|"invalid_token"|undefined} [reason]
 */

/**
 * STDIO / CLI: same resolution as HTTP Bearer without an Express request.
 * @param {string|null|undefined} apiKey - raw key or Bearer-equivalent secret (never logged)
 * @returns {Promise<ResolvedHubPrincipal>}
 */
export async function resolveHubPrincipalFromStdioToken(apiKey) {
  const req = { headers: {} };
  const t = typeof apiKey === "string" ? apiKey.trim() : "";
  if (t.length > 0) {
    req.headers.authorization = `Bearer ${t}`;
  }
  return resolveHubPrincipalFromRequest(req);
}

/**
 * @param {import("express").Request} req
 * @returns {Promise<ResolvedHubPrincipal>}
 */
export async function resolveHubPrincipalFromRequest(req) {
  const rt = getSecurityRuntime();
  const token = extractCredential(req);

  if (token) {
    const ui = validateUiToken(token);
    if (ui.ok) {
      const scopes = ["read", "write", "admin"];
      return {
        authenticated: true,
        scopes,
        actor: { type: "ui_token", scopes },
        user: "ui_token",
        authType: "ui_token",
      };
    }

    const v = await validateBearerToken(token);
    if (v.valid) {
      const scopes = normalizeHubScopes(v.scopes || []);
      return {
        authenticated: true,
        scopes,
        actor: {
          type: v.type || "api_key",
          scopes,
          ...(v.claims?.sub ? { subject: v.claims.sub } : {}),
        },
        user: v.claims?.sub || "authenticated",
        authType: v.type || "api_key",
      };
    }

    return {
      authenticated: false,
      reason: "invalid_token",
      scopes: [],
      actor: null,
      user: null,
      authType: null,
    };
  }

  if (rt.allowOpenPrincipal) {
    const scopes = ["read", "write", "admin"];
    return {
      authenticated: true,
      scopes,
      actor: { type: "open_hub", scopes },
      user: null,
      authType: "open_hub",
    };
  }

  return {
    authenticated: false,
    reason: "unauthorized",
    scopes: [],
    actor: null,
    user: null,
    authType: null,
  };
}
