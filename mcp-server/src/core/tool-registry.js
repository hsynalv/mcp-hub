/**
 * Tool Registry
 *
 * Central registry for MCP tools. Each plugin can register tools that are
 * available both via REST API and MCP protocol.
 *
 * Tool structure:
 *   {
 *     name: string,
 *     description: string,
 *     inputSchema: JSONSchema,
 *     handler: async (args, context) => result,
 *     plugin: string,
 *     tags: string[] // READ, WRITE, BULK, DESTRUCTIVE, NETWORK, LOCAL_FS, GIT, EXTERNAL_API
 *   }
 */

import { evaluate } from "../plugins/policy/policy.engine.js";

const tools = new Map();

/** Standard tool tags for policy and UX */
export const ToolTags = {
  READ: "READ",
  WRITE: "WRITE",
  BULK: "BULK",
  DESTRUCTIVE: "DESTRUCTIVE",
  NETWORK: "NETWORK",
  LOCAL_FS: "LOCAL_FS",
  GIT: "GIT",
  EXTERNAL_API: "EXTERNAL_API",
};

/** All valid tags */
export const VALID_TAGS = Object.values(ToolTags);

/**
 * Validate tags array
 * @param {string[]} tags
 * @returns {string[]} Validated tags
 */
export function validateTags(tags) {
  if (!tags || !Array.isArray(tags)) return [];
  return tags.filter((tag) => VALID_TAGS.includes(tag));
}

/**
 * Check if tool has a specific tag
 * @param {string} toolName
 * @param {string} tag
 * @returns {boolean}
 */
export function toolHasTag(toolName, tag) {
  const tool = tools.get(toolName);
  return tool?.tags?.includes(tag) || false;
}

/**
 * List tools filtered by tags
 * @param {string[]} includeTags - Tags to include (AND logic)
 * @param {string[]} excludeTags - Tags to exclude
 * @returns {Object[]}
 */
export function listToolsByTags(includeTags = [], excludeTags = []) {
  let result = Array.from(tools.values());

  if (includeTags.length > 0) {
    result = result.filter((tool) =>
      includeTags.every((tag) => tool.tags?.includes(tag))
    );
  }

  if (excludeTags.length > 0) {
    result = result.filter((tool) =>
      !excludeTags.some((tag) => tool.tags?.includes(tag))
    );
  }

  return result;
}

/**
 * Register a tool in the registry.
 * @param {Object} tool
 * @param {string} tool.name - Unique tool name (e.g., "github_list_repos")
 * @param {string} tool.description - Human-readable description
 * @param {Object} tool.inputSchema - JSON Schema for input validation
 * @param {Function} tool.handler - Async handler function(args, context)
 * @param {string} tool.plugin - Plugin name that owns this tool
 */
export function registerTool(tool) {
  if (!tool.name || typeof tool.name !== "string") {
    throw new Error("Tool must have a name");
  }
  if (!tool.handler || typeof tool.handler !== "function") {
    throw new Error("Tool must have a handler function");
  }

  const validatedTags = validateTags(tool.tags);

  tools.set(tool.name, {
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema || { type: "object" },
    handler: tool.handler,
    plugin: tool.plugin || "unknown",
    tags: validatedTags,
  });

  console.log(`[tool-registry] registered ${tool.name} [${validatedTags.join(", ") || "no tags"}]`);
}

/**
 * Unregister a tool.
 * @param {string} name
 */
export function unregisterTool(name) {
  tools.delete(name);
}

/**
 * Get a tool by name.
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getTool(name) {
  return tools.get(name);
}

/**
 * List all registered tools.
 * @returns {Object[]}
 */
export function listTools() {
  return Array.from(tools.values());
}

/**
 * Clear all tools (mainly for testing).
 */
export function clearTools() {
  tools.clear();
}

/**
 * Call a tool with the given arguments.
 * Performs policy check before executing the handler.
 *
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
 * @param {string} context.user - Requesting user identifier
 * @param {string} context.method - HTTP method or "MCP"
 * @param {string} context.projectId - Project ID (optional)
 * @param {string} context.projectEnv - Project environment (optional)
 * @returns {Promise<Object>} Tool result
 */
export async function callTool(name, args, context = {}) {
  const tool = tools.get(name);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: "tool_not_found",
        message: `Tool not found: ${name}`,
      },
    };
  }

  // Policy check before executing tool
  const path = `/tools/${name}`;
  const method = context.method || "POST";
  const policy = evaluate(method, path, args, context.user);

  if (!policy.allowed) {
    return {
      ok: false,
      error: {
        code: policy.action || "policy_denied",
        message: policy.explanation || "Request denied by policy",
        ...(policy.approval ? { approval: policy.approval } : {}),
        ...(policy.preview ? { preview: policy.preview } : {}),
      },
      meta: { requestId: context.requestId },
    };
  }

  try {
    const result = await tool.handler(args, context);

    // Normalize result to standard envelope if not already
    if (result && typeof result === "object") {
      if (result.ok === true || result.ok === false) {
        // Already in envelope format
        return result;
      }
    }

    // Wrap in success envelope
    return {
      ok: true,
      data: result,
      meta: { requestId: context.requestId },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || "tool_execution_error",
        message: err.message || "Tool execution failed",
        ...(err.details ? { details: err.details } : {}),
      },
      meta: { requestId: context.requestId },
    };
  }
}

/**
 * Convert Zod schema to JSON Schema (basic implementation).
 * Full implementation would use zod-to-json-schema package.
 *
 * @param {Object} zodSchema - Zod schema object
 * @returns {Object} JSON Schema
 */
export function zodToJsonSchema(zodSchema) {
  // Placeholder - actual implementation would use zod-to-json-schema
  // For now, return a permissive object schema
  if (zodSchema && zodSchema.shape) {
    const shape = zodSchema.shape;
    const properties = {};
    const required = [];

    for (const [key, value] of Object.entries(shape)) {
      const type = getZodType(value);
      properties[key] = { type };

      // Check if required (not optional)
      if (!isOptional(value)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: "object" };
}

function getZodType(zodType) {
  // Basic type detection - full implementation would be more comprehensive
  if (!zodType) return "string";

  // Check constructor name or _def.typeName
  const typeName = zodType._def?.typeName || zodType.constructor?.name;

  switch (typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
      return "object";
    case "ZodEnum":
      return "string";
    case "ZodOptional":
      return getZodType(zodType._def?.innerType);
    case "ZodDefault":
      return getZodType(zodType._def?.innerType);
    default:
      return "string";
  }
}

function isOptional(zodType) {
  if (!zodType) return false;
  const typeName = zodType._def?.typeName || zodType.constructor?.name;
  if (typeName === "ZodOptional") return true;
  if (typeName === "ZodDefault") return true;
  return false;
}
