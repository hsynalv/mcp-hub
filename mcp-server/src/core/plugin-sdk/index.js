/**
 * Plugin SDK
 *
 * Reusable utilities for MCP-Hub plugin development.
 * Simplifies tool registration, config, validation, audit, and metrics.
 *
 * @example
 * import { createPlugin } from "@core/plugin-sdk";
 * import { createMetadata } from "@core/plugins";
 *
 * const { metadata, register, tools } = createPlugin("my-plugin", {
 *   description: "My plugin",
 *   endpoints: [...],
 * });
 *
 * export { metadata, register, tools };
 */

// Tool registration
export {
  createTool,
  registerTools,
  ToolTags,
} from "./tool-utils.js";

// Config loading
export {
  loadPluginConfig,
  createConfigSchema,
} from "./config-utils.js";

// Audit logging
export { createAuditHelper } from "./audit-utils.js";

// Request context
export { extractRequestContext } from "./context-utils.js";

// Validation - validateBodySync for manual validation; validateBody/validateQuery/validateParams are Express middlewares
export {
  validateBodySync,
  validateBody,
  validateQuery,
  validateParams,
} from "./validate-utils.js";

// Metrics
export { recordPluginMetric, withMetrics } from "./metrics-utils.js";

// Re-exports from core (plugins use these frequently)
export { createMetadata, PluginStatus, RiskLevel } from "../plugins/index.js";
export { createPluginErrorHandler } from "../error-standard.js";
export { requireScope } from "../auth.js";
