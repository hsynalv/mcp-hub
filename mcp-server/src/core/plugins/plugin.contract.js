/**
 * Plugin Contract Standard
 *
 * Defines the expected exports and interface for all plugins.
 * This ensures consistent plugin loading, registration, and management.
 */

/**
 * Required exports for all plugins
 */
export const REQUIRED_PLUGIN_EXPORTS = [
  "metadata",
  "register",
];

/**
 * Optional but recommended exports
 */
export const OPTIONAL_PLUGIN_EXPORTS = [
  "tools",
  "health",
  "endpoints",
  "mcp",
  "audit",
  "config",
  "cleanup",
];

/**
 * All valid plugin exports
 */
export const ALL_PLUGIN_EXPORTS = [
  ...REQUIRED_PLUGIN_EXPORTS,
  ...OPTIONAL_PLUGIN_EXPORTS,
];

/**
 * Plugin contract schema
 * Defines the expected shape of plugin exports
 */
export const PLUGIN_CONTRACT_SCHEMA = {
  // Required exports
  metadata: {
    type: "object",
    required: true,
    description: "Plugin metadata following the metadata standard",
  },
  register: {
    type: "function",
    required: true,
    description: "Function to register plugin routes and handlers",
    signature: "(router, context) => void | Promise<void>",
  },

  // Optional exports
  tools: {
    type: "array",
    required: false,
    description: "MCP tools provided by plugin",
    items: {
      type: "object",
      properties: {
        name: { type: "string", required: true },
        description: { type: "string", required: true },
        parameters: { type: "object", required: true },
        handler: { type: "function", required: true },
      },
    },
  },
  health: {
    type: "function",
    required: false,
    description: "Health check function",
    signature: "() => {healthy: boolean, details?: object}",
  },
  endpoints: {
    type: "array",
    required: false,
    description: "OpenAPI endpoint definitions",
    items: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], required: true },
        path: { type: "string", required: true },
        description: { type: "string", required: true },
        scopes: { type: "array", items: { type: "string" } },
      },
    },
  },
  mcp: {
    type: "object",
    required: false,
    description: "MCP-specific configuration",
    properties: {
      prompts: { type: "array" },
      resources: { type: "array" },
    },
  },
  audit: {
    type: "object",
    required: false,
    description: "Audit logging configuration",
    properties: {
      logEntry: { type: "function" },
      getEntries: { type: "function" },
    },
  },
  config: {
    type: "object",
    required: false,
    description: "Plugin configuration schema and defaults",
    properties: {
      schema: { type: "object" },
      defaults: { type: "object" },
      validate: { type: "function" },
    },
  },
  cleanup: {
    type: "function",
    required: false,
    description: "Cleanup function called on shutdown",
    signature: "() => void | Promise<void>",
  },
};

/**
 * Plugin registration context
 * Passed to register() function
 */
export const REGISTRATION_CONTEXT_SCHEMA = {
  router: {
    type: "object",
    required: true,
    description: "Express router for registering routes",
  },
  logger: {
    type: "object",
    required: true,
    description: "Logger instance",
  },
  config: {
    type: "object",
    required: true,
    description: "Application configuration",
  },
  audit: {
    type: "object",
    required: false,
    description: "Audit manager instance",
  },
  policy: {
    type: "object",
    required: false,
    description: "Policy manager instance",
  },
  cache: {
    type: "object",
    required: false,
    description: "Cache manager instance",
  },
  workspace: {
    type: "object",
    required: false,
    description: "Workspace manager instance",
  },
};

/**
 * Validate that a plugin exports the required contract
 * @param {Object} pluginExports - The plugin's exports
 * @param {Object} options - Validation options
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validatePluginContract(pluginExports, options = {}) {
  const errors = [];
  const warnings = [];
  const { strict = false, checkOptional = false } = options;

  // Check required exports
  for (const exportName of REQUIRED_PLUGIN_EXPORTS) {
    if (!(exportName in pluginExports)) {
      errors.push(`Missing required export: ${exportName}`);
    } else {
      // Check type
      const expectedType = PLUGIN_CONTRACT_SCHEMA[exportName].type;
      const actualType = typeof pluginExports[exportName];

      if (expectedType === "function" && actualType !== "function") {
        errors.push(`Export '${exportName}' must be a function, got ${actualType}`);
      } else if (expectedType === "object" &&
                 (actualType !== "object" || pluginExports[exportName] === null)) {
        errors.push(`Export '${exportName}' must be an object, got ${actualType}`);
      }
    }
  }

  // Check optional exports if requested
  if (checkOptional) {
    for (const exportName of OPTIONAL_PLUGIN_EXPORTS) {
      if (exportName in pluginExports) {
        const expectedType = PLUGIN_CONTRACT_SCHEMA[exportName]?.type;
        const actualType = typeof pluginExports[exportName];

        if (expectedType && actualType !== expectedType &&
            !(expectedType === "object" && actualType === "object")) {
          warnings.push(`Export '${exportName}' expected type '${expectedType}', got '${actualType}'`);
        }
      }
    }
  }

  // Check for unknown exports in strict mode
  if (strict) {
    const knownExports = ALL_PLUGIN_EXPORTS;
    for (const exportName of Object.keys(pluginExports)) {
      if (!knownExports.includes(exportName)) {
        warnings.push(`Unknown export: ${exportName}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a plugin implements a specific optional export
 * @param {Object} pluginExports
 * @param {string} exportName
 * @returns {boolean}
 */
