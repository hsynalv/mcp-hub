/**
 * Core Registry Module
 *
 * @deprecated Use plugins.js for plugin loading. This registry system is unused
 * during server startup. The canonical plugin loader is src/core/plugins.js.
 * Kept for backward compatibility with registry tests only.
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
