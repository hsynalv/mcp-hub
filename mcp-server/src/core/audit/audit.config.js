/**
 * Audit Configuration
 *
 * Environment-based configuration for the audit system.
 */

/**
 * Get audit configuration from environment variables
 * @returns {import("./audit.manager.js").AuditConfig}
 */
export function getAuditConfig() {
  const enabled = process.env.AUDIT_ENABLED !== "false";

  // Parse sinks from comma-separated list
  const sinksEnv = process.env.AUDIT_SINKS || "memory";
  const sinks = sinksEnv.split(",").map(s => s.trim()).filter(Boolean);

  // Memory sink options
  const memoryMaxEntries = parseInt(process.env.AUDIT_MEMORY_MAX_ENTRIES, 10) || 1000;

  // File sink options
  const filePath = process.env.AUDIT_FILE_PATH || "./data/audit.log";
  const fileMaxSizeMB = parseInt(process.env.AUDIT_FILE_MAX_SIZE_MB, 10) || 50;

  // Sanitization options
  const sanitizeStrict = process.env.AUDIT_SANITIZE_STRICT !== "false";

  // Additional sensitive patterns (comma-separated regex patterns)
  const sensitivePatterns = process.env.AUDIT_SENSITIVE_PATTERNS
    ? process.env.AUDIT_SENSITIVE_PATTERNS.split(",").map(p => new RegExp(p.trim(), "i"))
    : [];

  return {
    enabled,
    sinks,
    memoryMaxEntries,
    filePath,
    fileMaxSizeMB,
    sanitizeStrict,
    sensitivePatterns,
  };
}

/**
 * Validate audit configuration
 * @param {Object} config
 * @returns {string|null} Error message if invalid, null if valid
 */
export function validateAuditConfig(config) {
  if (!config || typeof config !== "object") {
    return "Configuration must be an object";
  }

  // Validate sinks
  const validSinks = ["memory", "file", "redis", "multi"];
  if (config.sinks) {
    if (!Array.isArray(config.sinks)) {
      return "sinks must be an array";
    }
    for (const sink of config.sinks) {
      if (!validSinks.includes(sink)) {
        return `Invalid sink type: ${sink}. Valid types: ${validSinks.join(", ")}`;
      }
    }
  }

  // Validate memoryMaxEntries
  if (config.memoryMaxEntries !== undefined) {
    if (typeof config.memoryMaxEntries !== "number" || config.memoryMaxEntries < 1) {
      return "memoryMaxEntries must be a positive number";
    }
  }

  // Validate fileMaxSizeMB
  if (config.fileMaxSizeMB !== undefined) {
    if (typeof config.fileMaxSizeMB !== "number" || config.fileMaxSizeMB < 1) {
      return "fileMaxSizeMB must be a positive number";
    }
  }

  // Validate filePath
  if (config.filePath !== undefined) {
    if (typeof config.filePath !== "string" || config.filePath.length === 0) {
      return "filePath must be a non-empty string";
    }
  }

  return null;
}

/**
 * Default configuration values
 */
export const DEFAULT_AUDIT_CONFIG = {
  enabled: true,
  sinks: ["memory"],
  memoryMaxEntries: 1000,
  filePath: "./data/audit.log",
  fileMaxSizeMB: 50,
  sanitizeStrict: true,
  sensitivePatterns: [],
};

/**
 * Environment variable documentation
 */
export const AUDIT_ENV_DOCS = {
  AUDIT_ENABLED: "Enable/disable audit logging (default: true)",
  AUDIT_SINKS: "Comma-separated list of sinks: memory, file (default: memory)",
  AUDIT_MEMORY_MAX_ENTRIES: "Maximum entries for memory sink (default: 1000)",
  AUDIT_FILE_PATH: "Path for file sink (default: ./data/audit.log)",
  AUDIT_FILE_MAX_SIZE_MB: "Max file size before rotation in MB (default: 50)",
  AUDIT_SANITIZE_STRICT: "Strict metadata sanitization (default: true)",
  AUDIT_SENSITIVE_PATTERNS: "Additional sensitive key patterns (comma-separated)",
};
