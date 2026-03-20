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
 *     tags: string[] // read_only, write, destructive, needs_approval, BULK, NETWORK, LOCAL_FS, GIT, EXTERNAL_API
 *   }
 */

import { getApprovalStore } from "./policy-hooks.js";
import { executeRegisteredTool } from "./tool-execution/execute-tool.js";
import { ToolTags, VALID_TAGS as TOOL_TAG_VALUES } from "./tool-tags.js";

const tools = new Map();

export { ToolTags } from "./tool-tags.js";
export const VALID_TAGS = TOOL_TAG_VALUES;

/**
 * Validate tool according to MCP contract
 * Required fields: name, description, inputSchema
 * @param {Object} tool
 * @throws {Error} if validation fails
 */
export function validateTool(tool) {
  const errors = [];

  if (!tool.name || typeof tool.name !== "string") {
    errors.push("Tool must have a 'name' (string)");
  }

  if (!tool.description || typeof tool.description !== "string") {
    errors.push("Tool must have a 'description' (string)");
  }

  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    errors.push("Tool must have an 'inputSchema' (JSON Schema object)");
  } else {
    // Check if inputSchema has properties
    if (!tool.inputSchema.properties) {
      errors.push("Tool inputSchema should have 'properties' defined");
    }
    // Encourage explanation field for write/destructive tools
    const hasExplanation = tool.inputSchema.properties?.explanation;
    const isWriteTool = tool.tags?.some(tag => 
      ["write", "destructive", "DESTRUCTIVE", "WRITE"].includes(tag)
    );
    if (isWriteTool && !hasExplanation) {
      console.warn(`[tool-registry] Warning: Tool '${tool.name}' is a write/destructive tool but lacks 'explanation' field in inputSchema. Consider adding it so LLM can explain why it runs this tool.`);
    }
  }

  // Map legacy 'parameters' to 'inputSchema' if present
  if (tool.parameters && !tool.inputSchema) {
    console.warn(`[tool-registry] Tool '${tool.name}' uses deprecated 'parameters'. Mapping to 'inputSchema'.`);
    tool.inputSchema = tool.parameters;
    delete tool.parameters;
  }

  if (errors.length > 0) {
    throw new Error(`Tool validation failed for '${tool.name || "unknown"}':\n  - ${errors.join("\n  - ")}`);
  }
}

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
  // Validate according to MCP contract
  validateTool(tool);

  if (!tool.handler || typeof tool.handler !== "function") {
    throw new Error(`Tool '${tool.name}' must have a handler function`);
  }

  const validatedTags = validateTags(tool.tags);

  tools.set(tool.name, {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
    plugin: tool.plugin || "unknown",
    tags: validatedTags,
    ...(tool.timeoutMs != null ? { timeoutMs: tool.timeoutMs } : {}),
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
 * Get tool statistics for observability.
 * @returns {{ total: number, byPlugin: Object, categories: string[], byCategory: Object }}
 */
export function getToolStats() {
  const toolList = listTools();
  const byPlugin = {};
  const byCategory = {};

  for (const t of toolList) {
    const plugin = t.plugin || "unknown";
    byPlugin[plugin] = (byPlugin[plugin] || 0) + 1;
    if (t.tags?.length) {
      for (const tag of t.tags) {
        byCategory[tag] = (byCategory[tag] || 0) + 1;
      }
    }
  }

  return {
    total: toolList.length,
    byPlugin,
    categories: Object.keys(byCategory).sort(),
    byCategory,
  };
}

/**
 * Clear all tools (mainly for testing).
 */
export function clearTools() {
  tools.clear();
}

/**
 * Call a registered tool with hook support.
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
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
      meta: {
        ...(context.requestId != null ? { requestId: context.requestId } : {}),
        durationMs: 0,
      },
    };
  }

  return executeRegisteredTool({
    name,
    tool,
    args,
    context,
  });
}

/**
 * Approve a pending tool execution.
 * @param {string} approvalId - The approval ID
 * @param {Object} context - Approval context
 * @returns {Object} Approval result
 */
export async function approveTool(approvalId, context = {}) {
  const approvalStore = getApprovalStore();
  if (!approvalStore?.getApproval || !approvalStore?.updateApprovalStatus) {
    return {
      ok: false,
      error: {
        code: "policy_system_unavailable",
        message: "Policy system is not available",
      },
    };
  }

  const approval = approvalStore.getApproval(approvalId);
  if (!approval) {
    return {
      ok: false,
      error: {
        code: "approval_not_found",
        message: `Approval ID not found: ${approvalId}`,
      },
    };
  }

  if (approval.status !== "pending") {
    return {
      ok: false,
      error: {
        code: "approval_already_processed",
        message: `Approval already ${approval.status}`,
        approval: {
          id: approval.id,
          status: approval.status,
        },
      },
    };
  }

  // Update approval status
  approvalStore.updateApprovalStatus(
    approvalId,
    "approved",
    context.user || "manual"
  );

  // Re-execute the tool with the approval ID
  const toolName =
    approval.toolName || approval.path.replace("/tools/", "");
  const result = await callTool(toolName, approval.body, {
    ...context,
    approvalId,
    user: context.user || "agent",
  });

  return {
    ok: true,
    data: {
      approval: {
        id: approvalId,
        status: "approved",
        approvedBy: context.user || "manual",
      },
      result,
    },
  };
}

/**
 * Process startup hook slot (e.g. registerAfterExecutionHook from plugins).
 * Metrics and masked audit run inside executeRegisteredTool before plugin after-hooks.
 */
export function initializeToolHooks() {}

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