export function hasPluginExport(pluginExports, exportName) {
  return exportName in pluginExports &&
         pluginExports[exportName] !== undefined &&
         pluginExports[exportName] !== null;
}

/**
 * Get plugin capabilities based on exports
 * @param {Object} pluginExports
 * @returns {string[]}
 */
export function getPluginCapabilitiesFromExports(pluginExports) {
  const capabilities = [];

  if (hasPluginExport(pluginExports, "tools")) {
    capabilities.push("mcp-tools");
  }

  if (hasPluginExport(pluginExports, "health")) {
    capabilities.push("health-check");
  }

  if (hasPluginExport(pluginExports, "audit")) {
    capabilities.push("audit-logging");
  }

  if (hasPluginExport(pluginExports, "cleanup")) {
    capabilities.push("graceful-shutdown");
  }

  return capabilities;
}

/**
 * Create a standard plugin registration wrapper
 * @param {Object} pluginExports
 * @returns {Function} Wrapped register function
 */
export function wrapPluginRegistration(pluginExports) {
  const originalRegister = pluginExports.register;

  return async function wrappedRegister(router, context) {
    const { logger } = context;

    // Log registration start
    logger?.info?.(`Registering plugin: ${pluginExports.metadata?.name || "unknown"}`);

    try {
      // Validate contract before registration
      const validation = validatePluginContract(pluginExports);
      if (!validation.valid) {
        throw new Error(
          `Plugin contract validation failed: ${validation.errors.join(", ")}`
        );
      }

      // Call original register
      await originalRegister(router, context);

      // Log registration success
      logger?.info?.(`Plugin registered successfully: ${pluginExports.metadata?.name || "unknown"}`);
    } catch (error) {
      // Log registration failure
      logger?.error?.(`Plugin registration failed: ${pluginExports.metadata?.name || "unknown"}`, error);
      throw error;
    }
  };
}

/**
 * Plugin loader interface
 * Defines how plugins should be loaded
 */
export const PLUGIN_LOADER_INTERFACE = {
  /**
   * Load a plugin by name
   * @param {string} name - Plugin name
   * @returns {Promise<Object>} Plugin exports
   */
  load: async (_name) => {
    // Implementation should dynamically import the plugin
    throw new Error("Not implemented");
  },

  /**
   * List available plugins
   * @returns {Promise<string[]>} Plugin names
   */
  list: async () => {
    // Implementation should return list of available plugins
    throw new Error("Not implemented");
  },

  /**
   * Check if a plugin exists
   * @param {string} name - Plugin name
   * @returns {boolean}
   */
  exists: (_name) => {
    // Implementation should check if plugin exists
    throw new Error("Not implemented");
  },
};

/**
 * Plugin discovery interface
 * Defines how plugins are discovered and enumerated
 */
export const PLUGIN_DISCOVERY_INTERFACE = {
  /**
   * Discover all available plugins
   * @returns {Promise<Array<{name: string, metadata: object}>>}
   */
  discover: async () => {
    // Implementation should scan plugin directories
    throw new Error("Not implemented");
  },

  /**
   * Get plugin metadata without loading
   * @param {string} name - Plugin name
   * @returns {Promise<Object|null>}
   */
  getMetadata: async (_name) => {
    // Implementation should read metadata without full load
    throw new Error("Not implemented");
  },

  /**
   * Search plugins by criteria
   * @param {Object} criteria
   * @returns {Promise<Array>}
   */
  search: async (_criteria) => {
    // Implementation should filter plugins by criteria
    throw new Error("Not implemented");
  },
};

/**
 * Create a minimal plugin stub for testing
 * @param {Object} overrides
 * @returns {Object} Plugin exports
 */
export function createPluginStub(overrides = {}) {
  return {
    metadata: {
      name: "test-plugin",
      version: "1.0.0",
      description: "Test plugin",
      status: "experimental",
      ...overrides.metadata,
    },
    register: overrides.register || (async () => {}),
    ...(overrides.tools && { tools: overrides.tools }),
    ...(overrides.health && { health: overrides.health }),
    ...(overrides.endpoints && { endpoints: overrides.endpoints }),
    ...(overrides.cleanup && { cleanup: overrides.cleanup }),
  };
}

/**
 * Plugin contract version
 * Increment when contract changes
 */
export const PLUGIN_CONTRACT_VERSION = "1.0.0";

/**
 * Check if plugin contract version is compatible
 * @param {string} version
 * @returns {boolean}
 */
export function isCompatibleContractVersion(version) {
  // Simple semver check for now
  const [major] = version.split(".");
  const [currentMajor] = PLUGIN_CONTRACT_VERSION.split(".");
  return major === currentMajor;
}
