/**
 * Tool Schema Normalization
 *
 * Normalizes tool definitions from various plugin formats to standard format.
 */

import { ToolStatus } from "./tool.types.js";

/**
 * Extract tool name from various formats
 * @param {string | Object} tool - Tool name or definition
 * @returns {string | null}
 */
export function extractToolName(tool) {
  if (typeof tool === "string") {
    return tool;
  }

  if (typeof tool === "object" && tool !== null) {
    return tool.name || tool.id || null;
  }

  return null;
}

/**
 * Normalize a raw tool definition to standard format
 * @param {string | Object} rawTool - Raw tool from plugin
 * @param {import("../registry/registry.types.js").RegistryEntry} plugin - Plugin entry
 * @returns {import("./tool.types.js").Tool}
 */
export function normalizeTool(rawTool, plugin) {
  const pluginName = plugin.name;
  const toolName = extractToolName(rawTool);

  if (!toolName) {
    throw new Error("Tool name is required");
  }

  // Build full qualified name
  const fullName = toolName.includes(".") ? toolName : `${pluginName}.${toolName}`;

  // Get raw tool object if string
  const raw = typeof rawTool === "string" ? { name: toolName } : rawTool;

  // Extract metadata from plugin if not in tool
  const pluginMetadata = plugin.metadata || {};

  return {
    name: fullName,
    plugin: pluginName,
    tool: toolName,
    description: raw.description || `${pluginName} ${toolName} tool`,
    category: raw.category || null,
    scopes: raw.scopes || pluginMetadata.scopes || ["read"],
    capabilities: raw.capabilities || [],
    inputSchema: normalizeSchema(raw.inputSchema || raw.input || raw.parameters),
    outputSchema: normalizeSchema(raw.outputSchema || raw.output || raw.returns),
    riskLevel: raw.riskLevel || pluginMetadata.riskLevel || "medium",
    status: raw.status || pluginMetadata.status || ToolStatus.BETA,
    productionReady: raw.productionReady !== undefined
      ? raw.productionReady
      : pluginMetadata.productionReady || false,
    supportsAudit: raw.supportsAudit !== undefined
      ? raw.supportsAudit
      : pluginMetadata.supportsAudit || false,
    supportsPolicy: raw.supportsPolicy !== undefined
      ? raw.supportsPolicy
      : pluginMetadata.supportsPolicy || false,
    tags: raw.tags || [],
    backend: raw.backend || pluginMetadata.backend || null,
    notes: raw.notes || null,
    examples: raw.examples || null,
    enabled: plugin.enabled,
  };
}

/**
 * Normalize JSON Schema to standard format
 * @param {Object | null} schema - Raw schema
 * @returns {import("./tool.types.js").ToolSchema | null}
 */
export function normalizeSchema(schema) {
  if (!schema) {
    return null;
  }

  // If already a standard schema object
  if (typeof schema === "object") {
    // Ensure type field exists
    const normalized = {
      type: schema.type || "object",
      description: schema.description || "",
      properties: schema.properties || schema.fields || {},
    };

    // Add required if present
    if (schema.required || schema.requiredFields) {
      normalized.required = schema.required || schema.requiredFields;
    }

    // Add examples if present
    if (schema.examples || schema.example) {
      normalized.examples = schema.examples || [schema.example];
    }

    // Add items for arrays
    if (schema.items) {
      normalized.items = normalizeSchema(schema.items);
    }

    // Add enum if present
    if (schema.enum) {
      normalized.enum = schema.enum;
    }

    return normalized;
  }

  // If schema is a primitive type string
  if (typeof schema === "string") {
    return {
      type: schema,
      description: "",
    };
  }

  return null;
}

/**
 * Extract input parameter names from schema
 * @param {import("./tool.types.js").ToolSchema | null} schema
 * @returns {string[]}
 */
export function extractInputParameters(schema) {
  if (!schema || !schema.properties) {
    return [];
  }

  return Object.keys(schema.properties);
}

/**
 * Get required fields from schema
 * @param {import("./tool.types.js").ToolSchema | null} schema
 * @returns {string[]}
 */
export function getRequiredFields(schema) {
  if (!schema || !schema.required) {
    return [];
  }

  return Array.isArray(schema.required) ? schema.required : [];
}

/**
 * Generate example from schema
 * @param {import("./tool.types.js").ToolSchema | null} schema
 * @returns {Object | null}
 */
export function generateExampleFromSchema(schema) {
  if (!schema || !schema.properties) {
    return null;
  }

  const example = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.examples && prop.examples.length > 0) {
      example[key] = prop.examples[0];
    } else if (prop.example) {
      example[key] = prop.example;
    } else {
      // Generate simple example based on type
      example[key] = generateDefaultForType(prop.type, prop.enum);
    }
  }

  return example;
}

/**
 * Generate default value for a type
 * @param {string} type
 * @param {string[]} [enumValues]
 * @returns {any}
 */
function generateDefaultForType(type, enumValues) {
  if (enumValues && enumValues.length > 0) {
    return enumValues[0];
  }

  switch (type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
}

/**
 * Merge tool definitions
 * @param {import("./tool.types.js").Tool} base - Base tool
 * @param {Partial<import("./tool.types.js").Tool>} override - Override properties
 * @returns {import("./tool.types.js").Tool}
 */
export function mergeTools(base, override) {
  return {
    ...base,
    ...override,
    // Deep merge schemas
    inputSchema: override.inputSchema || base.inputSchema,
    outputSchema: override.outputSchema || base.outputSchema,
    // Merge arrays
    scopes: override.scopes || base.scopes,
    capabilities: override.capabilities || base.capabilities,
    tags: [...(base.tags || []), ...(override.tags || [])],
  };
}
