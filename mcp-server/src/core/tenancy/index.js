/**
 * Tenancy Module
 *
 * Workspace/Tenant model for MCP-Hub platform.
 */

// Types
export {
  TenantStatus,
  WorkspaceStatus,
} from "./tenant.types.js";

// Context
export {
  extractTenantContext,
  buildTenantContext,
  validateTenantContext,
  mergeTenantContext,
  getEmptyTenantContext,
  isEmptyTenantContext,
  formatTenantContext,
} from "./tenant.context.js";

// Validation
export {
  validateTenantId,
  validateWorkspaceId,
  validateProjectId,
  validateHierarchy,
  sanitizeTenantIdentifier,
  isValidTenantIdentifier,
  assertValidIdentifier,
  assertValidTenantId,
  assertValidWorkspaceId,
  assertValidProjectId,
  generateValidIdentifier,
} from "./tenant.validation.js";

// Isolation
export {
  IsolationErrorCode,
  isTenantAccessAllowed,
  isWorkspaceAccessAllowed,
  isProjectAccessAllowed,
  assertTenantAccess,
  assertWorkspaceAccess,
  assertProjectAccess,
  checkResourceAccess,
  assertResourceAccess,
  createIsolationMiddleware,
  isSameTenantWorkspace,
} from "./tenant.isolation.js";

// Policy
export {
  TenantPolicyReason,
  createPolicyContext,
  checkTenantPolicy,
  createTenantPolicyMiddleware,
  formatTenantPolicyError,
  isTenantActive,
  isWorkspaceActive,
} from "./tenant.policy.js";

// Registry
export {
  TenantRegistry,
  createTenantRegistry,
  getTenantRegistry,
  setTenantRegistry,
} from "./tenant.registry.js";
