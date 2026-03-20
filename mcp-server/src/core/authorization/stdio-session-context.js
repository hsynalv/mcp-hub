/**
 * STDIO MCP: session-scoped auth/workspace when AsyncLocalStorage (HTTP) is unused.
 * Mirrored by gateway ListTools / CallTool alongside getMcpRequestContext().
 */

/** @type {{ authInfo: object, correlationId: string|null, sessionId?: string|null } | null} */
let stdioSession = null;

export function setStdioSessionContext(store) {
  stdioSession = store && typeof store === "object" ? store : null;
}

export function getStdioSessionContext() {
  return stdioSession;
}

export function clearStdioSessionContext() {
  stdioSession = null;
}

/**
 * @param {object|undefined} sessionAuth
 * @param {object|undefined} extraAuth
 * @returns {object}
 */
export function mergeMcpAuthInfo(sessionAuth, extraAuth) {
  const a = sessionAuth && typeof sessionAuth === "object" ? sessionAuth : {};
  const b = extraAuth && typeof extraAuth === "object" ? extraAuth : {};
  const scopes = Array.isArray(b.scopes) && b.scopes.length > 0 ? b.scopes : a.scopes;
  const normScopes = Array.isArray(scopes) ? scopes : [];
  const actor =
    b.actor ??
    a.actor ??
    (normScopes.length ? { type: b.type || a.type || "bearer", scopes: normScopes } : null);
  return {
    ...a,
    ...b,
    scopes: normScopes,
    actor,
  };
}
