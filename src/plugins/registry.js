/**
 * Plugin Registry - Loads and exposes plugins (n8n first, extensible for future plugins)
 * NO LLM calls - pure data/knowledge service
 */

const plugins = new Map();

/**
 * Register a plugin
 * @param {string} id - Plugin identifier (e.g. 'n8n')
 * @param {object} plugin - { tools, resources }
 */
export function registerPlugin(id, plugin) {
  if (plugins.has(id)) {
    console.warn(`Plugin ${id} already registered, overwriting`);
  }
  plugins.set(id, plugin);
}

/**
 * Get all registered plugins
 */
export function getPlugins() {
  return Object.fromEntries(plugins);
}

/**
 * Get tools from all plugins
 */
export function getAllTools() {
  const tools = [];
  for (const [pluginId, plugin] of plugins) {
    if (plugin.tools && Array.isArray(plugin.tools)) {
      for (const t of plugin.tools) {
        tools.push({ ...t, plugin: pluginId });
      }
    }
  }
  return tools;
}

/**
 * Get resources from all plugins
 */
export function getAllResources() {
  const resources = [];
  for (const [pluginId, plugin] of plugins) {
    if (plugin.resources && Array.isArray(plugin.resources)) {
      for (const r of plugin.resources) {
        resources.push({ ...r, plugin: pluginId });
      }
    }
  }
  return resources;
}

/**
 * Call a tool by name
 */
export async function callTool(name, args = {}) {
  const tools = getAllTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  const plugin = plugins.get(tool.plugin);
  if (!plugin?.callTool) {
    throw new Error(`Plugin ${tool.plugin} does not support tool execution`);
  }
  return plugin.callTool(name, args);
}

/**
 * Read a resource by URI
 */
export async function readResource(uri) {
  const resources = getAllResources();
  const resource = resources.find((r) => r.uri === uri || uri.startsWith(r.uri));
  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }
  const plugin = plugins.get(resource.plugin);
  if (!plugin?.readResource) {
    throw new Error(`Plugin ${resource.plugin} does not support resource reading`);
  }
  return plugin.readResource(uri);
}
