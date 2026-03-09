/**
 * Plugin Status / Maturity Standard
 *
 * Defines common status enum and production readiness criteria
 * for all platform plugins.
 */

/**
 * Plugin maturity status levels
 * @readonly
 * @enum {string}
 */
export const PluginStatus = {
  /** Early development, unstable, may change significantly */
  EXPERIMENTAL: "experimental",

  /** Functional but not fully tested, may have breaking changes */
  BETA: "beta",

  /** Production-ready, stable API, full test coverage */
  STABLE: "stable",

  /** No longer recommended, will be removed in future */
  DEPRECATED: "deprecated",

  /** Removed from platform */
  SUNSET: "sunset",
};

/**
 * Valid status values array for validation
 */
export const VALID_STATUSES = Object.values(PluginStatus);

/**
 * Check if a status value is valid
 * @param {string} status
 * @returns {boolean}
 */
export function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

/**
 * Get all statuses that are considered production-ready
 * By default, only STABLE is production-ready
 * @returns {string[]}
 */
export function getProductionReadyStatuses() {
  return [PluginStatus.STABLE];
}

/**
 * Check if a plugin status is production-ready
 * @param {string} status
 * @returns {boolean}
 */
export function isProductionReadyStatus(status) {
  return getProductionReadyStatuses().includes(status);
}

/**
 * Get the display name for a status
 * @param {string} status
 * @returns {string}
 */
export function getStatusDisplayName(status) {
  const displayNames = {
    [PluginStatus.EXPERIMENTAL]: "Experimental",
    [PluginStatus.BETA]: "Beta",
    [PluginStatus.STABLE]: "Stable",
    [PluginStatus.DEPRECATED]: "Deprecated",
    [PluginStatus.SUNSET]: "Sunset",
  };
  return displayNames[status] || status;
}

/**
 * Get emoji indicator for status
 * @param {string} status
 * @returns {string}
 */
export function getStatusEmoji(status) {
  const emojis = {
    [PluginStatus.EXPERIMENTAL]: "🔬",
    [PluginStatus.BETA]: "🧪",
    [PluginStatus.STABLE]: "✅",
    [PluginStatus.DEPRECATED]: "⚠️",
    [PluginStatus.SUNSET]: "🌅",
  };
  return emojis[status] || "❓";
}

/**
 * Status progression rules
 * Defines allowed status transitions
 */
export const STATUS_TRANSITIONS = {
  [PluginStatus.EXPERIMENTAL]: [PluginStatus.BETA, PluginStatus.DEPRECATED],
  [PluginStatus.BETA]: [PluginStatus.STABLE, PluginStatus.DEPRECATED],
  [PluginStatus.STABLE]: [PluginStatus.DEPRECATED],
  [PluginStatus.DEPRECATED]: [PluginStatus.SUNSET],
  [PluginStatus.SUNSET]: [],
};

/**
 * Check if a status transition is allowed
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function isValidStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = STATUS_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

/**
 * Production readiness criteria
 * These are the minimum requirements for a plugin to be marked production-ready
 */
export const PRODUCTION_READY_CRITERIA = {
  // Must have this status
  requiredStatus: PluginStatus.STABLE,

  // Must have these boolean flags set to true
  requiredFlags: [
    "hasTests",
    "hasDocs",
    "supportsAudit",
    "supportsPolicy",
  ],

  // Must have at least this test coverage percentage
  minTestCoverage: 70,

  // Must support these scopes
  requiredScopes: ["read"],

  // Must not be deprecated or sunset
  excludedStatuses: [PluginStatus.DEPRECATED, PluginStatus.SUNSET],
};

/**
 * Validate if a plugin meets production readiness criteria
 * @param {Object} metadata - Plugin metadata
 * @returns {{ready: boolean, reasons: string[]}}
 */
export function validateProductionReadiness(metadata) {
  const reasons = [];

  // Check status
  if (!isProductionReadyStatus(metadata.status)) {
    reasons.push(`Status '${metadata.status}' is not production-ready`);
  }

  // Check required flags
  for (const flag of PRODUCTION_READY_CRITERIA.requiredFlags) {
    if (!metadata[flag]) {
      reasons.push(`Missing or false: ${flag}`);
    }
  }

  // Check excluded statuses
  if (PRODUCTION_READY_CRITERIA.excludedStatuses.includes(metadata.status)) {
    reasons.push(`Plugin status '${metadata.status}' excludes production use`);
  }

  // Check test coverage if provided
  if (metadata.testCoverage !== undefined) {
    if (metadata.testCoverage < PRODUCTION_READY_CRITERIA.minTestCoverage) {
      reasons.push(
        `Test coverage ${metadata.testCoverage}% below minimum ${PRODUCTION_READY_CRITERIA.minTestCoverage}%`
      );
    }
  }

  return {
    ready: reasons.length === 0,
    reasons,
  };
}

/**
 * Risk levels for plugins
 * @readonly
 * @enum {string}
 */
export const RiskLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

/**
 * Get risk level based on plugin capabilities
 * @param {Object} metadata
 * @returns {string}
 */
export function inferRiskLevel(metadata) {
  // Critical: can execute arbitrary code or access all data
  if (metadata.capabilities?.includes("execute") ||
      metadata.capabilities?.includes("shell")) {
    return RiskLevel.CRITICAL;
  }

  // High: can modify data or access secrets
  if (metadata.capabilities?.includes("write") ||
      metadata.capabilities?.includes("delete") ||
      metadata.capabilities?.includes("secret")) {
    return RiskLevel.HIGH;
  }

  // Medium: can read sensitive data
  if (metadata.capabilities?.includes("read")) {
    return RiskLevel.MEDIUM;
  }

  return RiskLevel.LOW;
}

/**
 * Status metadata for documentation and UI
 */
export const STATUS_METADATA = {
  [PluginStatus.EXPERIMENTAL]: {
    description: "Early development stage, unstable API, frequent changes expected",
    color: "#ff6b6b",
    badge: "experimental",
    canUseInProduction: false,
    supportLevel: "best-effort",
  },
  [PluginStatus.BETA]: {
    description: "Functional but undergoing testing, API may change",
    color: "#f0ad4e",
    badge: "beta",
    canUseInProduction: false,
    supportLevel: "community",
  },
  [PluginStatus.STABLE]: {
    description: "Production-ready with stable API and full support",
    color: "#5cb85c",
    badge: "stable",
    canUseInProduction: true,
    supportLevel: "full",
  },
  [PluginStatus.DEPRECATED]: {
    description: "No longer recommended, migration path available",
    color: "#777",
    badge: "deprecated",
    canUseInProduction: false,
    supportLevel: "limited",
  },
  [PluginStatus.SUNSET]: {
    description: "Removed from platform, no longer available",
    color: "#333",
    badge: "sunset",
    canUseInProduction: false,
    supportLevel: "none",
  },
};
