/**
 * Policy Result
 *
 * Standard policy decision format for all plugins.
 */

/**
 * Policy Result
 * @typedef {Object} PolicyResult
 * @property {boolean} allowed - Whether operation is allowed
 * @property {string} [reason] - Human-readable reason
 * @property {string} [code] - Machine-readable error code
 * @property {string} [policy] - Policy that made the decision
 * @property {Object} [metadata] - Additional metadata
 * @property {number} [evaluatedAt] - Timestamp of evaluation
 */

/**
 * Common policy decision codes
 */
export const PolicyCodes = {
  // Allow codes
  ALLOWED: "ALLOWED",
  ALLOWED_READ_SCOPE: "ALLOWED_READ_SCOPE",
  ALLOWED_WRITE_SCOPE: "ALLOWED_WRITE_SCOPE",
  ALLOWED_ADMIN_SCOPE: "ALLOWED_ADMIN_SCOPE",
  ALLOWED_TRUSTED_PLUGIN: "ALLOWED_TRUSTED_PLUGIN",
  ALLOWED_MATCHING_RULE: "ALLOWED_MATCHING_RULE",

  // Deny codes
  DENIED_DEFAULT: "DENIED_DEFAULT",
  DENIED_MISSING_SCOPE: "DENIED_MISSING_SCOPE",
  DENIED_INSUFFICIENT_SCOPE: "DENIED_INSUFFICIENT_SCOPE",
  DENIED_DESTRUCTIVE_ACTION: "DENIED_DESTRUCTIVE_ACTION",
  DENIED_READONLY_MODE: "DENIED_READONLY_MODE",
  DENIED_INVALID_CONTEXT: "DENIED_INVALID_CONTEXT",
  DENIED_PLUGIN_DISABLED: "DENIED_PLUGIN_DISABLED",
  DENIED_WORKSPACE_MISMATCH: "DENIED_WORKSPACE_MISMATCH",
  DENIED_RESOURCE_NOT_FOUND: "DENIED_RESOURCE_NOT_FOUND",
  DENIED_RATE_LIMIT: "DENIED_RATE_LIMIT",
  DENIED_SECRET_RESOLVE: "DENIED_SECRET_RESOLVE",
  DENIED_SHELL_EXECUTION: "DENIED_SHELL_EXECUTION",
  DENIED_DATABASE_WRITE: "DENIED_DATABASE_WRITE",
  DENIED_FILE_DELETE: "DENIED_FILE_DELETE",
  DENIED_UNAUTHORIZED: "DENIED_UNAUTHORIZED",
};

/**
 * Human-readable reason templates
 */
const REASON_TEMPLATES = {
  [PolicyCodes.ALLOWED]: "Operation allowed",
  [PolicyCodes.ALLOWED_READ_SCOPE]: "Operation allowed with read scope",
  [PolicyCodes.ALLOWED_WRITE_SCOPE]: "Operation allowed with write scope",
  [PolicyCodes.DENIED_DEFAULT]: "Operation denied by default policy",
  [PolicyCodes.DENIED_MISSING_SCOPE]: "Missing required scope for operation",
  [PolicyCodes.DENIED_INSUFFICIENT_SCOPE]: "Insufficient scope for this operation",
  [PolicyCodes.DENIED_DESTRUCTIVE_ACTION]: "Destructive actions require explicit authorization",
  [PolicyCodes.DENIED_READONLY_MODE]: "System is in read-only mode",
  [PolicyCodes.DENIED_INVALID_CONTEXT]: "Invalid or incomplete authorization context",
  [PolicyCodes.DENIED_PLUGIN_DISABLED]: "Plugin is currently disabled",
  [PolicyCodes.DENIED_SECRET_RESOLVE]: "Secret resolution not authorized",
  [PolicyCodes.DENIED_SHELL_EXECUTION]: "Shell execution not authorized",
  [PolicyCodes.DENIED_DATABASE_WRITE]: "Database write not authorized",
  [PolicyCodes.DENIED_FILE_DELETE]: "File deletion not authorized",
  [PolicyCodes.DENIED_UNAUTHORIZED]: "Unauthorized operation",
};

/**
 * Create an allow result
 * @param {Object} options - Allow options
 * @param {string} [options.reason] - Custom reason
 * @param {string} [options.code=ALLOWED] - Allow code
 * @param {string} [options.policy] - Policy name
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {PolicyResult}
 */
export function allow(options = {}) {
  const code = options.code || PolicyCodes.ALLOWED;

  return {
    allowed: true,
    reason: options.reason || REASON_TEMPLATES[code] || "Operation allowed",
    code,
    policy: options.policy || null,
    metadata: options.metadata || {},
    evaluatedAt: Date.now(),
  };
}

/**
 * Create a deny result
 * @param {Object} options - Deny options
 * @param {string} [options.reason] - Custom reason
 * @param {string} [options.code=DENIED_DEFAULT] - Deny code
 * @param {string} [options.policy] - Policy name
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {PolicyResult}
 */
export function deny(options = {}) {
  const code = options.code || PolicyCodes.DENIED_DEFAULT;

  return {
    allowed: false,
    reason: options.reason || REASON_TEMPLATES[code] || "Operation denied",
    code,
    policy: options.policy || null,
    metadata: options.metadata || {},
    evaluatedAt: Date.now(),
  };
}

