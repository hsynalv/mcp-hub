/**
 * Central principal / scope resolution for tools, MCP, and discovery.
 */

import { getSecurityRuntime } from "../security/resolve-runtime-security.js";

const SCOPE_RANK = { read: 0, write: 1, admin: 2 };

function normalizeScope(s) {
  if (s === "danger") return "admin";
  return typeof s === "string" ? s.toLowerCase() : "";
}

/**
 * Effective scopes for tool authorization and visibility.
 * Open hub (no API keys): full scopes. Otherwise from actor / context arrays.
 * @param {object} context
 * @returns {string[]}
 */
export function resolvePrincipalScopes(context = {}) {
  const rt = getSecurityRuntime();

  const fromActor = context.actor?.scopes;
  if (Array.isArray(fromActor) && fromActor.length > 0) {
    return uniqueScopes(fromActor);
  }
  if (Array.isArray(context.scopes) && context.scopes.length > 0) {
    return uniqueScopes(context.scopes);
  }
  if (Array.isArray(context.authScopes) && context.authScopes.length > 0) {
    return uniqueScopes(context.authScopes);
  }

  if (rt.allowOpenPrincipal) {
    return ["read", "write", "admin"];
  }

  return [];
}

function uniqueScopes(arr) {
  const out = new Set();
  for (const s of arr) {
    const n = normalizeScope(s);
    if (n === "read" || n === "write" || n === "admin") out.add(n);
  }
  return [...out];
}

/**
 * Max scope rank from list (read=0, write=1, admin=2).
 * @param {string[]} scopes
 * @returns {number}
 */
export function maxScopeRank(scopes) {
  let m = -1;
  for (const s of scopes) {
    const n = normalizeScope(s);
    const r = SCOPE_RANK[n];
    if (r !== undefined && r > m) m = r;
  }
  return m;
}

/**
 * Human-readable actor id for policy logging.
 * @param {object} context
 * @returns {string}
 */
export function resolveRequestedBy(context = {}) {
  if (context.user && typeof context.user === "string") return context.user;
  if (context.actor?.type === "api_key") {
    return `key:${(context.actor.scopes || []).join(",") || "read"}`;
  }
  if (context.actor?.type === "oauth" && context.actor?.subject) {
    return `oauth:${context.actor.subject}`;
  }
  if (context.actor?.type === "ui_token") return "ui_token";
  if (context.actor?.type === "open_hub") return "open_hub";
  return "anonymous";
}
