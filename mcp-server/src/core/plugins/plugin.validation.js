/**
 * Plugin Validation Layer
 *
 * Validates plugin metadata and contract compliance.
 * Can be used at startup, in CI tests, or during plugin registration.
 */

import {
  METADATA_SCHEMA,
  REQUIRED_METADATA_FIELDS,
  RECOMMENDED_METADATA_FIELDS,
  createMetadata,
} from "./plugin.metadata.js";
import {
  PLUGIN_CONTRACT_SCHEMA,
  REQUIRED_PLUGIN_EXPORTS,
  validatePluginContract,
} from "./plugin.contract.js";
import {
  VALID_STATUSES,
  isValidStatus,
} from "./plugin.status.js";

/**
 * Validation severity levels
 * @readonly
 * @enum {string}
 */
export const ValidationSeverity = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
};

/**
 * Validate a single metadata field
 * @param {string} fieldName
 * @param {any} value
 * @param {Object} schema
 * @returns {{valid: boolean, error?: string}}
 */
function validateField(fieldName, value, schema) {
  // Check required
  if (schema.required && (value === undefined || value === null)) {
    return { valid: false, error: `Required field '${fieldName}' is missing` };
  }

  // If not required and missing, it's valid
  if (!schema.required && (value === undefined || value === null)) {
    return { valid: true };
  }

  // Check type
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (schema.type && actualType !== schema.type) {
    return {
      valid: false,
      error: `Field '${fieldName}' expected type '${schema.type}', got '${actualType}'`,
    };
  }

  // Check string pattern
  if (schema.type === "string" && schema.pattern && !schema.pattern.test(value)) {
    return {
      valid: false,
      error: `Field '${fieldName}' does not match required pattern`,
    };
  }

  // Check string length
  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return {
        valid: false,
        error: `Field '${fieldName}' too short (min ${schema.minLength})`,
      };
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return {
        valid: false,
        error: `Field '${fieldName}' too long (max ${schema.maxLength})`,
      };
    }
  }

  // Check number range
  if (schema.type === "number") {
    if (schema.min !== undefined && value < schema.min) {
      return {
        valid: false,
        error: `Field '${fieldName}' below minimum (${schema.min})`,
      };
    }
    if (schema.max !== undefined && value > schema.max) {
      return {
        valid: false,
        error: `Field '${fieldName}' above maximum (${schema.max})`,
      };
    }
  }

  // Check enum
  if (schema.enum && !schema.enum.includes(value)) {
    return {
      valid: false,
      error: `Field '${fieldName}' must be one of: ${schema.enum.join(", ")}`,
    };
  }

  // Check array items
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const itemResult = validateField(`${fieldName}[${i}]`, value[i], schema.items);
      if (!itemResult.valid) {
        return itemResult;
      }
    }
  }

  return { valid: true };
}

/**
 * Comprehensive plugin metadata validation
 * @param {Object} metadata
 * @param {Object} options
 * @returns {{valid: boolean, errors: string[], warnings: string[], info: string[]}}
 */
