/**
 * Tool Registry
 *
 * @deprecated MCP tools are in tool-registry.js. This registry uses the deprecated
 * plugin registry for discovery. Observability uses getToolStats() from tool-registry.js.
 */

import {
  discoverAllTools,
  getTool,
  getToolsByPlugin,
  getToolsByScope,
  getToolsByCapability,
  getToolsByCategory,
  searchTools,
  getToolStats,
} from "./tool.discovery.js";
import { VALID_TOOL_STATUSES } from "./tool.types.js";

/**
 * Tool Registry class
 */
export class ToolRegistry {
  constructor() {
    /** @type {Map<string, import("./tool.types.js").Tool>} */
    this.tools = new Map();
    this.initialized = false;
    this.lastRefresh = null;
  }

  /**
   * Initialize and discover all tools
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    await this.refresh();
    this.initialized = true;
  }

  /**
   * Refresh tool cache from plugins
   * @returns {Promise<void>}
   */
  async refresh() {
    const tools = await discoverAllTools();

    this.tools.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }

    this.lastRefresh = Date.now();
  }

  /**
   * Get all tools
   * @returns {import("./tool.types.js").Tool[]}
   */
  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool by name
   * @param {string} toolName
   * @returns {import("./tool.types.js").Tool | undefined}
   */
  get(toolName) {
    return this.tools.get(toolName);
  }

  /**
   * Check if tool exists
   * @param {string} toolName
   * @returns {boolean}
   */
  has(toolName) {
    return this.tools.has(toolName);
  }

  /**
   * Filter tools
   * @param {import("./tool.types.js").ToolFilter} filters
   * @returns {import("./tool.types.js").Tool[]}
   */
  filter(filters = {}) {
    let tools = this.getAll();

    if (filters.plugin) {
      tools = tools.filter(t => t.plugin === filters.plugin);
    }

    if (filters.scope) {
      tools = tools.filter(t => t.scopes.includes(filters.scope));
    }

    if (filters.capability) {
      tools = tools.filter(t => t.capabilities.includes(filters.capability));
    }

    if (filters.status) {
      tools = tools.filter(t => t.status === filters.status);
    }

    if (filters.category) {
      tools = tools.filter(t => t.category === filters.category);
    }

    if (filters.tags && filters.tags.length > 0) {
      tools = tools.filter(t =>
        filters.tags.some(tag => t.tags.includes(tag))
      );
    }

    if (filters.enabledOnly !== false) {
      tools = tools.filter(t => t.enabled);
    }

    return tools;
  }

  /**
   * Get tools by plugin
   * @param {string} pluginName
   * @returns {import("./tool.types.js").Tool[]}
   */
  getByPlugin(pluginName) {
    return this.getAll().filter(t => t.plugin === pluginName);
  }

  /**
   * Get tools by scope
   * @param {string} scope
   * @returns {import("./tool.types.js").Tool[]}
   */
  getByScope(scope) {
    return this.getAll().filter(t => t.scopes.includes(scope));
  }

  /**
   * Get tools by capability
   * @param {string} capability
   * @returns {import("./tool.types.js").Tool[]}
   */
  getByCapability(capability) {
    return this.getAll().filter(t => t.capabilities.includes(capability));
  }

  /**
   * Search tools
   * @param {string} query
   * @returns {import("./tool.types.js").Tool[]}
   */
  search(query) {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      (t.category && t.category.toLowerCase().includes(lowerQuery)) ||
      t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get tool categories
   * @returns {string[]}
   */
  getCategories() {
    const categories = new Set(
      this.getAll().map(t => t.category).filter(Boolean)
    );
    return Array.from(categories).sort();
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const tools = this.getAll();

    const stats = {
      total: tools.length,
      byStatus: {},
      byPlugin: {},
      byCategory: {},
      productionReady: 0,
      supportsAudit: 0,
      supportsPolicy: 0,
    };

    for (const tool of tools) {
      stats.byStatus[tool.status] = (stats.byStatus[tool.status] || 0) + 1;
      stats.byPlugin[tool.plugin] = (stats.byPlugin[tool.plugin] || 0) + 1;

      if (tool.category) {
        stats.byCategory[tool.category] = (stats.byCategory[tool.category] || 0) + 1;
      }

      if (tool.productionReady) stats.productionReady++;
      if (tool.supportsAudit) stats.supportsAudit++;
      if (tool.supportsPolicy) stats.supportsPolicy++;
    }

    return stats;
  }

  /**
   * Add or update a tool
   * @param {import("./tool.types.js").Tool} tool
   */
  set(tool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Remove a tool
   * @param {string} toolName
   * @returns {boolean}
   */
  delete(toolName) {
    return this.tools.delete(toolName);
  }

  /**
   * Clear all tools
   */
  clear() {
    this.tools.clear();
    this.lastRefresh = null;
  }

  /**
   * Check if initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get last refresh timestamp
   * @returns {number | null}
   */
  getLastRefresh() {
    return this.lastRefresh;
  }
}

/**
 * Create a tool registry
 * @returns {ToolRegistry}
 */
export function createToolRegistry() {
  return new ToolRegistry();
}

/**
 * Global registry instance
 * @type {ToolRegistry | null}
 */
let globalRegistry = null;

/**
 * Get or create global registry
 * @returns {ToolRegistry}
 */
export function getToolRegistry() {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}

/**
 * Set global registry
 * @param {ToolRegistry} registry
 */
export function setToolRegistry(registry) {
  globalRegistry = registry;
}
