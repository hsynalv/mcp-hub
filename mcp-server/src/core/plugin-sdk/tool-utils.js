/**
 * Plugin SDK - Tool Registration Utilities
 *
 * Simplifies MCP tool definition and registration.
 */

import { registerTool } from "../tool-registry.js";
import { ToolTags } from "../tool-registry.js";

/**
 * Create a tool definition with standard structure.
 * @param {Object} def - Tool definition
 * @param {string} def.name - Tool name (snake_case)
 * @param {string} def.description - Human-readable description
 * @param {Object} [def.inputSchema] - JSON Schema for inputs
 * @param {Function} def.handler - async (args, context) => result
 * @param {string[]} [def.tags] - Tool tags (e.g. ToolTags.READ_ONLY)
 * @param {string} [def.plugin] - Plugin name (set at registration)
 * @returns {Object} Tool definition ready for registerTool
 */
export function createTool(def) {
  const { name, description, inputSchema = {}, handler, tags = [] } = def;
  if (!name || !description || !handler) {
    throw new Error("createTool requires name, description, and handler");
  }
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: inputSchema.properties || {},
      required: inputSchema.required || [],
      ...inputSchema,
    },
    handler,
    tags: Array.isArray(tags) ? tags : [tags],
  };
}

/**
 * Register multiple tools for a plugin.
 * @param {string} pluginName - Plugin identifier
 * @param {Object[]} tools - Array of tool definitions (from createTool or raw)
 * @param {Object} [options] - Options
 * @param {boolean} [options.wrapWithMetrics] - Wrap handlers with metrics (future)
 * @returns {number} Count of successfully registered tools
 */
export function registerTools(pluginName, tools, options = {}) {
  let count = 0;
  for (const tool of tools) {
    try {
      const def = tool.name && tool.handler ? tool : createTool(tool);
      registerTool({
        ...def,
        plugin: pluginName,
      });
      count++;
    } catch (err) {
      console.warn(`[plugin-sdk] Failed to register tool "${tool.name || "?"}" from "${pluginName}": ${err.message}`);
    }
  }
  return count;
}

export { ToolTags };