export function validateMetadata(metadata, options = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const { strict = false, checkRecommended = true } = options;

  // Check for required fields
  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!(field in metadata) || metadata[field] === undefined || metadata[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate each field against schema
  for (const [fieldName, value] of Object.entries(metadata)) {
    const schema = METADATA_SCHEMA[fieldName];

    if (!schema) {
      if (strict) {
        warnings.push(`Unknown field: ${fieldName}`);
      }
      continue;
    }

    const result = validateField(fieldName, value, schema);
    if (!result.valid) {
      errors.push(result.error);
    }
  }

  // Check recommended fields
  if (checkRecommended) {
    for (const field of RECOMMENDED_METADATA_FIELDS) {
      if (!(field in metadata) || metadata[field] === undefined) {
        warnings.push(`Missing recommended field: ${field}`);
      }
    }
  }

  // Status-specific validation
  if (metadata.status) {
    // Experimental plugins should not be productionReady
    if (metadata.status === "experimental" && metadata.productionReady) {
      warnings.push("Experimental plugins should not be marked productionReady");
    }

    // Stable plugins should have tests and docs
    if (metadata.status === "stable") {
      if (!metadata.hasTests) {
        warnings.push("Stable plugins should have tests (hasTests: true)");
      }
      if (!metadata.hasDocs) {
        warnings.push("Stable plugins should have documentation (hasDocs: true)");
      }
    }
  }

  // productionReady consistency check
  if (metadata.productionReady && metadata.status !== "stable") {
    warnings.push(`productionReady=true but status is '${metadata.status}' (usually should be 'stable')`);
  }

  // Capabilities and scopes consistency
  if (metadata.capabilities?.includes("write") && !metadata.scopes?.includes("write")) {
    warnings.push("Plugin has 'write' capability but 'write' scope not declared");
  }

  if (metadata.capabilities?.includes("delete") && !metadata.scopes?.includes("admin")) {
    warnings.push("Plugin has 'delete' capability but 'admin' scope not declared");
  }

  // Audit/policy support flags
  if (metadata.supportsAudit && !metadata.capabilities?.includes("audit")) {
    info.push("supportsAudit=true but 'audit' not in capabilities");
  }

  if (metadata.supportsPolicy && !metadata.capabilities?.includes("policy")) {
    info.push("supportsPolicy=true but 'policy' not in capabilities");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}

/**
 * Quick validation - checks only required fields
 * @param {Object} metadata
 * @returns {boolean}
 */
export function isValidMetadata(metadata) {
  const result = validateMetadata(metadata, { strict: false, checkRecommended: false });
  return result.valid;
}

/**
 * Full plugin validation (metadata + contract)
 * @param {Object} pluginExports
 * @param {Object} options
 * @returns {{valid: boolean, metadata: Object, errors: string[], warnings: string[]}}
 */
export function validatePlugin(pluginExports, options = {}) {
  const errors = [];
  const warnings = [];

  // Validate contract first
  const contractValidation = validatePluginContract(pluginExports, options);
  if (!contractValidation.valid) {
    errors.push(...contractValidation.errors);
  }
  warnings.push(...contractValidation.warnings);

  // Validate metadata if present
  if (pluginExports.metadata) {
    const metadataValidation = validateMetadata(pluginExports.metadata, options);
    if (!metadataValidation.valid) {
      errors.push(...metadataValidation.errors);
    }
    warnings.push(...metadataValidation.warnings);

    // Cross-validation: metadata capabilities vs exports
    const hasToolsExport = "tools" in pluginExports;
    const hasToolsCapability = pluginExports.metadata.capabilities?.includes("mcp-tools");
    if (hasToolsExport && !hasToolsCapability) {
      warnings.push("Plugin exports 'tools' but missing 'mcp-tools' capability");
    }

    // Check audit support consistency
    if (pluginExports.metadata.supportsAudit && !("audit" in pluginExports)) {
      warnings.push("supportsAudit=true but no 'audit' export provided");
    }
  } else {
    errors.push("Missing required export: metadata");
  }

  return {
    valid: errors.length === 0,
    metadata: pluginExports.metadata,
    errors,
    warnings,
  };
}

/**
 * Batch validation for multiple plugins
 * @param {Array<{name: string, exports: Object}>} plugins
 * @param {Object} options
 * @returns {{valid: boolean, results: Array, summary: Object}}
 */
export function validateMultiplePlugins(plugins, options = {}) {
  const results = [];
  let validCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const { name, exports } of plugins) {
    const result = validatePlugin(exports, options);
    results.push({ name, ...result });

    if (result.valid) {
      validCount++;
    } else {
      errorCount++;
    }
    warningCount += result.warnings.length;
  }

  return {
    valid: errorCount === 0,
    results,
    summary: {
      total: plugins.length,
      valid: validCount,
      errors: errorCount,
      warnings: warningCount,
    },
  };
}

/**
 * Create a validation reporter for formatted output
 * @param {Object} validationResult
 * @returns {Object} Reporter with formatting methods
 */
export function createValidationReporter(validationResult) {
  return {
    toString() {
      const lines = [];
      lines.push(`Validation Result: ${validationResult.valid ? "✅ VALID" : "❌ INVALID"}`);
      lines.push("");

      if (validationResult.errors.length > 0) {
        lines.push("Errors:");
        for (const error of validationResult.errors) {
          lines.push(`  ❌ ${error}`);
        }
        lines.push("");
      }

      if (validationResult.warnings.length > 0) {
        lines.push("Warnings:");
        for (const warning of validationResult.warnings) {
          lines.push(`  ⚠️  ${warning}`);
        }
        lines.push("");
      }

      if (validationResult.info?.length > 0) {
        lines.push("Info:");
        for (const info of validationResult.info) {
          lines.push(`  ℹ️  ${info}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    },

    toJSON() {
      return JSON.stringify(validationResult, null, 2);
    },

    toMarkdown() {
      const lines = [];
      lines.push(`## Validation Result: ${validationResult.valid ? "✅ VALID" : "❌ INVALID"}`);
      lines.push("");

      if (validationResult.errors.length > 0) {
        lines.push("### Errors");
        for (const error of validationResult.errors) {
          lines.push(`- ❌ ${error}`);
        }
        lines.push("");
      }

      if (validationResult.warnings.length > 0) {
        lines.push("### Warnings");
        for (const warning of validationResult.warnings) {
          lines.push(`- ⚠️ ${warning}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    },

    get exitCode() {
      return validationResult.valid ? 0 : 1;
    },
  };
}

/**
 * Validation configuration for different environments
 */
export const VALIDATION_CONFIGS = {
  // Strict validation for CI/CD
  ci: {
    strict: true,
    checkRecommended: true,
  },

  // Standard validation for development
  development: {
    strict: false,
    checkRecommended: true,
  },

  // Lenient validation for startup
  startup: {
    strict: false,
    checkRecommended: false,
  },

  // Production validation
  production: {
    strict: true,
    checkRecommended: true,
  },
};

/**
 * Get validation config for environment
 * @param {string} environment
 * @returns {Object}
 */
export function getValidationConfig(environment = "development") {
  return VALIDATION_CONFIGS[environment] || VALIDATION_CONFIGS.development;
}

/**
 * Run validation for a specific environment
 * @param {Object} pluginExports
 * @param {string} environment
 * @returns {Object} Validation result
 */
export function validateForEnvironment(pluginExports, environment = "development") {
  const config = getValidationConfig(environment);
  return validatePlugin(pluginExports, config);
}

/**
 * Assert that a plugin is valid (throws on failure)
 * @param {Object} pluginExports
 * @param {Object} options
 * @throws {Error} If validation fails
 */
export function assertValidPlugin(pluginExports, options = {}) {
  const result = validatePlugin(pluginExports, options);
  if (!result.valid) {
    const reporter = createValidationReporter(result);
    throw new Error(`Plugin validation failed:\n${reporter.toString()}`);
  }
  return result;
}

/**
 * Plugin compatibility check
 * Checks if a plugin is compatible with the current platform version
 * @param {Object} metadata
 * @param {string} platformVersion
 * @returns {{compatible: boolean, reason?: string}}
 */
export function checkCompatibility(metadata, platformVersion = "1.0.0") {
  // Check minimum platform version if specified
  if (metadata.minPlatformVersion) {
    const min = metadata.minPlatformVersion;
    // Simple semver comparison
    if (platformVersion < min) {
      return {
        compatible: false,
        reason: `Requires platform version ${min}, current is ${platformVersion}`,
      };
    }
  }

  // Check deprecated plugins
  if (metadata.status === "deprecated") {
    return {
      compatible: false,
      reason: "Plugin is deprecated and should not be used",
    };
  }

  // Check sunset plugins
  if (metadata.status === "sunset") {
    return {
      compatible: false,
      reason: "Plugin has been sunset and is no longer available",
    };
  }

  return { compatible: true };
}
