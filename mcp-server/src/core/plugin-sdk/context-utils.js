/**
 * Plugin SDK - Request Context Utilities
 *
 * Extract consistent context from Express requests.
 */

/**
 * Extract standard context from an Express request.
 * @param {import("express").Request} req
 * @returns {Object} Context with actor, workspaceId, projectId
 */
export function extractRequestContext(req) {
  return {
    actor: req.user?.id || req.user?.email || req.headers?.["x-user-id"] || "anonymous",
    workspaceId: req.headers?.["x-workspace-id"] || req.workspaceId || "global",
    projectId: req.headers?.["x-project-id"] || req.projectId || null,
    correlationId: req.correlationId || req.headers?.["x-correlation-id"] || null,
  };
}
