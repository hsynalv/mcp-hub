/**
 * Plugin Registry
 *
 * Central plugin management system for MCP-Hub platform.
 * Handles plugin discovery, lifecycle, health checks, and tool aggregation.
 */

import { discoverPlugins, DEFAULT_PLUGINS_DIR } from "./plugin.discovery.js";
import { loadPlugin, registerPlugin } from "./plugin.loader.js";
import {
  enablePlugin,
  disablePlugin,
  reloadPlugin,
  getPlugin,
  getPlugins,
  getEnabledPlugins,
} from "./plugin.lifecycle.js";

/**
 * @typedef {import("./registry.types.js").RegistryEntry} RegistryEntry
 * @typedef {import("./registry.types.js").RegistryOptions} RegistryOptions
 * @typedef {import("./registry.types.js").RegistryStatus} RegistryStatus
 * @typedef {import("./registry.types.js").HealthCheckResult} HealthCheckResult
 * @typedef {import("./registry.types.js").ToolDescriptor} ToolDescriptor
 */

/**
 * Plugin Registry class
 * Central management for all platform plugins
 */
export class PluginRegistry {
  /**
   * @param {RegistryOptions} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, RegistryEntry>} */
    this.registry = new Map();
    this.pluginsDir = options.pluginsDir || DEFAULT_PLUGINS_DIR;
    this.autoDiscover = options.autoDiscover !== false;
    this.lazyLoad = options.lazyLoad || false;
    this.exclude = options.exclude || [];
    this.initialized = false;
    this.app = null; // Express app reference
  }

  /**
   * Initialize registry and discover plugins
   * @param {import("express").Application} [app]
   * @returns {Promise<void>}
   */
  async init(app) {
    if (this.initialized) return;

    this.app = app;

    if (this.autoDiscover) {
      await this.discoverAndLoad();
    }

    this.initialized = true;
  }

  /**
   * Discover and load all plugins
   * @returns {Promise<void>}
   */
  async discoverAndLoad() {
    const results = await discoverPlugins(this.pluginsDir, {
      validate: true,
      exclude: this.exclude,
    });

    for (const result of results) {
      if (result.valid) {
        await this.load(result.name);
      } else {
        console.warn(`Plugin ${result.name} validation failed:`, result.errors);
      }
    }
  }

  /**
   * Load plugin into registry
   * @param {string} pluginName
   * @returns {Promise<boolean>}
   */
  async load(pluginName) {
    if (this.registry.has(pluginName)) {
      return true; // Already loaded
    }

    const result = await loadPlugin(pluginName, this.pluginsDir);

    if (!result.success) {
      console.error(`Failed to load plugin ${pluginName}:`, result.error);
      return false;
    }

    this.registry.set(pluginName, result.entry);
    return true;
  }

  /**
   * Enable plugin
   * @param {string} pluginName
   * @returns {Promise<boolean>}
   */
  async enable(pluginName) {
    const result = await enablePlugin(this.registry, pluginName, this.app);
    return result.success;
  }

  /**
   * Disable plugin
   * @param {string} pluginName
   * @returns {Promise<boolean>}
   */
  async disable(pluginName) {
    const result = await disablePlugin(this.registry, pluginName);
    return result.success;
  }

  /**
   * Reload plugin
   * @param {string} pluginName
   * @returns {Promise<boolean>}
   */
  async reload(pluginName) {
    const result = await reloadPlugin(this.registry, pluginName, this.pluginsDir, this.app);
    return result.success;
  }

  /**
   * Get plugin by name
   * @param {string} pluginName
   * @returns {RegistryEntry | undefined}
   */
  get(pluginName) {
    return getPlugin(this.registry, pluginName);
  }

  /**
   * Get all plugins
   * @returns {RegistryEntry[]}
   */
  getAll() {
    return getPlugins(this.registry);
  }

  /**
   * Get enabled plugins
   * @returns {RegistryEntry[]}
   */
  getEnabled() {
    return getEnabledPlugins(this.registry);
  }

  /**
   * Check if plugin exists
   * @param {string} pluginName
   * @returns {boolean}
   */
  has(pluginName) {
    return this.registry.has(pluginName);
  }

  /**
   * Check if plugin is enabled
   * @param {string} pluginName
   * @returns {boolean}
   */
  isEnabled(pluginName) {
    const entry = this.registry.get(pluginName);
    return entry ? entry.enabled : false;
  }

  /**
   * Get registry status summary
   * @returns {RegistryStatus}
   */
  getStatus() {
    const plugins = this.getAll();
    const enabled = plugins.filter(p => p.enabled);
    const loaded = plugins.filter(p => p.instance);
    const healthy = plugins.filter(p => p.health === "ok");
    const failed = plugins.filter(p => p.health === "failed");

    return {
      total: plugins.length,
      enabled: enabled.length,
      loaded: loaded.length,
      healthy: healthy.length,
      failed: failed.length,
      pluginNames: plugins.map(p => p.name),
    };
  }

  /**
   * Run health check on plugin
   * @param {string} pluginName
   * @returns {Promise<HealthCheckResult>}
   */
  async checkHealth(pluginName) {
    const entry = this.registry.get(pluginName);

    if (!entry) {
      return {
        name: pluginName,
        status: "failed",
        message: "Plugin not found",
        timestamp: Date.now(),
      };
    }

    if (!entry.enabled) {
      return {
        name: pluginName,
        status: "ok",
        message: "Plugin disabled",
        timestamp: Date.now(),
      };
    }

    if (!entry.healthCheck) {
      return {
        name: pluginName,
        status: entry.health,
        message: "No health check implemented",
        timestamp: Date.now(),
      };
    }

    try {
      const result = await entry.healthCheck();
      entry.health = result.status || "ok";

      return {
        name: pluginName,
        status: result.status || "ok",
        message: result.message,
        timestamp: Date.now(),
      };
    } catch (err) {
      entry.health = "failed";
      return {
        name: pluginName,
        status: "failed",
        message: err.message,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Run health checks on all enabled plugins
   * @returns {Promise<HealthCheckResult[]>}
   */
  async checkAllHealth() {
    const enabled = this.getEnabled();
    const results = await Promise.all(
      enabled.map(p => this.checkHealth(p.name))
    );
    return results;
  }

  /**
   * Get all tools from all plugins
   * @returns {ToolDescriptor[]}
   */
  getAllTools() {
    const tools = [];

    for (const entry of this.registry.values()) {
      if (!entry.enabled) continue;

      for (const toolName of entry.tools) {
        tools.push({
          name: `${entry.name}.${toolName}`,
          plugin: entry.name,
          tool: toolName,
          scopes: entry.scopes,
        });
      }
    }

    return tools;
  }

  /**
   * Get tools for specific plugin
   * @param {string} pluginName
   * @returns {ToolDescriptor[]}
   */
  getPluginTools(pluginName) {
    const entry = this.registry.get(pluginName);
    if (!entry || !entry.enabled) return [];

    return entry.tools.map(tool => ({
      name: `${entry.name}.${tool}`,
      plugin: entry.name,
      tool,
      scopes: entry.scopes,
    }));
  }

  /**
   * Get plugins by capability
   * @param {string} capability
   * @returns {RegistryEntry[]}
   */
  getByCapability(capability) {
    return this.getAll().filter(
      p => p.enabled && p.capabilities.includes(capability)
    );
  }

  /**
   * Get plugins by scope
   * @param {string} scope
   * @returns {RegistryEntry[]}
   */
  getByScope(scope) {
    return this.getAll().filter(
      p => p.enabled && p.scopes.includes(scope)
    );
  }
}

/**
 * Create and configure registry
 * @param {RegistryOptions} [options]
 * @returns {PluginRegistry}
 */
export function createRegistry(options = {}) {
  return new PluginRegistry(options);
}

/**
 * Global registry instance
 * @type {PluginRegistry | null}
 */
let globalRegistry = null;

/**
 * Get or create global registry
 * @param {RegistryOptions} [options]
 * @returns {PluginRegistry}
 */
export function getRegistry(options = {}) {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry(options);
  }
  return globalRegistry;
}

/**
 * Set global registry instance
 * @param {PluginRegistry} registry
 */
export function setRegistry(registry) {
  globalRegistry = registry;
}
