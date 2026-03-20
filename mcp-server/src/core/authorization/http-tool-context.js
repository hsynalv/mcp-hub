/**
 * Build callTool context from an Express request (matches MCP principal fields).
 */

/**
 * @param {import("express").Request} req
 * @param {Record<string, unknown>} [extra]
 * @returns {object}
 */
export function toolContextFromRequest(req, extra = {}) {
  if (!req || typeof req !== "object") {
    return { source: "rest", ...extra };
  }
  return {
    method: req.method,
    requestId: req.requestId,
    correlationId: req.correlationId ?? req.requestId,
    user: req.user ?? null,
    projectId: req.projectId,
    workspaceId: req.workspaceId,
    tenantId: req.tenantId ?? null,
    env: req.projectEnv,
    actor: req.actor ?? null,
    authScopes: req.authScopes ?? [],
    scopes: req.authScopes ?? [],
    source: "rest",
    ...extra,
  };
}
