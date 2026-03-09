/**
 * Core Tools Module
 *
 * Tool Discovery API for MCP-Hub platform.
 */

// Types
export { ToolStatus, VALID_TOOL_STATUSES } from "./tool.types.js";

// Discovery
export {
  discoverAllTools,
  discoverToolsFromPlugin,
  getTool,
  getToolsByPlugin,
  getToolsByScope,
  getToolsByCapability,
  getToolsByCategory,
  getToolsByStatus,
  searchTools,
  getToolCategories,
  getToolStats,
  toolExists,
  refreshToolDiscovery,
} from "./tool.discovery.js";

// Schema
export {
  extractToolName,
  normalizeTool,
  normalizeSchema,
  extractInputParameters,
  getRequiredFields,
  generateExampleFromSchema,
  mergeTools,
} from "./tool.schema.js";

// Registry
export {
  ToolRegistry,
  createToolRegistry,
  getToolRegistry,
  setToolRegistry,
} from "./tool.registry.js";

// Validation
export {
  validateTool,
  validateMultipleTools,
  isValidTool,
  getMissingFields,
  assertValidTool,
} from "./tool.validation.js";

// Presenter
export {
  formatTool,
  formatTools,
  formatToolForAgent,
  formatToolForUI,
  formatToolList,
  formatSchemaForDisplay,
  formatToolStats,
  formatError,
  formatToolNotFound,
  createResponse,
} from "./tool.presenter.js";
