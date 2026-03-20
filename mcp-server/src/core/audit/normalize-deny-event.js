/**
 * Map authorize-tool-call / permission phases to hub security event types.
 */

import { HubEventTypes } from "./event-types.js";

/**
 * @param {string} phase - from authorizeToolCall (scope, policy, tenant, ...)
 * @param {string} [code] - machine error code when useful for subtyping
 * @returns { keyof typeof HubEventTypes extends never ? string : string }
 */
export function hubEventTypeFromAuthzPhase(phase, _code = "") {
  switch (phase) {
    case "scope":
      return HubEventTypes.AUTH_DENIED;
    case "policy":
      return HubEventTypes.POLICY_DENIED;
    case "workspace_permission":
      return HubEventTypes.WORKSPACE_DENIED;
    case "tenant":
      return HubEventTypes.TENANT_DENIED;
    case "workspace_boundary":
      return HubEventTypes.WORKSPACE_DENIED;
    default:
      return HubEventTypes.AUTH_DENIED;
  }
}

/**
 * Workspace-permissions module deny (can_read_workspace, can_run_tool, …) → workspace.denied
 */
export function hubEventTypeFromPermissionOperation() {
  return HubEventTypes.WORKSPACE_DENIED;
}
