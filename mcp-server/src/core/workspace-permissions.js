/**
 * Workspace Permission Abstraction
 *
 * Reusable permission checks for plugins.
 * All denied operations are logged to audit.
 */

import { getWorkspace, isPluginAllowed } from "./workspace.js";
import { generateCorrelationId } from "./audit/audit.standard.js";
import { emitHubAuditEvent } from "./audit/emit-hub-event.js";
import { hubEventTypeFromPermissionOperation } from "./audit/normalize-deny-event.js";
import { HubOutcomes } from "./audit/event-types.js";
import { sanitizeWorkspaceId, canAccessWorkspace } from "./workspace-paths.js";
import { getRuntimeSecurityMode } from "./auth/get-runtime-security-mode.js";

const STRICT_WORKSPACE = process.env.WORKSPACE_STRICT_BOUNDARIES === "true";

/**
 * @typedef {Object} PermissionContext
 * @property {string} [workspaceId]
 * @property {string} [actor]
 * @property {string} [plugin]
 * @property {string} [operation]
 * @property {string} [correlationId]
 * @property {string} [toolName]
 */

/**
 * Audit a denied operation
 */
async function auditDenied(plugin, operation, reason, context) {
  try {
    await emitHubAuditEvent({
      eventType: hubEventTypeFromPermissionOperation(),
      outcome: HubOutcomes.DENIED,
      plugin,
      actor: context.actor || "anonymous",
      workspaceId: context.workspaceId || "global",
      correlationId: context.correlationId || generateCorrelationId(),
      durationMs: 0,
      allowed: false,
      success: false,
      reason,
      error: reason,
      metadata: {
        hubDeniedOperation: operation,
        hubToolName: context.toolName ?? null,
      },
    });
  } catch {
    /* never crash on audit failure */
  }
}

/**
 * can_read_workspace: Check if actor can read from workspace
 * @param {PermissionContext} context
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function canReadWorkspace(context = {}) {
  const wsId = context.workspaceId || "global";

  if (STRICT_WORKSPACE && !wsId) {
    await auditDenied(context.plugin || "core", "can_read_workspace", "workspace_id_required", context);
    return { allowed: false, reason: "workspace_id_required" };
  }

  const { valid } = sanitizeWorkspaceId(wsId);
  if (!valid && STRICT_WORKSPACE) {
    await auditDenied(context.plugin || "core", "can_read_workspace", "invalid_workspace_id", context);
    return { allowed: false, reason: "invalid_workspace_id" };
  }

  const workspace = getWorkspace(wsId);
  if (workspace && context.plugin && !isPluginAllowed(wsId, context.plugin)) {
    await auditDenied(context.plugin, "can_read_workspace", "plugin_not_allowed_in_workspace", context);
    return { allowed: false, reason: "plugin_not_allowed_in_workspace" };
  }

  return { allowed: true };
}

/**
 * can_write_workspace: Check if actor can write to workspace
 */
export async function canWriteWorkspace(context = {}) {
  const readCheck = await canReadWorkspace(context);
  if (!readCheck.allowed) return readCheck;

  const wsId = context.workspaceId || "global";
  const workspace = getWorkspace(wsId);
  if (workspace?.settings?.readOnly) {
    await auditDenied(context.plugin || "core", "can_write_workspace", "workspace_read_only", context);
    return { allowed: false, reason: "workspace_read_only" };
  }

  return { allowed: true };
}

/**
 * can_run_tool: Check if tool can be run in workspace context
 * @param {string} toolName
 * @param {PermissionContext} context
 * @param {string} [operationType] - e.g. "read", "write", "index", "git"
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function canRunTool(toolName, context = {}, operationType = null) {
  const wsId = context.workspaceId || "global";

  const mode = getRuntimeSecurityMode();
  if (mode.strictWorkspaceRegistration && wsId !== "global" && !getWorkspace(wsId)) {
    await auditDenied(context.plugin || "core", "can_run_tool", "workspace_not_registered", {
      ...context,
      toolName,
      workspaceId: wsId,
    });
    return { allowed: false, reason: "workspace_not_registered" };
  }

  if (STRICT_WORKSPACE && wsId && wsId !== "global") {
    const check = await canReadWorkspace(context);
    if (!check.allowed) return check;
  }

  const workspace = getWorkspace(wsId);
  if (workspace) {
    if (context.plugin && !isPluginAllowed(wsId, context.plugin)) {
      await auditDenied(context.plugin, "can_run_tool", "plugin_not_allowed", { ...context, toolName });
      return { allowed: false, reason: "plugin_not_allowed" };
    }
    const allowedOps = workspace.settings.allowed_operations;
    if (Array.isArray(allowedOps) && allowedOps.length > 0 && operationType && !allowedOps.includes(operationType)) {
      await auditDenied(context.plugin || "core", "can_run_tool", "operation_not_allowed", {
        ...context,
        toolName,
        operationType,
      });
      return { allowed: false, reason: "operation_not_allowed" };
    }
  }

  return { allowed: true };
}

/**
 * can_modify_index: Check if RAG/index can be modified in workspace
 */
export async function canModifyIndex(context = {}) {
  return canWriteWorkspace(context);
}

/**
 * checkCrossWorkspaceAccess: Ensure target workspace is accessible
 * @param {string} callerWorkspaceId
 * @param {string} targetWorkspaceId
 * @param {PermissionContext} context
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function checkCrossWorkspaceAccess(callerWorkspaceId, targetWorkspaceId, context = {}) {
  const result = canAccessWorkspace(callerWorkspaceId, targetWorkspaceId);
  if (!result.allowed) {
    await auditDenied(context.plugin || "core", "cross_workspace_access", result.reason, {
      ...context,
      workspaceId: targetWorkspaceId,
      callerWorkspaceId,
    });
  }
  return result;
}
