/**
 * Hub audit for STDIO bootstrap auth failures (before MCP session serves traffic).
 */

import { emitHubAuditEvent } from "./emit-hub-event.js";
import { HubEventTypes, HubOutcomes } from "./event-types.js";

/**
 * @param {object} p
 * @param {string} p.sessionId
 * @param {string} p.reason - human/machine summary
 * @param {string} p.errorCode - e.g. unauthorized | invalid_token | insufficient_scope
 * @param {string} [p.workspaceId]
 * @param {string|null} [p.projectId]
 * @param {string} [p.requiredScope]
 */
export async function emitStdioBootstrapAuthDenied(p) {
  const {
    sessionId,
    reason,
    errorCode,
    workspaceId = "global",
    projectId = null,
    requiredScope,
  } = p;

  const correlationId = `stdio-session-${sessionId}`;

  /** @type {Record<string, string>} */
  const metadata = {
    hubTransport: "stdio",
    hubSessionId: sessionId,
    hubDenySource: "stdio_auth",
    hubDenyKind:
      errorCode === "invalid_token"
        ? "invalid_token"
        : errorCode === "insufficient_scope"
          ? "insufficient_scope"
          : "unauthenticated",
    hubErrorCode: errorCode,
  };

  if (requiredScope) {
    metadata.hubRequiredScope = String(requiredScope);
  }

  await emitHubAuditEvent({
    eventType: HubEventTypes.AUTH_DENIED,
    outcome: HubOutcomes.DENIED,
    plugin: "core",
    actor: "anonymous",
    workspaceId,
    projectId,
    correlationId,
    durationMs: 0,
    allowed: false,
    success: false,
    reason,
    error: errorCode,
    metadata,
  });
}
