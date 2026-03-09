/**
 * Plugin Loader
 *
 * Handles dynamic loading and unloading of plugins.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validatePluginContract } from "../plugins/plugin.contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Default plugins directory
 */
const DEFAULT_PLUGINS_DIR = join(__dirname, "../../plugins");

/**
 * Load plugin module
 * @param {string} pluginName
 * @param {string} pluginsDir
 * @returns {Promise<import("./registry.types.js").PluginLoadResult>}
 */
export async function loadPlugin(pluginName, pluginsDir = DEFAULT_PLUGINS_DIR) {
  const pluginPath = join(pluginsDir, pluginName, "index.js");

  try {
    // Dynamic import
    const module = await import(pluginPath);

    // Validate contract
    const validation = validatePluginContract(module);
    if (!validation.valid) {
      return {
        success: false,
        error: `Contract validation failed: ${validation.errors.join(", ")}`,
      };
    }

    // Extract metadata
    const metadata = module.metadata || {};

    // Extract tools
    const tools = module.tools || [];
    const toolNames = tools.map(t => t.name || t).filter(Boolean);

    // Build registry entry
    const entry = {
      name: pluginName,
      version: metadata.version || "0.0.0",
      status: metadata.status || "experimental",
      enabled: false, // Not enabled until explicitly enabled
      metadata,
      health: "ok",
      tools: toolNames,
      scopes: metadata.scopes || ["read"],
      capabilities: metadata.capabilities || [],
      pluginPath: join(pluginsDir, pluginName),
      instance: module,
      healthCheck: module.health,
    };

    return {
      success: true,
      entry,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Unload plugin (cleanup)
 * @param {import("./registry.types.js").RegistryEntry} entry
 * @returns {Promise<boolean>}
 */
export async function unloadPlugin(entry) {
  if (!entry.instance) {
    return true;
  }

  try {
    // Call cleanup if available
    if (typeof entry.instance.cleanup === "function") {
      await entry.instance.cleanup();
    }

    // Clear instance reference
    entry.instance = null;

    return true;
  } catch (err) {
    console.error(`Failed to unload plugin ${entry.name}:`, err.message);
    return false;
  }
}

/**
 * Register plugin with Express app
 * @param {import("./registry.types.js").RegistryEntry} entry
 * @param {import("express").Application} app
 * @returns {Promise<boolean>}
 */
export async function registerPlugin(entry, app) {
  if (!entry.instance || !entry.enabled) {
    return false;
  }

  try {
    // Call register function
    if (typeof entry.instance.register === "function") {
      await entry.instance.register(app);
    }

    return true;
  } catch (err) {
    console.error(`Failed to register plugin ${entry.name}:`, err.message);
    entry.health = "failed";
    return false;
  }
}

/**
 * Unregister plugin from Express app
 * @param {import("./registry.types.js").RegistryEntry} entry
 * @returns {Promise<boolean>}
 */
export async function unregisterPlugin(entry) {
  // Currently no standard way to unregister from Express
  // Plugin should handle cleanup in its cleanup() function
  return unloadPlugin(entry);
}

/**
 * Extract tools from plugin instance
 * @param {import("./registry.types.js").RegistryEntry} entry
 * @returns {string[]}
 */
export function extractToolNames(entry) {
  if (!entry.instance) {
    return [];
  }

  const tools = entry.instance.tools || [];
  return tools.map(t => {
    if (typeof t === "string") return t;
    if (t.name) return t.name;
    return null;
  }).filter(Boolean);
}

/**
 * Reload plugin (unload + load)
 * @param {string} pluginName
 * @param {string} pluginsDir
 * @returns {Promise<import("./registry.types.js").PluginLoadResult>}
 */
export async function reloadPlugin(pluginName, pluginsDir = DEFAULT_PLUGINS_DIR) {
  // Load fresh
  return loadPlugin(pluginName, pluginsDir);
}
