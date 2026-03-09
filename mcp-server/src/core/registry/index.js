/**
 * Core Registry Module
 *
 * Central plugin management system exports.
 */

export { PluginRegistry, createRegistry, getRegistry, setRegistry } from "./plugin.registry.js";
export { loadPlugin, unloadPlugin, registerPlugin, extractToolNames } from "./plugin.loader.js";
export {
  discoverPlugins,
  discoverValidPlugins,
  validatePluginAtPath,
  pluginExists,
  DEFAULT_PLUGINS_DIR,
} from "./plugin.discovery.js";
export {
  enablePlugin,
  disablePlugin,
  reloadPlugin,
  getPlugin,
  getPlugins,
  getEnabledPlugins,
  isPluginEnabled,
  hasPlugin,
} from "./plugin.lifecycle.js";
