/**
 * Policy Context
 *
 * Standard policy context model for all plugins.
 * Provides common fields for authorization decisions.
 */

import { generateCorrelationId } from "../audit/index.js";

/**
 * Policy Context
 * @typedef {Object} PolicyContext
 * @property {string} actor - User/system identifier (required)
 * @property {string|string[]} [actorRole] - Role(s) of the actor
 * @property {string} plugin - Plugin name (required)
 * @property {string} action - Action being performed (required)
 * @property {string} [resourceType] - Type of resource
 * @property {string} [resourceId] - Resource identifier
 * @property {string} workspaceId - Workspace identifier (required)
 * @property {string} [projectId] - Project identifier
 * @property {string} [correlationId] - Request correlation ID
 * @property {Object} [metadata] - Additional context
 * @property {string} [scope] - Operation scope (read/write/admin)
 * @property {string} [backend] - Backend type
 * @property {string} [provider] - Provider name
 * @property {string} [operationType] - Type of operation
 * @property {boolean} [readonly] - Read-only flag
 * @property {boolean} [destructive] - Destructive operation flag
 * @property {string} [path] - Resource path
 * @property {string} [method] - HTTP method
 */

/**
 * Required context fields
 */
const REQUIRED_FIELDS = ["actor", "plugin", "action", "workspaceId"];

/**
 * Default values for context fields
 */
const DEFAULTS = {
  actorRole: [],
  resourceType: null,
  resourceId: null,
  projectId: null,
  correlationId: null,
  metadata: {},
  scope: "read",
  backend: null,
  provider: null,
  operationType: "standard",
  readonly: false,
  destructive: false,
  path: null,
  method: null,
};

/**
 * Build a policy context with defaults and validation
 * @param {Object} context - Raw context from plugin
 * @param {Object} options - Build options
 * @param {boolean} [options.strict=false] - Throw on missing required fields
 * @param {boolean} [options.generateCorrelationId=true] - Auto-generate correlation ID
 * @returns {PolicyContext}
 */
export function buildPolicyContext(context, options = {}) {
  const {
    strict = false,
    generateCorrelationId: generateCid = true,
  } = options;

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter(field => !context[field]);
  if (missing.length > 0) {
    const message = `Missing required context fields: ${missing.join(", ")}`;
    if (strict) {
      throw new Error(message);
    }
    console.warn(`[policy-context] ${message}`);
  }

  // Generate correlation ID if not provided
  const correlationId = context.correlationId ||
    (generateCid ? generateCorrelationId() : null);

  // Normalize actorRole to array
  const actorRole = Array.isArray(context.actorRole)
    ? context.actorRole
    : context.actorRole
      ? [context.actorRole]
      : DEFAULTS.actorRole;

  // Build complete context with defaults
  return {
    // Required fields
    actor: context.actor || "anonymous",
    plugin: context.plugin || "unknown",
    action: context.action || "unknown",
    workspaceId: context.workspaceId || "global",

    // Optional fields with defaults
    actorRole,
    resourceType: context.resourceType || DEFAULTS.resourceType,
    resourceId: context.resourceId || DEFAULTS.resourceId,
    projectId: context.projectId || DEFAULTS.projectId,
    correlationId,
    metadata: { ...DEFAULTS.metadata, ...(context.metadata || {}) },
    scope: context.scope || DEFAULTS.scope,
    backend: context.backend || DEFAULTS.backend,
    provider: context.provider || DEFAULTS.provider,
    operationType: context.operationType || DEFAULTS.operationType,
    readonly: context.readonly ?? DEFAULTS.readonly,
    destructive: context.destructive ?? DEFAULTS.destructive,
    path: context.path || DEFAULTS.path,
    method: context.method || DEFAULTS.method,
  };
}

/**
 * Check if an operation is considered destructive
 * @param {string} action - Action name
 * @param {string} [plugin] - Plugin name
 * @returns {boolean}
 */
