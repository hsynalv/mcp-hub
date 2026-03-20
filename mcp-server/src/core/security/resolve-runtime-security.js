/**
 * Single runtime security resolver — production fail-closed; dev/test escape hatches are explicit env flags.
 */

function envBool(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return String(v).toLowerCase() === "true" || v === "1";
}

export function hubKeysConfigured() {
  return !!(
    process.env.HUB_READ_KEY?.trim() ||
    process.env.HUB_WRITE_KEY?.trim() ||
    process.env.HUB_ADMIN_KEY?.trim()
  );
}

/** @returns {SecurityRuntime} */
function computeSecurityRuntime() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const keys = hubKeysConfigured();

  /** Explicit only: without API keys, full principal scopes are not granted unless this is true. */
  const allowOpenHub = envBool("HUB_ALLOW_OPEN_HUB", false);

  /**
   * When keys are missing, open principal (read+write+admin) is allowed only if HUB_ALLOW_OPEN_HUB=true.
   * When keys exist, normal auth applies (isAuthEnabled); this flag does not grant anonymous access.
   */
  const allowOpenPrincipal = !keys && allowOpenHub;

  /** Unified missing-policy behavior for REST policy guard + MCP tool authorization. */
  const policyAllowMissingEvaluator =
    envBool("POLICY_ALLOW_MISSING_EVALUATOR", false) ||
    envBool("TOOL_POLICY_ALLOW_MISSING_EVALUATOR", false) ||
    envBool("POLICY_GUARD_ALLOW_MISSING_EVALUATOR", false);

  const strictWorkspaceRegistration = envBool("HUB_STRICT_WORKSPACE", isProduction);

  const requireTenantId = envBool("HUB_REQUIRE_TENANT_ID", isProduction);

  const discoveryFilterByPrincipal = envBool("DISCOVERY_FILTER_BY_PRINCIPAL", true);

  /**
   * Allow ?confirmed=true to skip REST policy guard dry-run gate (unsafe). Off by default everywhere.
   * Prefer HUB_POLICY_CONFIRM_SECRET + X-Hub-Policy-Confirm header instead.
   */
  const policyConfirmQueryBypass = envBool("HUB_POLICY_CONFIRM_QUERY_BYPASS", false);

  /**
   * Hub HTTP surfaces require a credential unless open principal applies.
   * - HUB_AUTH_ENABLED=true → always require
   * - unset in production → require (fail-closed)
   * - unset in non-production → optional unless keys are configured (anonymous then denied at principal resolve)
   */
  const hubAuthEnvUnset = process.env.HUB_AUTH_ENABLED === undefined || process.env.HUB_AUTH_ENABLED === "";
  const credentialRequired =
    process.env.HUB_AUTH_ENABLED === "true" ||
    (isProduction && process.env.HUB_AUTH_ENABLED !== "false");

  return {
    nodeEnv,
    isProduction,
    hubKeysConfigured: keys,
    allowOpenHub,
    allowOpenPrincipal,
    policyAllowMissingEvaluator,
    strictWorkspaceRegistration,
    requireTenantId,
    discoveryFilterByPrincipal,
    policyConfirmQueryBypass,
    /** True when explicit hub auth is on or production default fail-closed for HTTP/MCP. */
    credentialRequired,
    /** Diagnostic only: HUB_AUTH was not explicitly set. */
    hubAuthEnvExplicitlyUnset: hubAuthEnvUnset,
  };
}

/**
 * @typedef {{
 *   nodeEnv: string,
 *   isProduction: boolean,
 *   hubKeysConfigured: boolean,
 *   allowOpenHub: boolean,
 *   allowOpenPrincipal: boolean,
 *   policyAllowMissingEvaluator: boolean,
 *   strictWorkspaceRegistration: boolean,
 *   requireTenantId: boolean,
 *   discoveryFilterByPrincipal: boolean,
 *   policyConfirmQueryBypass: boolean,
 *   credentialRequired: boolean,
 *   hubAuthEnvExplicitlyUnset: boolean,
 * }} SecurityRuntime
 */

export function getSecurityRuntime() {
  return computeSecurityRuntime();
}
