/**
 * Policy Configuration
 *
 * Environment-based configuration for the policy system.
 */

/**
 * Default policy configuration
 */
export const DEFAULT_POLICY_CONFIG = {
  enabled: true,
  defaultDeny: true,
  strictMode: false,
  logDecisions: false,
  failSafe: true,
  trustedPlugins: [],
};

/**
 * Get policy configuration from environment variables
 * @returns {Object}
 */
export function getPolicyConfig() {
  const enabled = process.env.POLICY_ENABLED !== "false";
  const defaultDeny = process.env.POLICY_DEFAULT_DENY !== "false";
  const strictMode = process.env.POLICY_STRICT_MODE === "true";
  const logDecisions = process.env.POLICY_LOG_DECISIONS === "true";
  const failSafe = process.env.POLICY_FAIL_SAFE !== "false";

  // Parse trusted plugins
  const trustedPlugins = process.env.POLICY_TRUSTED_PLUGINS
    ? process.env.POLICY_TRUSTED_PLUGINS.split(",").map(p => p.trim()).filter(Boolean)
    : [];

  return {
    enabled,
    defaultDeny,
    strictMode,
    logDecisions,
    failSafe,
    trustedPlugins,
  };
}

/**
 * Validate policy configuration
 * @param {Object} config
 * @returns {string|null} Error message if invalid, null if valid
 */
export function validatePolicyConfig(config) {
  if (!config || typeof config !== "object") {
    return "Configuration must be an object";
  }

  const booleanFields = ["enabled", "defaultDeny", "strictMode", "logDecisions", "failSafe"];
  for (const field of booleanFields) {
    if (config[field] !== undefined && typeof config[field] !== "boolean") {
      return `Field '${field}' must be a boolean`;
    }
  }

  if (config.trustedPlugins !== undefined && !Array.isArray(config.trustedPlugins)) {
    return "Field 'trustedPlugins' must be an array";
  }

  return null;
}

/**
 * Environment variable documentation
 */
export const POLICY_ENV_DOCS = {
  POLICY_ENABLED: "Enable/disable policy system (default: true)",
  POLICY_DEFAULT_DENY: "Default to deny if no rule matches (default: true)",
  POLICY_STRICT_MODE: "Strict mode - fail on missing context fields (default: false)",
  POLICY_LOG_DECISIONS: "Log all policy decisions (default: false)",
  POLICY_FAIL_SAFE: "Deny on errors (default: true)",
  POLICY_TRUSTED_PLUGINS: "Comma-separated list of trusted plugin names",
};
