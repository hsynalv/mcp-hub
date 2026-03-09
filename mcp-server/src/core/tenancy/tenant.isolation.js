/**
 * Tenant Isolation
 *
 * Isolation guards for cross-tenant/workspace access control.
 */

import { extractTenantContext } from "./tenant.context.js";

/**
 * Isolation error codes
 */
export const IsolationErrorCode = {
  TENANT_MISMATCH: "tenant_mismatch",
  WORKSPACE_MISMATCH: "workspace_mismatch",
  PROJECT_MISMATCH: "project_mismatch",
  MISSING_CONTEXT: "missing_context",
  INVALID_CONTEXT: "invalid_context",
  UNAUTHORIZED: "unauthorized",
};

/**
 * Check if tenant access is allowed
 * @param {import("./tenant.types.js").TenantContext} context - Request context
 * @param {string} targetTenantId - Target tenant ID
 * @returns {import("./tenant.types.js").IsolationResult}
 */
export function isTenantAccessAllowed(context, targetTenantId) {
  // Validate context
  if (!context || !context.tenantId) {
    return {
      allowed: false,
      reason: "Request context missing tenantId",
      code: IsolationErrorCode.MISSING_CONTEXT,
    };
  }

  // Validate target
  if (!targetTenantId) {
    return {
      allowed: false,
      reason: "Target tenantId not specified",
      code: IsolationErrorCode.MISSING_CONTEXT,
    };
  }

  // Check tenant match
  if (context.tenantId !== targetTenantId) {
    return {
      allowed: false,
      reason: `Tenant mismatch: ${context.tenantId} vs ${targetTenantId}`,
      code: IsolationErrorCode.TENANT_MISMATCH,
    };
  }

  return { allowed: true };
}

/**
 * Check if workspace access is allowed
 * @param {import("./tenant.types.js").TenantContext} context - Request context
 * @param {string} targetTenantId - Target tenant ID
 * @param {string} targetWorkspaceId - Target workspace ID
 * @returns {import("./tenant.types.js").IsolationResult}
 */
export function isWorkspaceAccessAllowed(context, targetTenantId, targetWorkspaceId) {
  // First check tenant
  const tenantCheck = isTenantAccessAllowed(context, targetTenantId);
  if (!tenantCheck.allowed) {
    return tenantCheck;
  }

  // Check workspace context
  if (!context.workspaceId) {
    return {
      allowed: false,
      reason: "Request context missing workspaceId",
      code: IsolationErrorCode.MISSING_CONTEXT,
    };
  }

  // Check workspace match
  if (context.workspaceId !== targetWorkspaceId) {
    return {
      allowed: false,
      reason: `Workspace mismatch: ${context.workspaceId} vs ${targetWorkspaceId}`,
      code: IsolationErrorCode.WORKSPACE_MISMATCH,
    };
  }

  return { allowed: true };
}

/**
 * Check if project access is allowed
 * @param {import("./tenant.types.js").TenantContext} context - Request context
 * @param {string} targetTenantId - Target tenant ID
 * @param {string} targetWorkspaceId - Target workspace ID
 * @param {string} targetProjectId - Target project ID
 * @returns {import("./tenant.types.js").IsolationResult}
 */
export function isProjectAccessAllowed(context, targetTenantId, targetWorkspaceId, targetProjectId) {
  // First check workspace
  const workspaceCheck = isWorkspaceAccessAllowed(context, targetTenantId, targetWorkspaceId);
  if (!workspaceCheck.allowed) {
    return workspaceCheck;
  }

  // Check project context
  if (!context.projectId) {
    return {
      allowed: false,
      reason: "Request context missing projectId",
      code: IsolationErrorCode.MISSING_CONTEXT,
    };
  }

  // Check project match
  if (context.projectId !== targetProjectId) {
    return {
      allowed: false,
      reason: `Project mismatch: ${context.projectId} vs ${targetProjectId}`,
      code: IsolationErrorCode.PROJECT_MISMATCH,
    };
  }

  return { allowed: true };
}

/**
 * Assert tenant access (throws if not allowed)
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {string} targetTenantId
 * @throws {Error}
 */
