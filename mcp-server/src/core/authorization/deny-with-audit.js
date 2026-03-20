/**
 * Standard audit for authorization / policy denials on tool execution.
 */

import { emitHubAuditEvent } from "../audit/emit-hub-event.js";
import { hubEventTypeFromAuthzPhase } from "../audit/normalize-deny-event.js";
import { HubOutcomes } from "../audit/event-types.js";
import { generateCorrelationId } from "../audit/audit.standard.js";

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
  const eventType = hubEventTypeFromAuthzPhase(params.phase, params.code);
  try {
    const rule =
      params.metadata && typeof params.metadata.rule === "string"
        ? params.metadata.rule
        : null;
    const targetWs =
      params.metadata && typeof params.metadata.targetWorkspaceId === "string"
        ? params.metadata.targetWorkspaceId
        : null;

    await emitHubAuditEvent({
      eventType,
      outcome: HubOutcomes.DENIED,
      plugin: params.plugin || "core",
      actor: params.actor || "anonymous",
      workspaceId: params.workspaceId || "global",
      correlationId,
      durationMs: 0,
      allowed: false,
      success: false,
      reason: params.reason,
      error: params.code,
      metadata: {
        hubErrorCode: params.code,
        hubToolName: params.toolName ?? null,
        hubPlugin: params.plugin ?? null,
        hubPhase: params.phase,
        ...(rule ? { hubPolicyRule: rule } : {}),
        ...(targetWs ? { hubTargetWorkspaceId: targetWs } : {}),
      },
    });
  } catch {
    /* never crash on audit */
  }
}