/**
 * Create a result from a boolean
 * @param {boolean} isAllowed - Whether allowed
 * @param {Object} [options] - Additional options
 * @returns {PolicyResult}
 */
export function fromBoolean(isAllowed, options = {}) {
  return isAllowed ? allow(options) : deny(options);
}

/**
 * Check if result is allowed
 * @param {PolicyResult} result - Policy result
 * @returns {boolean}
 */
export function isAllowed(result) {
  return result?.allowed === true;
}

/**
 * Check if result is denied
 * @param {PolicyResult} result - Policy result
 * @returns {boolean}
 */
export function isDenied(result) {
  return result?.allowed === false;
}

/**
 * Check if result indicates a destructive action denial
 * @param {PolicyResult} result - Policy result
 * @returns {boolean}
 */
export function isDestructiveDenial(result) {
  return isDenied(result) &&
    (result.code === PolicyCodes.DENIED_DESTRUCTIVE_ACTION ||
     result.code === PolicyCodes.DENIED_SHELL_EXECUTION ||
     result.code === PolicyCodes.DENIED_FILE_DELETE ||
     result.code === PolicyCodes.DENIED_DATABASE_WRITE);
}

/**
 * Check if result indicates a scope-related denial
 * @param {PolicyResult} result - Policy result
 * @returns {boolean}
 */
export function isScopeDenial(result) {
  return isDenied(result) &&
    (result.code === PolicyCodes.DENIED_MISSING_SCOPE ||
     result.code === PolicyCodes.DENIED_INSUFFICIENT_SCOPE ||
     result.code === PolicyCodes.DENIED_READONLY_MODE);
}

/**
 * Format result for logging (sanitized)
 * @param {PolicyResult} result - Policy result
 * @returns {Object}
 */
export function formatForLogging(result) {
  if (!result) return { allowed: false, reason: "No result provided" };

  return {
    allowed: result.allowed,
    code: result.code,
    reason: result.reason,
    policy: result.policy,
    evaluatedAt: result.evaluatedAt,
  };
}

/**
 * Convert result to error response
 * @param {PolicyResult} result - Policy result
 * @returns {Object} - Error response object
 */
export function toErrorResponse(result) {
  if (!isDenied(result)) {
    return null;
  }

  const statusCode = getStatusCodeForDenial(result.code);

  return {
    ok: false,
    error: {
      code: result.code || PolicyCodes.DENIED_DEFAULT,
      message: result.reason || "Operation denied",
      status: statusCode,
      policy: result.policy,
    },
  };
}

/**
 * Get HTTP status code for denial code
 * @param {string} code - Denial code
 * @returns {number}
 */
function getStatusCodeForDenial(code) {
  const statusMap = {
    [PolicyCodes.DENIED_UNAUTHORIZED]: 401,
    [PolicyCodes.DENIED_MISSING_SCOPE]: 403,
    [PolicyCodes.DENIED_INSUFFICIENT_SCOPE]: 403,
    [PolicyCodes.DENIED_DESTRUCTIVE_ACTION]: 403,
    [PolicyCodes.DENIED_READONLY_MODE]: 403,
    [PolicyCodes.DENIED_SECRET_RESOLVE]: 403,
    [PolicyCodes.DENIED_SHELL_EXECUTION]: 403,
    [PolicyCodes.DENIED_RATE_LIMIT]: 429,
    [PolicyCodes.DENIED_RESOURCE_NOT_FOUND]: 404,
  };

  return statusMap[code] || 403;
}

/**
 * Merge multiple results (any deny = deny)
 * @param {PolicyResult[]} results - Array of results
 * @returns {PolicyResult}
 */
export function mergeResults(results) {
  if (!results || results.length === 0) {
    return deny({ code: PolicyCodes.DENIED_DEFAULT, reason: "No policies evaluated" });
  }

  // If any result is denied, return the first denial
  const denial = results.find(r => isDenied(r));
  if (denial) {
    return {
      ...denial,
      metadata: {
        ...denial.metadata,
        evaluatedPolicies: results.length,
        allResults: results.map(r => formatForLogging(r)),
      },
    };
  }

  // All allowed, return combined allow
  return allow({
    metadata: {
      evaluatedPolicies: results.length,
      allResults: results.map(r => formatForLogging(r)),
    },
  });
}

/**
 * Create a result requiring explicit confirmation
 * @param {Object} options - Options
 * @param {string} [options.reason] - Reason for requiring confirmation
 * @param {string} [options.code] - Code
 * @returns {PolicyResult}
 */
export function requireConfirmation(options = {}) {
  return deny({
    code: options.code || PolicyCodes.DENIED_DESTRUCTIVE_ACTION,
    reason: options.reason || "This action requires explicit confirmation",
    metadata: {
      ...options.metadata,
      requiresConfirmation: true,
    },
  });
}

/**
 * Default result when no policies match (configurable)
 * @param {boolean} [defaultDeny=true] - Default to deny
 * @returns {PolicyResult}
 */
export function defaultResult(defaultDeny = true) {
  return defaultDeny
    ? deny({ code: PolicyCodes.DENIED_DEFAULT, reason: "No matching policy found" })
    : allow({ code: PolicyCodes.ALLOWED, reason: "No matching policy found, allowed by default" });
}
