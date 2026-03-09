/**
 * Tool Discovery Types
 *
 * Type definitions for the tool discovery system.
 */

/**
 * Tool status enum values
 * @typedef {"experimental" | "beta" | "stable" | "deprecated"} ToolStatus
 */
export const ToolStatus = {
  EXPERIMENTAL: "experimental",
  BETA: "beta",
  STABLE: "stable",
  DEPRECATED: "deprecated",
};

/**
 * Valid tool statuses
 */
export const VALID_TOOL_STATUSES = Object.values(ToolStatus);

/**
 * @typedef {Object} ToolSchema
 * @property {string} [type] - JSON Schema type
 * @property {string} [description] - Schema description
 * @property {Object} [properties] - Schema properties
 * @property {string[]} [required] - Required fields
 * @property {Object} [examples] - Example values
 * @property {Object} [items] - Array items schema
 * @property {string[]} [enum] - Enum values
 */

/**
 * @typedef {Object} Tool
 * @property {string} name - Fully qualified tool name (plugin.tool)
 * @property {string} plugin - Plugin name
 * @property {string} tool - Tool name without plugin prefix
 * @property {string} description - Tool description
 * @property {string | null} category - Tool category
 * @property {string[]} scopes - Required scopes
 * @property {string[]} capabilities - Tool capabilities
 * @property {ToolSchema | null} inputSchema - Input JSON Schema
 * @property {ToolSchema | null} outputSchema - Output JSON Schema
 * @property {string | null} riskLevel - Risk level (low, medium, high, critical)
 * @property {ToolStatus} status - Tool maturity status
 * @property {boolean} productionReady - Production ready flag
 * @property {boolean} supportsAudit - Supports audit logging
 * @property {boolean} supportsPolicy - Supports policy checks
 * @property {string[]} [tags] - Tool tags
 * @property {string} [backend] - Backend/provider info
 * @property {string} [notes] - Additional notes
 * @property {Object} [examples] - Usage examples
 * @property {boolean} enabled - Whether tool is enabled (from plugin status)
 */

/**
 * @typedef {Object} ToolFilter
 * @property {string} [plugin] - Filter by plugin
 * @property {string} [scope] - Filter by required scope
 * @property {string} [capability] - Filter by capability
 * @property {ToolStatus} [status] - Filter by status
 * @property {string} [category] - Filter by category
 * @property {string[]} [tags] - Filter by tags
 * @property {boolean} [enabledOnly] - Only enabled tools
 */

/**
 * @typedef {Object} ToolListResult
 * @property {Tool[]} tools - List of tools
 * @property {number} total - Total count
 * @property {Object} [pagination] - Pagination info
 */

/**
 * @typedef {Object} ToolValidationResult
 * @property {boolean} valid - Whether tool is valid
 * @property {string[]} errors - Validation errors
 * @property {string[]} warnings - Validation warnings
 */

/**
 * @typedef {Object} ToolDiscoveryOptions
 * @property {boolean} [includeDisabled] - Include disabled plugin tools
 * @property {boolean} [normalizeSchema] - Normalize schemas
 * @property {boolean} [validate] - Validate tools
 */

/**
 * @typedef {Object} ToolPresenterOptions
 * @property {boolean} [includeSchema] - Include full schemas
 * @property {boolean} [compact] - Compact format
 * @property {string[]} [fields] - Specific fields to include
 */

export {};
