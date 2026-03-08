import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Plugin Metadata Validator
 * 
 * Validates plugin.meta.json files against the schema
 * and enforces quality standards during plugin loading.
 */

const REQUIRED_FIELDS = ["name", "version", "status", "owner"];
const VALID_STATUSES = ["stable", "beta", "experimental"];
const VALID_TEST_LEVELS = ["none", "unit", "integration", "e2e"];
const VALID_SCOPES = ["read", "write", "admin"];

/**
 * Validate a plugin's metadata
 * @param {string} pluginDir - Path to plugin directory
 * @param {string} pluginName - Plugin folder name
 * @returns {Object} Validation result { valid: boolean, meta: object, errors: string[], warnings: string[] }
 */
export function validatePluginMeta(pluginDir, pluginName) {
  const metaPath = join(pluginDir, "plugin.meta.json");
  const errors = [];
  const warnings = [];
  
  // Check if meta file exists
  if (!existsSync(metaPath)) {
    warnings.push(`Missing plugin.meta.json - using defaults (experimental status)`);
    return {
      valid: true,
      meta: createDefaultMeta(pluginName),
      errors,
      warnings,
    };
  }
  
  // Parse meta file
  let meta;
  try {
    const content = readFileSync(metaPath, "utf-8");
    meta = JSON.parse(content);
  } catch (err) {
    errors.push(`Invalid JSON in plugin.meta.json: ${err.message}`);
    return { valid: false, meta: null, errors, warnings };
  }
  
  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!meta[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate name matches folder
  if (meta.name && meta.name !== pluginName) {
    errors.push(`Name mismatch: meta.name="${meta.name}" but folder="${pluginName}"`);
  }
  
  // Validate version format (semver)
  if (meta.version && !/^\d+\.\d+\.\d+/.test(meta.version)) {
    errors.push(`Invalid version format: ${meta.version} (expected semver)`);
  }
  
  // Validate status
  if (meta.status && !VALID_STATUSES.includes(meta.status)) {
    errors.push(`Invalid status: ${meta.status} (must be one of: ${VALID_STATUSES.join(", ")})`);
  }
  
  // Validate test level
  if (meta.testLevel && !VALID_TEST_LEVELS.includes(meta.testLevel)) {
    errors.push(`Invalid testLevel: ${meta.testLevel} (must be one of: ${VALID_TEST_LEVELS.join(", ")})`);
  }
  
  // Validate security scope
  if (meta.security?.scope && !VALID_SCOPES.includes(meta.security.scope)) {
    errors.push(`Invalid security.scope: ${meta.security.scope} (must be one of: ${VALID_SCOPES.join(", ")})`);
  }
  
  // Warnings for stable plugins
  if (meta.status === "stable") {
    if (meta.testLevel === "none") {
      warnings.push("Stable plugin should have testLevel >= unit");
    }
    if (!meta.resilience?.retry) {
      warnings.push("Stable plugin should implement retry logic");
    }
    if (!meta.documentation?.examples) {
      warnings.push("Stable plugin should have documented examples");
    }
  }
  
  // Apply defaults
  meta = applyDefaults(meta, pluginName);
  
  return {
    valid: errors.length === 0,
    meta,
    errors,
    warnings,
  };
}

/**
 * Create default metadata for plugins without meta file
 */
function createDefaultMeta(pluginName) {
  return applyDefaults({
    name: pluginName,
    version: "0.0.1",
    status: "experimental",
    owner: "unknown",
  }, pluginName);
}

/**
 * Apply default values to metadata
 */
function applyDefaults(meta, pluginName) {
  return {
    name: meta.name || pluginName,
    version: meta.version || "0.0.0",
    status: meta.status || "experimental",
    owner: meta.owner || "unknown",
    description: meta.description || "",
    requiresAuth: meta.requiresAuth ?? false,
    supportsJobs: meta.supportsJobs ?? false,
    supportsStreaming: meta.supportsStreaming ?? false,
    testLevel: meta.testLevel || "none",
    resilience: {
      retry: meta.resilience?.retry ?? false,
      timeout: meta.resilience?.timeout ?? 30000,
      circuitBreaker: meta.resilience?.circuitBreaker ?? false,
    },
    security: {
      scope: meta.security?.scope || "read",
      dangerousCombinations: meta.security?.dangerousCombinations || [],
      requiresApproval: meta.security?.requiresApproval ?? false,
    },
    performance: {
      avgResponseTimeMs: meta.performance?.avgResponseTimeMs || 0,
      maxConcurrent: meta.performance?.maxConcurrent ?? 10,
    },
    documentation: {
      readme: meta.documentation?.readme ?? true,
      examples: meta.documentation?.examples ?? false,
      apiReference: meta.documentation?.apiReference ?? false,
    },
    dependencies: meta.dependencies || [],
    envVars: meta.envVars || [],
  };
}

/**
 * Get quality tier summary for all plugins
 * @param {Array} plugins - Array of loaded plugin manifests
 * @returns {Object} Summary statistics
 */
export function getQualitySummary(plugins) {
  const summary = {
    total: plugins.length,
    byStatus: { stable: 0, beta: 0, experimental: 0 },
    byTestLevel: { none: 0, unit: 0, integration: 0, e2e: 0 },
    authRequired: 0,
    supportsJobs: 0,
    withResilience: 0,
    issues: [],
  };
  
  for (const plugin of plugins) {
    // Count by status
    if (plugin.status) {
      summary.byStatus[plugin.status] = (summary.byStatus[plugin.status] || 0) + 1;
    }
    
    // Count by test level
    if (plugin.testLevel) {
      summary.byTestLevel[plugin.testLevel] = (summary.byTestLevel[plugin.testLevel] || 0) + 1;
    }
    
    // Count features
    if (plugin.requiresAuth) summary.authRequired++;
    if (plugin.supportsJobs) summary.supportsJobs++;
    if (plugin.resilience?.retry) summary.withResilience++;
    
    // Flag issues
    if (plugin.status === "stable" && plugin.testLevel === "none") {
      summary.issues.push({
        plugin: plugin.name,
        severity: "warning",
        message: "Stable plugin without tests",
      });
    }
  }
  
  return summary;
}
