/**
 * Backward-compatible projection of {@link getSecurityRuntime}.
 * Prefer importing getSecurityRuntime() for new code.
 */

import { getSecurityRuntime } from "../security/resolve-runtime-security.js";

/**
 * @returns {{
 *   openHubMode: boolean,
 *   toolPolicyAllowMissingEvaluator: boolean,
 *   strictWorkspaceRegistration: boolean,
 *   discoveryFilterByPrincipal: boolean,
 * }}
 */
export function getRuntimeSecurityMode() {
  const r = getSecurityRuntime();
  return {
    /** True when hub keys are missing and HUB_ALLOW_OPEN_HUB grants anonymous full principal. */
    openHubMode: r.allowOpenPrincipal,
    toolPolicyAllowMissingEvaluator: r.policyAllowMissingEvaluator,
    strictWorkspaceRegistration: r.strictWorkspaceRegistration,
    discoveryFilterByPrincipal: r.discoveryFilterByPrincipal,
  };
}
