/**
 * Plugin Lifecycle
 *
 * Manages plugin lifecycle states: enable, disable, reload.
 */

import { loadPlugin, unloadPlugin, registerPlugin } from "./plugin.loader.js";
import { DEFAULT_PLUGINS_DIR } from "./plugin.discovery.js";

/**
 * Enable plugin
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @param {import("express").Application} [app]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function enablePlugin(registry, pluginName, app) {
  const entry = registry.get(pluginName);

  if (!entry) {
    return { success: false, error: `Plugin ${pluginName} not found` };
  }

  if (entry.enabled) {
    return { success: true }; // Already enabled
  }

  try {
    // Mark as enabled
    entry.enabled = true;

    // Register with Express if app provided
    if (app) {
      const registered = await registerPlugin(entry, app);
      if (!registered) {
        entry.enabled = false;
        return { success: false, error: "Failed to register plugin routes" };
      }
    }

    return { success: true };
  } catch (err) {
    entry.enabled = false;
    return { success: false, error: err.message };
  }
}

/**
 * Disable plugin
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function disablePlugin(registry, pluginName) {
  const entry = registry.get(pluginName);

  if (!entry) {
    return { success: false, error: `Plugin ${pluginName} not found` };
  }

  if (!entry.enabled) {
    return { success: true }; // Already disabled
  }

  try {
    // Unload plugin
    await unloadPlugin(entry);

    // Mark as disabled
    entry.enabled = false;
    entry.health = "ok";

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reload plugin
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @param {string} pluginsDir
 * @param {import("express").Application} [app]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function reloadPlugin(registry, pluginName, pluginsDir = DEFAULT_PLUGINS_DIR, app) {
  const entry = registry.get(pluginName);
  const wasEnabled = entry?.enabled || false;

  // Disable first if enabled
  if (wasEnabled) {
    const disableResult = await disablePlugin(registry, pluginName);
    if (!disableResult.success) {
      return disableResult;
    }
  }

  // Remove from registry
  registry.delete(pluginName);

  // Reload plugin
  const loadResult = await loadPlugin(pluginName, pluginsDir);
  if (!loadResult.success) {
    return { success: false, error: loadResult.error };
  }

  // Add back to registry
  registry.set(pluginName, loadResult.entry);

  // Re-enable if it was enabled
  if (wasEnabled && app) {
    return enablePlugin(registry, pluginName, app);
  }

  return { success: true };
}

/**
 * Get plugin from registry
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @returns {import("./registry.types.js").RegistryEntry | undefined}
 */
export function getPlugin(registry, pluginName) {
  return registry.get(pluginName);
}

/**
 * Get all plugins from registry
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @returns {import("./registry.types.js").RegistryEntry[]}
 */
export function getPlugins(registry) {
  return Array.from(registry.values());
}

/**
 * Get enabled plugins
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @returns {import("./registry.types.js").RegistryEntry[]}
 */
export function getEnabledPlugins(registry) {
  return getPlugins(registry).filter(p => p.enabled);
}

/**
 * Check if plugin is enabled
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @returns {boolean}
 */
export function isPluginEnabled(registry, pluginName) {
  const entry = registry.get(pluginName);
  return entry ? entry.enabled : false;
}

/**
 * Check if plugin exists in registry
 * @param {Map<string, import("./registry.types.js").RegistryEntry>} registry
 * @param {string} pluginName
 * @returns {boolean}
 */
export function hasPlugin(registry, pluginName) {
  return registry.has(pluginName);
}
