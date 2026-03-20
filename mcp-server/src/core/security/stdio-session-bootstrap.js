/**
 * STDIO entry: align principal + scope with HTTP ({@link ./resolve-principal.js} + requireScope semantics).
 */

import { resolveHubPrincipalFromStdioToken } from "./resolve-principal.js";
import { setStdioSessionContext } from "../authorization/stdio-session-context.js";

const SCOPE_HIERARCHY = ["read", "write", "admin"];

function normalizeScope(scope) {
  if (scope === "danger") return "admin";
  return String(scope || "read").toLowerCase();
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

/**
 * @param {object} p
 * @param {string|null|undefined} p.apiKey
 * @param {string} [p.scope] - minimum required scope (read|write|admin), like HTTP requireScope
 * @param {string|null|undefined} p.workspaceId
 * @param {string|null|undefined} p.projectId
 * @param {string|null|undefined} p.env
 * @param {string|null|undefined} p.tenantId
 * @param {string} p.sessionId
 * @returns {Promise<{ ok: true, correlationId: string } | { ok: false, reason: string, errorCode: string, correlationId: string, requiredScope?: string }>}
 */
export async function bootstrapStdioAuthContext(p) {
  const {
    apiKey,
    scope = "read",
    workspaceId = null,
    projectId = null,
    env: envVal = null,
    tenantId = null,
    sessionId,
  } = p;

  const correlationId = `stdio-session-${sessionId}`;
  const baseInfo = {
    workspaceId,
    projectId,
    env: envVal,
    tenantId,
  };

  const principal = await resolveHubPrincipalFromStdioToken(apiKey);

  if (!principal.authenticated) {
    const code = principal.reason === "invalid_token" ? "invalid_token" : "unauthorized";
    return {
      ok: false,
      reason:
        code === "invalid_token"
          ? "invalid_token"
          : "credential_required",
      errorCode: code,
      correlationId,
    };
  }

  const requiredScope = normalizeScope(scope);
  const requiredIndex = SCOPE_HIERARCHY.indexOf(requiredScope);
  const scopes = principal.scopes || [];
  const hasScope = scopes.some(
    (s) => SCOPE_HIERARCHY.indexOf(normalizeScope(s)) >= requiredIndex
  );

  if (!hasScope) {
    return {
      ok: false,
      reason: "insufficient_scope",
      errorCode: "insufficient_scope",
      correlationId,
      requiredScope,
    };
  }

  const normScopes = normalizeHubScopes(scopes);

  setStdioSessionContext({
    authInfo: {
      ...baseInfo,
      user: principal.user,
      scopes: normScopes,
      type: principal.authType,
      actor: principal.actor,
    },
    correlationId,
    sessionId,
  });

  return { ok: true, correlationId };
}
