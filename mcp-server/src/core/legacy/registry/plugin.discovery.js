/**
 * Plugin Discovery
 *
 * Automatic plugin discovery and validation from the plugins directory.
 */

import { readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validatePluginContract } from "../../plugins/plugin.contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default plugins directory
 */
export const DEFAULT_PLUGINS_DIR = join(__dirname, "../../../plugins");

/**
 * Check if path is a directory
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isDirectory(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if file exists
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if directory is a plugin (has index.js)
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
async function isPluginDir(dirPath) {
  const indexPath = join(dirPath, "index.js");
  return fileExists(indexPath);
}

/**
 * Scan plugins directory and return list of plugin directories
 * @param {string} pluginsDir
 * @param {string[]} [exclude]
 * @returns {Promise<string[]>}
 */
export async function scanPluginsDir(pluginsDir = DEFAULT_PLUGINS_DIR, exclude = []) {
  const entries = await readdir(pluginsDir);
  const plugins = [];

  for (const entry of entries) {
    if (exclude.includes(entry)) continue;

    const fullPath = join(pluginsDir, entry);
    if (await isDirectory(fullPath)) {
      if (await isPluginDir(fullPath)) {
        plugins.push(entry);
      }
    }
  }

  return plugins.sort();
}

/**
 * Validate plugin at path
 * @param {string} pluginName
 * @param {string} pluginsDir
 * @returns {Promise<import("./registry.types.js").PluginDiscoveryResult>}
 */
export async function validatePluginAtPath(pluginName, pluginsDir = DEFAULT_PLUGINS_DIR) {
  const pluginPath = join(pluginsDir, pluginName);

  try {
    // Check if index.js exists
    const indexPath = join(pluginPath, "index.js");
    if (!(await fileExists(indexPath))) {
      return {
        name: pluginName,
        path: pluginPath,
        valid: false,
        errors: ["Missing index.js"],
      };
    }

    // Dynamic import to load plugin
    const pluginModule = await import(indexPath);

    // Validate contract
    const validation = validatePluginContract(pluginModule);

    if (!validation.valid) {
      return {
        name: pluginName,
        path: pluginPath,
        valid: false,
        errors: validation.errors,
      };
    }

    return {
      name: pluginName,
      path: pluginPath,
      valid: true,
    };
  } catch (err) {
    return {
      name: pluginName,
      path: pluginPath,
      valid: false,
      errors: [err.message],
    };
  }
}

/**
 * Discover all plugins in directory
 * @param {string} pluginsDir
 * @param {Object} [options]
 * @param {boolean} [options.validate]
 * @param {string[]} [options.exclude]
 * @returns {Promise<import("./registry.types.js").PluginDiscoveryResult[]>}
 */
export async function discoverPlugins(
  pluginsDir = DEFAULT_PLUGINS_DIR,
  { validate = true, exclude = [] } = {}
) {
  const pluginNames = await scanPluginsDir(pluginsDir, exclude);
  const results = [];

  for (const name of pluginNames) {
    if (validate) {
      const result = await validatePluginAtPath(name, pluginsDir);
      results.push(result);
    } else {
      results.push({
        name,
        path: join(pluginsDir, name),
        valid: true,
      });
    }
  }

  return results;
}

/**
 * Get only valid plugins from discovery
 * @param {string} pluginsDir
 * @param {string[]} [exclude]
 * @returns {Promise<string[]>}
 */
export async function discoverValidPlugins(pluginsDir = DEFAULT_PLUGINS_DIR, exclude = []) {
  const results = await discoverPlugins(pluginsDir, { validate: true, exclude });
  return results.filter(r => r.valid).map(r => r.name);
}

/**
 * Check if plugin exists
 * @param {string} pluginName
 * @param {string} pluginsDir
 * @returns {Promise<boolean>}
 */
export async function pluginExists(pluginName, pluginsDir = DEFAULT_PLUGINS_DIR) {
  const pluginPath = join(pluginsDir, pluginName);
  const indexPath = join(pluginPath, "index.js");
  return fileExists(indexPath);
}
