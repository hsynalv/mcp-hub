/**
 * Tenant Context Extraction
 *
 * Standard context extraction for tenant/workspace/project.
 */

import { extractTraceContext } from "../observability/tracing.js";

/**
 * Extract tenant context from HTTP request or object
 * @param {Object} req - Express request or headers object
 * @param {import("./tenant.types.js").ExtractContextOptions} [options]
 * @returns {import("./tenant.types.js").TenantContext}
 */
export function extractTenantContext(req, options = {}) {
  const headers = req.headers || req;
  const user = req.user || {};

  // Extract from headers
  const tenantId = headers["x-tenant-id"] || null;
  const workspaceId = headers["x-workspace-id"] || null;
  const projectId = headers["x-project-id"] || null;

  // Get actor info
  const actor = user.id || user.email || headers["x-actor"] || null;
  const roles = user.roles || extractRoles(headers["x-roles"]);

  // Get correlation ID from trace context
  const traceCtx = extractTraceContext(req);
  const correlationId = traceCtx.correlationId;

  const context = {
    actor,
    roles: Array.isArray(roles) ? roles : [],
    tenantId,
    workspaceId,
    projectId,
    correlationId,
  };

  // Validate if strict mode
  if (options.strict) {
    const validation = validateTenantContext(context, options.required);
    if (!validation.valid) {
      throw new Error(`Invalid tenant context: ${validation.errors.join(", ")}`);
    }
  }

  return context;
}

/**
 * Build tenant context from input
 * @param {Object} input
 * @param {string} [input.actor]
 * @param {string[]} [input.roles]
 * @param {string} [input.tenantId]
 * @param {string} [input.workspaceId]
 * @param {string} [input.projectId]
 * @param {string} [input.correlationId]
 * @returns {import("./tenant.types.js").TenantContext}
 */
export function buildTenantContext(input) {
  return {
    actor: input.actor || null,
    roles: input.roles || [],
    tenantId: input.tenantId || null,
    workspaceId: input.workspaceId || null,
    projectId: input.projectId || null,
    correlationId: input.correlationId || null,
  };
}

/**
 * Validate tenant context
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {string[]} [requiredFields] - Fields to require
 * @returns {import("./tenant.types.js").ValidationResult}
 */
export function validateTenantContext(context, requiredFields = []) {
  const errors = [];
  const warnings = [];

  if (!context || typeof context !== "object") {
    return { valid: false, errors: ["Context must be an object"], warnings: [] };
  }

  // Check required fields
  for (const field of requiredFields) {
    if (!context[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate ID formats
  if (context.tenantId && !isValidIdentifier(context.tenantId)) {
    errors.push(`Invalid tenantId format: ${context.tenantId}`);
  }

  if (context.workspaceId && !isValidIdentifier(context.workspaceId)) {
    errors.push(`Invalid workspaceId format: ${context.workspaceId}`);
  }

  if (context.projectId && !isValidIdentifier(context.projectId)) {
    errors.push(`Invalid projectId format: ${context.projectId}`);
  }

  // Warnings for inconsistent context
  if (context.projectId && !context.workspaceId) {
    warnings.push("projectId set but workspaceId is missing");
  }

  if (context.workspaceId && !context.tenantId) {
    warnings.push("workspaceId set but tenantId is missing");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if identifier is valid
 * @param {string} id
 * @returns {boolean}
 */
function isValidIdentifier(id) {
  if (typeof id !== "string") return false;

  // Only allow alphanumeric, underscore, hyphen
  // No path traversal, no special chars
  const validPattern = /^[a-zA-Z0-9_-]+$/;

  return validPattern.test(id) && id.length > 0 && id.length <= 128;
}

/**
 * Extract roles from header string
 * @param {string | undefined} rolesHeader
 * @returns {string[]}
 */
function extractRoles(rolesHeader) {
  if (!rolesHeader) return [];

  try {
    // Try JSON first
    const parsed = JSON.parse(rolesHeader);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall back to comma-separated
    return rolesHeader.split(",").map(r => r.trim()).filter(Boolean);
  }

  return [];
}

/**
 * Merge two tenant contexts
 * @param {import("./tenant.types.js").TenantContext} base
 * @param {Partial<import("./tenant.types.js").TenantContext>} override
 * @returns {import("./tenant.types.js").TenantContext}
 */
export function mergeTenantContext(base, override) {
  return {
    actor: override.actor ?? base.actor,
    roles: override.roles ?? base.roles,
    tenantId: override.tenantId ?? base.tenantId,
    workspaceId: override.workspaceId ?? base.workspaceId,
    projectId: override.projectId ?? base.projectId,
    correlationId: override.correlationId ?? base.correlationId,
  };
}

/**
 * Get empty/default context
 * @returns {import("./tenant.types.js").TenantContext}
 */
export function getEmptyTenantContext() {
  return {
    actor: null,
    roles: [],
    tenantId: null,
    workspaceId: null,
    projectId: null,
    correlationId: null,
  };
}

/**
 * Check if context is empty
 * @param {import("./tenant.types.js").TenantContext} context
 * @returns {boolean}
 */
export function isEmptyTenantContext(context) {
  return !context.tenantId && !context.workspaceId && !context.projectId;
}

/**
 * Format context for logging
 * @param {import("./tenant.types.js").TenantContext} context
 * @returns {string}
 */
export function formatTenantContext(context) {
  const parts = [];

  if (context.tenantId) parts.push(`t=${context.tenantId}`);
  if (context.workspaceId) parts.push(`w=${context.workspaceId}`);
  if (context.projectId) parts.push(`p=${context.projectId}`);
  if (context.actor) parts.push(`a=${context.actor}`);

  return parts.join(" ") || "no-tenant";
}