export function isDestructiveAction(action, plugin) {
  const destructivePatterns = [
    /delete/i,
    /remove/i,
    /drop/i,
    /clear/i,
    /truncate/i,
    /execute/i,
    /exec/i,
    /run/i,
    /shell/i,
    /write.*overwrite/i,
    /force/i,
  ];

  const pluginSpecificDestructive = {
    shell: [/execute/, /run/, /exec/],
    database: [/drop/, /truncate/, /delete.*where/],
    "file-storage": [/delete/, /rmdir/, /unlink/],
    rag: [/clear/, /reset/],
    workspace: [/delete/, /archive/],
    secrets: [/delete/, /rotate/],
  };

  // Check generic patterns
  if (destructivePatterns.some(pattern => pattern.test(action))) {
    return true;
  }

  // Check plugin-specific patterns
  if (plugin && pluginSpecificDestructive[plugin]) {
    return pluginSpecificDestructive[plugin].some(pattern =>
      pattern.test(action)
    );
  }

  return false;
}

/**
 * Infer scope from action and method
 * @param {string} action - Action name
 * @param {string} [method] - HTTP method
 * @returns {string} - inferred scope: 'read' | 'write' | 'admin'
 */
export function inferScope(action, method) {
  const readActions = [/get/, /read/, /list/, /search/, /query/, /find/, /view/];
  const writeActions = [/create/, /insert/, /add/, /put/, /post/, /write/];
  const adminActions = [/delete/, /drop/, /truncate/, /admin/, /config/];

  // Check method first
  if (method) {
    const m = method.toLowerCase();
    if (["get", "head", "options"].includes(m)) return "read";
    if (["post", "put", "patch"].includes(m)) return "write";
    if (["delete"].includes(m)) return "admin";
  }

  // Check action patterns
  if (adminActions.some(p => p.test(action))) return "admin";
  if (writeActions.some(p => p.test(action))) return "write";
  if (readActions.some(p => p.test(action))) return "read";

  // Default to write for unknown actions (safe default)
  return "write";
}

/**
 * Extract policy context from request object
 * @param {Object} req - Express request object
 * @param {Object} options - Extraction options
 * @returns {PolicyContext}
 */
export function extractPolicyContextFromRequest(req, options = {}) {
  const user = req.user || req.actor || {};

  return buildPolicyContext({
    actor: user.id || user.email || req.headers["x-actor-id"] || "anonymous",
    actorRole: user.roles || user.role || req.headers["x-actor-roles"],
    plugin: options.plugin || req.params.plugin || "unknown",
    action: options.action || req.params.action || req.method?.toLowerCase(),
    resourceType: options.resourceType,
    resourceId: req.params.id || req.params.resourceId,
    workspaceId: req.headers["x-workspace-id"] ||
      req.body?.workspaceId ||
      req.query?.workspaceId ||
      "global",
    projectId: req.headers["x-project-id"] ||
      req.body?.projectId ||
      req.query?.projectId,
    correlationId: req.headers["x-correlation-id"] || req.correlationId,
    scope: options.scope,
    backend: options.backend,
    provider: options.provider,
    operationType: options.operationType,
    readonly: options.readonly,
    destructive: options.destructive ??
      isDestructiveAction(options.action || req.params.action, options.plugin),
    path: req.path,
    method: req.method,
    metadata: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      ...options.metadata,
    },
  }, options);
}

/**
 * Validate context has required fields
 * @param {PolicyContext} context - Context to validate
 * @returns {string|null} - Error message or null if valid
 */
export function validatePolicyContext(context) {
  const missing = REQUIRED_FIELDS.filter(field => !context[field]);
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(", ")}`;
  }

  // Type validation
  if (typeof context.readonly !== "boolean") {
    return "Field 'readonly' must be a boolean";
  }
  if (typeof context.destructive !== "boolean") {
    return "Field 'destructive' must be a boolean";
  }

  return null;
}

/**
 * Sanitize context for logging (remove sensitive metadata)
 * @param {PolicyContext} context - Original context
 * @returns {PolicyContext} - Sanitized context
 */
export function sanitizeContextForLogging(context) {
  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "apiKey",
    "credential",
    "auth",
  ];

  const sanitizedMetadata = Object.entries(context.metadata || {})
    .reduce((acc, [key, value]) => {
      const isSensitive = sensitiveKeys.some(sk =>
        key.toLowerCase().includes(sk.toLowerCase())
      );
      acc[key] = isSensitive ? "[REDACTED]" : value;
      return acc;
    }, {});

  return {
    ...context,
    metadata: sanitizedMetadata,
  };
}
