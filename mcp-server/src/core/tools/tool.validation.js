/**
 * Tool Validation
 *
 * Validates tool definitions against the standard schema.
 */

import { VALID_TOOL_STATUSES } from "./tool.types.js";

/**
 * Required tool fields
 */
const REQUIRED_FIELDS = ["name", "plugin"];

/**
 * Recommended tool fields
 */
const RECOMMENDED_FIELDS = ["description", "scopes"];

/**
 * Validate a tool definition
 * @param {import("./tool.types.js").Tool} tool
 * @param {Object} [options]
 * @param {boolean} [options.strict] - Strict mode (recommended fields required)
 * @returns {import("./tool.types.js").ToolValidationResult}
 */
export function validateTool(tool, options = {}) {
  const errors = [];
  const warnings = [];

  if (!tool || typeof tool !== "object") {
    return {
      valid: false,
      errors: ["Tool must be an object"],
      warnings: [],
    };
  }

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!tool[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check name format
  if (tool.name && !tool.name.includes(".")) {
    errors.push(`Tool name must be fully qualified (plugin.tool format): ${tool.name}`);
  }

  // Check recommended fields
  if (options.strict) {
    for (const field of RECOMMENDED_FIELDS) {
      if (!tool[field]) {
        errors.push(`Missing recommended field in strict mode: ${field}`);
      }
    }
  } else {
    for (const field of RECOMMENDED_FIELDS) {
      if (!tool[field]) {
        warnings.push(`Missing recommended field: ${field}`);
      }
    }
  }

  // Validate status
  if (tool.status && !VALID_TOOL_STATUSES.includes(tool.status)) {
    errors.push(`Invalid status: ${tool.status}. Must be one of: ${VALID_TOOL_STATUSES.join(", ")}`);
  }

  // Validate scopes
  if (tool.scopes && !Array.isArray(tool.scopes)) {
    errors.push("scopes must be an array");
  }

  // Validate capabilities
  if (tool.capabilities && !Array.isArray(tool.capabilities)) {
    errors.push("capabilities must be an array");
  }

  // Validate tags
  if (tool.tags && !Array.isArray(tool.tags)) {
    errors.push("tags must be an array");
  }

  // Validate input schema
  if (tool.inputSchema) {
    const schemaErrors = validateSchema(tool.inputSchema, "inputSchema");
    errors.push(...schemaErrors);
  }

  // Validate output schema
  if (tool.outputSchema) {
    const schemaErrors = validateSchema(tool.outputSchema, "outputSchema");
    errors.push(...schemaErrors);
  }

  // Check productionReady consistency with status
  if (tool.productionReady && tool.status === "experimental") {
    warnings.push("Tool marked productionReady but status is experimental");
  }

  // Check for empty description
  if (tool.description && tool.description.length < 10) {
    warnings.push("Description is very short, consider adding more detail");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a JSON schema
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {string[]}
 */
function validateSchema(schema, fieldName) {
  const errors = [];

  if (typeof schema !== "object" || schema === null) {
    errors.push(`${fieldName} must be an object`);
    return errors;
  }

  // Check type field
  const validTypes = ["string", "number", "integer", "boolean", "array", "object", "null"];
  if (schema.type && !validTypes.includes(schema.type)) {
    errors.push(`${fieldName}.type must be one of: ${validTypes.join(", ")}`);
  }

  // Check properties for object type
  if (schema.type === "object" && schema.properties) {
    if (typeof schema.properties !== "object") {
      errors.push(`${fieldName}.properties must be an object`);
    }
  }

  // Check items for array type
  if (schema.type === "array" && schema.items) {
    if (typeof schema.items !== "object") {
      errors.push(`${fieldName}.items must be an object`);
    }
  }

  // Check required is an array
  if (schema.required && !Array.isArray(schema.required)) {
    errors.push(`${fieldName}.required must be an array`);
  }

  return errors;
}

/**
 * Validate multiple tools
 * @param {import("./tool.types.js").Tool[]} tools
 * @param {Object} [options]
 * @returns {Object}
 */
export function validateMultipleTools(tools, options = {}) {
  const results = {
    total: tools.length,
    valid: 0,
    invalid: 0,
    errors: [],
    byTool: new Map(),
  };

  for (const tool of tools) {
    const validation = validateTool(tool, options);

    results.byTool.set(tool.name, validation);

    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors.push({
        tool: tool.name,
        errors: validation.errors,
      });
    }
  }

  return results;
}

/**
 * Check if tool is valid (simple boolean check)
 * @param {import("./tool.types.js").Tool} tool
 * @returns {boolean}
 */
export function isValidTool(tool) {
  return validateTool(tool).valid;
}

/**
 * Get missing required fields
 * @param {import("./tool.types.js").Tool} tool
 * @returns {string[]}
 */
export function getMissingFields(tool) {
  const missing = [];

  for (const field of REQUIRED_FIELDS) {
    if (!tool[field]) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Assert tool is valid (throws if not)
 * @param {import("./tool.types.js").Tool} tool
 * @param {string} [message]
 * @throws {Error}
 */
export function assertValidTool(tool, message) {
  const validation = validateTool(tool);

  if (!validation.valid) {
    const errorMessage = message ||
      `Tool ${tool.name || "unknown"} is invalid: ${validation.errors.join(", ")}`;
    throw new Error(errorMessage);
  }
}
