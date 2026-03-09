/**
 * Tool Discovery
 *
 * Discovers and aggregates tools from the plugin registry.
 */

import { getRegistry } from "../registry/index.js";
import { ToolStatus } from "./tool.types.js";
import { normalizeTool, extractToolName } from "./tool.schema.js";

/**
 * Discover all tools from enabled plugins
 * @param {import("./tool.types.js").ToolDiscoveryOptions} [options]
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function discoverAllTools(options = {}) {
  const registry = getRegistry();
  const plugins = registry.getEnabled();
  const tools = [];

  for (const plugin of plugins) {
    const pluginTools = await discoverToolsFromPlugin(plugin, options);
    tools.push(...pluginTools);
  }

  return tools;
}

/**
 * Discover tools from a specific plugin
 * @param {import("../registry/registry.types.js").RegistryEntry} plugin
 * @param {import("./tool.types.js").ToolDiscoveryOptions} [options]
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function discoverToolsFromPlugin(plugin, options = {}) {
  if (!plugin.enabled && !options.includeDisabled) {
    return [];
  }

  if (!plugin.instance || !plugin.instance.tools) {
    return [];
  }

  const rawTools = plugin.instance.tools;
  const tools = [];

  for (const rawTool of rawTools) {
    const tool = normalizeTool(rawTool, plugin);

    if (options.validate) {
      const { validateTool } = await import("./tool.validation.js");
      const validation = validateTool(tool);
      if (!validation.valid) {
        console.warn(`Tool ${tool.name} validation failed:`, validation.errors);
        continue;
      }
    }

    tools.push(tool);
  }

  return tools;
}

/**
 * Get a single tool by name
 * @param {string} toolName - Fully qualified tool name (plugin.tool)
 * @returns {Promise<import("./tool.types.js").Tool | null>}
 */
export async function getTool(toolName) {
  const [pluginName, toolShortName] = toolName.split(".");

  if (!pluginName || !toolShortName) {
    return null;
  }

  const registry = getRegistry();
  const plugin = registry.get(pluginName);

  if (!plugin || !plugin.enabled) {
    return null;
  }

  const tools = await discoverToolsFromPlugin(plugin);
  return tools.find(t => t.tool === toolShortName) || null;
}

/**
 * Get tools by plugin name
 * @param {string} pluginName
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function getToolsByPlugin(pluginName) {
  const registry = getRegistry();
  const plugin = registry.get(pluginName);

  if (!plugin || !plugin.enabled) {
    return [];
  }

  return discoverToolsFromPlugin(plugin);
}

/**
 * Get tools by required scope
 * @param {string} scope
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function getToolsByScope(scope) {
  const allTools = await discoverAllTools();
  return allTools.filter(tool => tool.scopes.includes(scope));
}

/**
 * Get tools by capability
 * @param {string} capability
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function getToolsByCapability(capability) {
  const allTools = await discoverAllTools();
  return allTools.filter(tool => tool.capabilities.includes(capability));
}

/**
 * Get tools by category
 * @param {string} category
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function getToolsByCategory(category) {
  const allTools = await discoverAllTools();
  return allTools.filter(tool => tool.category === category);
}

/**
 * Get tools by status
 * @param {ToolStatus} status
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function getToolsByStatus(status) {
  const allTools = await discoverAllTools();
  return allTools.filter(tool => tool.status === status);
}

/**
 * Search tools by query string
 * @param {string} query
 * @returns {Promise<import("./tool.types.js").Tool[]>}
 */
export async function searchTools(query) {
  const allTools = await discoverAllTools();
  const lowerQuery = query.toLowerCase();

  return allTools.filter(tool =>
    tool.name.toLowerCase().includes(lowerQuery) ||
    tool.description.toLowerCase().includes(lowerQuery) ||
    (tool.category && tool.category.toLowerCase().includes(lowerQuery)) ||
    tool.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get tool categories
 * @returns {Promise<string[]>}
 */
export async function getToolCategories() {
  const allTools = await discoverAllTools();
  const categories = new Set(
    allTools.map(t => t.category).filter(Boolean)
  );
  return Array.from(categories).sort();
}

/**
 * Get tool statistics
 * @returns {Promise<Object>}
 */
export async function getToolStats() {
  const allTools = await discoverAllTools();

  const stats = {
    total: allTools.length,
    byStatus: {},
    byPlugin: {},
    byCategory: {},
    productionReady: 0,
    supportsAudit: 0,
    supportsPolicy: 0,
  };

  for (const tool of allTools) {
    // By status
    stats.byStatus[tool.status] = (stats.byStatus[tool.status] || 0) + 1;

    // By plugin
    stats.byPlugin[tool.plugin] = (stats.byPlugin[tool.plugin] || 0) + 1;

    // By category
    if (tool.category) {
      stats.byCategory[tool.category] = (stats.byCategory[tool.category] || 0) + 1;
    }

    // Flags
    if (tool.productionReady) stats.productionReady++;
    if (tool.supportsAudit) stats.supportsAudit++;
    if (tool.supportsPolicy) stats.supportsPolicy++;
  }

  return stats;
}

/**
 * Check if tool exists
 * @param {string} toolName
 * @returns {Promise<boolean>}
 */
export async function toolExists(toolName) {
  const tool = await getTool(toolName);
  return tool !== null;
}

/**
 * Refresh tool discovery cache
 * Currently a no-op (no caching implemented)
 * @returns {Promise<void>}
 */
export async function refreshToolDiscovery() {
  // Future: Clear any caches
  return Promise.resolve();
}
