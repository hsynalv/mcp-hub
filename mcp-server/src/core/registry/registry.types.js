/**
 * Registry Types
 *
 * Type definitions for the plugin registry system.
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string} name - Plugin name
 * @property {string} version - Plugin version (semver)
 * @property {string} status - Plugin status (experimental, beta, stable, deprecated, sunset)
 * @property {boolean} enabled - Whether plugin is enabled
 * @property {import("../plugins/index.js").PluginMetadata} metadata - Full plugin metadata
 * @property {"ok" | "degraded" | "failed"} health - Health status
 * @property {string[]} tools - Tool names exported by plugin
 * @property {string[]} scopes - Scopes supported by plugin
 * @property {string[]} capabilities - Capabilities provided by plugin
 * @property {string} pluginPath - Path to plugin directory
 * @property {Object} [instance] - Loaded plugin module instance
 * @property {Function} [health] - Health check function
 */

/**
 * @typedef {Object} PluginDiscoveryResult
 * @property {string} name - Plugin name
 * @property {string} path - Plugin directory path
 * @property {boolean} valid - Whether plugin passed contract validation
 * @property {string[]} [errors] - Validation errors if invalid
 */

/**
 * @typedef {Object} PluginLoadResult
 * @property {boolean} success - Whether load succeeded
 * @property {string} [error] - Error message if failed
 * @property {RegistryEntry} [entry] - Registry entry if succeeded
 */

/**
 * @typedef {Object} HealthCheckResult
 * @property {string} name - Plugin name
 * @property {"ok" | "degraded" | "failed"} status - Health status
 * @property {string} [message] - Optional message
 * @property {number} [timestamp] - Check timestamp
 */

/**
 * @typedef {Object} ToolDescriptor
 * @property {string} name - Tool name (plugin.tool format)
 * @property {string} plugin - Plugin name
 * @property {string} tool - Tool name without prefix
 * @property {string} [description] - Tool description
 * @property {string[]} [scopes] - Required scopes
 */

/**
 * @typedef {Object} RegistryOptions
 * @property {string} pluginsDir - Directory to scan for plugins
 * @property {boolean} [autoDiscover] - Auto-discover plugins on init
 * @property {boolean} [lazyLoad] - Load plugins on first use
 * @property {string[]} [exclude] - Plugins to exclude
 */

/**
 * @typedef {Object} RegistryStatus
 * @property {number} total - Total registered plugins
 * @property {number} enabled - Enabled plugins
 * @property {number} loaded - Loaded plugins
 * @property {number} healthy - Healthy plugins
 * @property {number} failed - Failed plugins
 * @property {string[]} pluginNames - Names of all registered plugins
 */

export {};
