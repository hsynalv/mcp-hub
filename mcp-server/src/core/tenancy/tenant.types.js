/**
 * Tenant Types
 *
 * Type definitions for the tenancy/workspace model.
 */

/**
 * Tenant status values
 * @typedef {"active" | "suspended" | "deleted"} TenantStatus
 */
export const TenantStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
};

/**
 * Workspace status values
 * @typedef {"active" | "archived" | "deleted"} WorkspaceStatus
 */
export const WorkspaceStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted",
};

/**
 * @typedef {Object} Tenant
 * @property {string} tenantId - Unique tenant identifier
 * @property {string} [name] - Tenant display name
 * @property {TenantStatus} [status] - Tenant status
 * @property {string} [createdAt] - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} Workspace
 * @property {string} workspaceId - Unique workspace identifier
 * @property {string} tenantId - Parent tenant ID
 * @property {string} [name] - Workspace display name
 * @property {WorkspaceStatus} [status] - Workspace status
 * @property {string} [createdAt] - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} Project
 * @property {string} projectId - Unique project identifier
 * @property {string} workspaceId - Parent workspace ID
 * @property {string} tenantId - Parent tenant ID (denormalized)
 * @property {string} [name] - Project display name
 * @property {string} [status] - Project status
 * @property {string} [createdAt] - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} TenantContext
 * @property {string | null} actor - User/actor identifier
 * @property {string[]} roles - Actor roles
 * @property {string | null} tenantId - Tenant identifier
 * @property {string | null} workspaceId - Workspace identifier
 * @property {string | null} projectId - Project identifier
 * @property {string | null} correlationId - Correlation/trace ID
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string[]} errors - Validation errors
 * @property {string[]} warnings - Validation warnings
 */

/**
 * @typedef {Object} IsolationResult
 * @property {boolean} allowed - Whether access is allowed
 * @property {string} [reason] - Denial reason if not allowed
 * @property {string} [code] - Error code
 */

/**
 * @typedef {Object} ExtractContextOptions
 * @property {boolean} [strict] - Strict mode (fail on missing context)
 * @property {string[]} [required] - Required context fields
 * @property {boolean} [allowEmpty] - Allow empty/null values
 */

/**
 * @typedef {Object} TenantFilter
 * @property {string} [tenantId]
 * @property {string} [workspaceId]
 * @property {string} [projectId]
 * @property {TenantStatus} [status]
 * @property {string} [actor]
 */

export {};
