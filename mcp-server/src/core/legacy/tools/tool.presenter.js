/**
 * Tool Presenter
 *
 * Formats tools for API responses and display.
 */

/**
 * Format tool for API response
 * @param {import("./tool.types.js").Tool} tool
 * @param {import("./tool.types.js").ToolPresenterOptions} [options]
 * @returns {Object}
 */
export function formatTool(tool, options = {}) {
  const { includeSchema = true, compact = false, fields = null } = options;

  // Base format
  const formatted = {
    name: tool.name,
    plugin: tool.plugin,
    description: tool.description,
    category: tool.category,
    status: tool.status,
    enabled: tool.enabled,
  };

  if (!compact) {
    formatted.scopes = tool.scopes;
    formatted.capabilities = tool.capabilities;
    formatted.riskLevel = tool.riskLevel;
    formatted.productionReady = tool.productionReady;
    formatted.supportsAudit = tool.supportsAudit;
    formatted.supportsPolicy = tool.supportsPolicy;
    formatted.tags = tool.tags;
  }

  if (includeSchema) {
    formatted.inputSchema = tool.inputSchema;
    formatted.outputSchema = tool.outputSchema;
  }

  if (!compact && tool.examples) {
    formatted.examples = tool.examples;
  }

  if (!compact && tool.notes) {
    formatted.notes = tool.notes;
  }

  // Filter fields if specified
  if (fields && Array.isArray(fields)) {
    const filtered = {};
    for (const field of fields) {
      if (formatted.hasOwnProperty(field)) {
        filtered[field] = formatted[field];
      }
    }
    return filtered;
  }

  return formatted;
}

/**
 * Format multiple tools
 * @param {import("./tool.types.js").Tool[]} tools
 * @param {import("./tool.types.js").ToolPresenterOptions} [options]
 * @returns {Object[]}
 */
export function formatTools(tools, options = {}) {
  return tools.map(t => formatTool(t, options));
}

/**
 * Format tool for agent/client (minimal)
 * @param {import("./tool.types.js").Tool} tool
 * @returns {Object}
 */
export function formatToolForAgent(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    scopes: tool.scopes,
    capabilities: tool.capabilities,
    examples: tool.examples,
  };
}

/**
 * Format tool for UI (rich)
 * @param {import("./tool.types.js").Tool} tool
 * @returns {Object}
 */
export function formatToolForUI(tool) {
  return {
    name: tool.name,
    plugin: tool.plugin,
    tool: tool.tool,
    description: tool.description,
    category: tool.category,
    status: tool.status,
    enabled: tool.enabled,
    scopes: tool.scopes,
    capabilities: tool.capabilities,
    riskLevel: tool.riskLevel,
    productionReady: tool.productionReady,
    supportsAudit: tool.supportsAudit,
    supportsPolicy: tool.supportsPolicy,
    tags: tool.tags,
    backend: tool.backend,
    notes: tool.notes,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    examples: tool.examples,
  };
}

/**
 * Format tool list result
 * @param {import("./tool.types.js").Tool[]} tools
 * @param {Object} [pagination]
 * @param {Object} [options]
 * @returns {Object}
 */
export function formatToolList(tools, pagination = null, options = {}) {
  const formatted = formatTools(tools, options);

  const result = {
    tools: formatted,
    total: tools.length,
  };

  if (pagination) {
    result.pagination = pagination;
  }

  return result;
}

/**
 * Format tool schema for display
 * @param {import("./tool.types.js").ToolSchema | null} schema
 * @returns {Object | null}
 */
export function formatSchemaForDisplay(schema) {
  if (!schema) return null;

  return {
    type: schema.type || "object",
    description: schema.description || "",
    properties: schema.properties || {},
    required: schema.required || [],
    examples: schema.examples || null,
    items: schema.items ? formatSchemaForDisplay(schema.items) : null,
    enum: schema.enum || null,
  };
}

/**
 * Format tool statistics
 * @param {Object} stats
 * @returns {Object}
 */
export function formatToolStats(stats) {
  return {
    total: stats.total,
    summary: {
      productionReady: stats.productionReady,
      supportsAudit: stats.supportsAudit,
      supportsPolicy: stats.supportsPolicy,
    },
    breakdown: {
      byStatus: stats.byStatus,
      byPlugin: stats.byPlugin,
      byCategory: stats.byCategory,
    },
  };
}

/**
 * Format error response
 * @param {string} message
 * @param {string} [code]
 * @param {Object} [details]
 * @returns {Object}
 */
export function formatError(message, code = "TOOL_ERROR", details = null) {
  const error = {
    error: {
      message,
      code,
    },
  };

  if (details) {
    error.error.details = details;
  }

  return error;
}

/**
 * Format tool not found error
 * @param {string} toolName
 * @returns {Object}
 */
export function formatToolNotFound(toolName) {
  return formatError(
    `Tool not found: ${toolName}`,
    "TOOL_NOT_FOUND",
    { toolName }
  );
}

/**
 * Create API response wrapper
 * @param {Object} data
 * @param {boolean} [success]
 * @returns {Object}
 */
export function createResponse(data, success = true) {
  return {
    success,
    ...data,
    timestamp: new Date().toISOString(),
  };
}