export function assertTenantAccess(context, targetTenantId) {
  const result = isTenantAccessAllowed(context, targetTenantId);

  if (!result.allowed) {
    const error = new Error(`Tenant access denied: ${result.reason}`);
    error.code = result.code;
    error.tenantId = targetTenantId;
    error.context = context;
    throw error;
  }
}

/**
 * Assert workspace access (throws if not allowed)
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {string} targetTenantId
 * @param {string} targetWorkspaceId
 * @throws {Error}
 */
export function assertWorkspaceAccess(context, targetTenantId, targetWorkspaceId) {
  const result = isWorkspaceAccessAllowed(context, targetTenantId, targetWorkspaceId);

  if (!result.allowed) {
    const error = new Error(`Workspace access denied: ${result.reason}`);
    error.code = result.code;
    error.tenantId = targetTenantId;
    error.workspaceId = targetWorkspaceId;
    error.context = context;
    throw error;
  }
}

/**
 * Assert project access (throws if not allowed)
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {string} targetTenantId
 * @param {string} targetWorkspaceId
 * @param {string} targetProjectId
 * @throws {Error}
 */
export function assertProjectAccess(context, targetTenantId, targetWorkspaceId, targetProjectId) {
  const result = isProjectAccessAllowed(context, targetTenantId, targetWorkspaceId, targetProjectId);

  if (!result.allowed) {
    const error = new Error(`Project access denied: ${result.reason}`);
    error.code = result.code;
    error.tenantId = targetTenantId;
    error.workspaceId = targetWorkspaceId;
    error.projectId = targetProjectId;
    error.context = context;
    throw error;
  }
}

/**
 * Check resource access with full context
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {Object} resource
 * @param {string} resource.tenantId
 * @param {string} [resource.workspaceId]
 * @param {string} [resource.projectId]
 * @returns {import("./tenant.types.js").IsolationResult}
 */
export function checkResourceAccess(context, resource) {
  if (!resource.tenantId) {
    return {
      allowed: false,
      reason: "Resource missing tenantId",
      code: IsolationErrorCode.MISSING_CONTEXT,
    };
  }

  // Check most specific first
  if (resource.projectId && resource.workspaceId) {
    return isProjectAccessAllowed(
      context,
      resource.tenantId,
      resource.workspaceId,
      resource.projectId
    );
  }

  if (resource.workspaceId) {
    return isWorkspaceAccessAllowed(context, resource.tenantId, resource.workspaceId);
  }

  return isTenantAccessAllowed(context, resource.tenantId);
}

/**
 * Assert resource access (throws if not allowed)
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {Object} resource
 * @throws {Error}
 */
export function assertResourceAccess(context, resource) {
  const result = checkResourceAccess(context, resource);

  if (!result.allowed) {
    const error = new Error(`Resource access denied: ${result.reason}`);
    error.code = result.code;
    error.resource = resource;
    error.context = context;
    throw error;
  }
}

/**
 * Create isolation middleware for Express
 * @param {Object} [options]
 * @param {boolean} [options.requireTenant] - Require tenant context
 * @param {boolean} [options.requireWorkspace] - Require workspace context
 * @returns {Function}
 */
export function createIsolationMiddleware(options = {}) {
  return (req, res, next) => {
    // Extract tenant context from request using already imported function
    const context = extractTenantContext(req);

    // Store context in request
    req.tenantContext = context;

    // Validate if required
    if (options.requireTenant && !context.tenantId) {
      return res.status(403).json({
        error: "Tenant context required",
        code: IsolationErrorCode.MISSING_CONTEXT,
      });
    }

    if (options.requireWorkspace && !context.workspaceId) {
      return res.status(403).json({
        error: "Workspace context required",
        code: IsolationErrorCode.MISSING_CONTEXT,
      });
    }

    next();
  };
}

/**
 * Check if context belongs to same tenant/workspace as resource
 * @param {import("./tenant.types.js").TenantContext} context
 * @param {Object} resource
 * @returns {boolean}
 */
export function isSameTenantWorkspace(context, resource) {
  const result = checkResourceAccess(context, resource);
  return result.allowed;
}
