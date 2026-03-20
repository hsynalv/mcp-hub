/**
 * Standard audit line for authorization / policy denials on tool execution (structured, searchable).
 */

import { auditLog, generateCorrelationId } from "../audit/index.js";

/**
 * @param {object} params
 * @param {string} params.phase - e.g. authorization, policy, workspace_boundary
 * @param {string} params.code
 * @param {string} params.reason
 * @param {string} [params.toolName]
 * @param {string} [params.plugin]
 * @param {string} [params.actor]
 * @param {string} [params.workspaceId]
 * @param {string} [params.correlationId]
 * @param {Record<string, unknown>} [params.metadata]
 */
export async function auditToolAuthzDenial(params) {
  const correlationId = params.correlationId || generateCorrelationId();
  try {
    await auditLog({
      plugin: params.plugin || "core",
      operation: `tool_authz_denied:${params.phase}`,
      actor: params.actor || "anonymous",
      workspaceId: params.workspaceId || "global",
      allowed: false,
      success: false,
      reason: params.reason,
      correlationId,
      metadata: {
        code: params.code,
        toolName: params.toolName,
        ...(params.metadata || {}),
      },
    });
  } catch {
    /* never crash on audit */
  }
}
