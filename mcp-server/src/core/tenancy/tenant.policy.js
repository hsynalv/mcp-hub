/**
 * Tenant Policy Integration
 *
 * Integration between tenant context and policy infrastructure.
 */

import { IsolationErrorCode } from "./tenant.isolation.js";

/**
 * Create policy context from tenant context
 * @param {import("./tenant.types.js").TenantContext} tenantContext
 * @param {Object} [additionalContext]
 * @returns {Object} Policy context
 */
export function createPolicyContext(tenantContext, additionalContext = {}) {
  return {
    actor: tenantContext.actor,
    roles: tenantContext.roles,
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    projectId: tenantContext.projectId,
    correlationId: tenantContext.correlationId,
    ...additionalContext,
  };
}

/**
 * Check if action is allowed for tenant context
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {string} action
 * @param {Object} resource
 * @param {Function} policyChecker
 * @returns {Object}
 */
export function checkTenantPolicy(context, action, resource, policyChecker) {
  const policyContext = createPolicyContext(context);

  const result = policyChecker(action, resource, policyContext);

  // Enhance result with tenant-specific codes
  if (!result.allowed && result.reason) {
    if (result.reason.includes("tenant")) {
      result.code = IsolationErrorCode.TENANT_MISMATCH;
    } else if (result.reason.includes("workspace")) {
      result.code = IsolationErrorCode.WORKSPACE_MISMATCH;
    } else if (result.reason.includes("project")) {
      result.code = IsolationErrorCode.PROJECT_MISMATCH;
    }
  }

  return result;
}

/**
 * Policy reason codes for tenant violations
 */
export const TenantPolicyReason = {
  TENANT_MISMATCH: "tenant_mismatch",
  WORKSPACE_MISMATCH: "workspace_mismatch",
  PROJECT_MISMATCH: "project_mismatch",
  MISSING_TENANT_CONTEXT: "missing_tenant_context",
  INVALID_TENANT_ID: "invalid_tenant_id",
  INVALID_WORKSPACE_ID: "invalid_workspace_id",
  INVALID_PROJECT_ID: "invalid_project_id",
  TENANT_NOT_FOUND: "tenant_not_found",
  WORKSPACE_NOT_FOUND: "workspace_not_found",
  PROJECT_NOT_FOUND: "project_not_found",
  TENANT_SUSPENDED: "tenant_suspended",
  WORKSPACE_ARCHIVED: "workspace_archived",
  CROSS_TENANT_ACCESS: "cross_tenant_access",
  UNAUTHORIZED_ACTION: "unauthorized_action",
};

/**
 * Create tenant-aware policy middleware
 * @param {Object} [options]
 * @param {string[]} [options.requiredRoles]
 * @param {boolean} [options.requireTenant]
 * @returns {Function}
 */
export function createTenantPolicyMiddleware(options = {}) {
  return (req, res, next) => {
    const context = req.tenantContext;

    if (!context) {
      return res.status(403).json({
        error: "Tenant context not available",
        code: TenantPolicyReason.MISSING_TENANT_CONTEXT,
      });
    }

    // Check required tenant
    if (options.requireTenant && !context.tenantId) {
      return res.status(403).json({
        error: "Tenant context required",
        code: TenantPolicyReason.MISSING_TENANT_CONTEXT,
      });
    }

    // Check required roles
    if (options.requiredRoles && options.requiredRoles.length > 0) {
      const hasRole = options.requiredRoles.some(role =>
        context.roles.includes(role)
      );

      if (!hasRole) {
        return res.status(403).json({
          error: "Insufficient permissions",
          code: TenantPolicyReason.UNAUTHORIZED_ACTION,
          required: options.requiredRoles,
          has: context.roles,
        });
      }
    }

    next();
  };
}

/**
 * Format tenant policy error
 * @param {string} reason
 * @param {string} [code]
 * @param {Object} [details]
 * @returns {Object}
 */
export function formatTenantPolicyError(reason, code, details = null) {
  const error = {
    error: {
      message: reason,
      code: code || TenantPolicyReason.UNAUTHORIZED_ACTION,
    },
  };

  if (details) {
    error.error.details = details;
  }

  return error;
}

/**
 * Check if tenant is active
 * @param {import("./tenant.types.js").Tenant} tenant
 * @returns {boolean}
 */
export function isTenantActive(tenant) {
  return tenant && tenant.status === "active";
}

/**
 * Check if workspace is active
 * @param {import("./tenant.types.js").Workspace} workspace
 * @returns {boolean}
 */
export function isWorkspaceActive(workspace) {
  return workspace && workspace.status === "active";
}
