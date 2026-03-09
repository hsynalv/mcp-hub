/**
 * Core Policy Module
 *
 * Centralized authorization and policy management for all plugins.
 */

// Policy interface
export { PolicyEvaluator } from "./policy.interface.js";

// Policy context
export {
  buildPolicyContext,
  isDestructiveAction,
  inferScope,
  extractPolicyContextFromRequest,
  validatePolicyContext,
  sanitizeContextForLogging,
} from "./policy.context.js";

// Policy result
export {
  allow,
  deny,
  fromBoolean,
  isAllowed,
  isDenied,
  isDestructiveDenial,
  isScopeDenial,
  formatForLogging,
  toErrorResponse,
  mergeResults,
  requireConfirmation,
  defaultResult,
  PolicyCodes,
} from "./policy.result.js";

// Policy rules
export {
  DefaultRules,
  RuleEngine,
  createRule,
  createScopedRule,
} from "./policy.rules.js";

// Policy manager
export {
  PolicyManager,
  getPolicyManager,
  initPolicyManager,
  authorize,
  isAllowed as checkIsAllowed,
  isDenied as checkIsDenied,
  requireAuth,
} from "./policy.manager.js";

// Policy helpers
export {
  canRead,
  canWrite,
  canDelete,
  canExecute,
  canResolveSecret,
  canQueryLLM,
  canQueryRag,
  canIngestRag,
  canModifyWorkspace,
  canAccessDatabase,
  canAccessFileStorage,
  requireRead,
  requireWrite,
  requireDelete,
  requireExecute,
  canReadBool,
  canWriteBool,
  canDeleteBool,
  canExecuteBool,
  canResolveSecretBool,
  canQueryLLMBool,
  canQueryRagBool,
  canIngestRagBool,
  canModifyWorkspaceBool,
  canAccessDatabaseBool,
  canAccessFileStorageBool,
} from "./policy.helpers.js";

// Configuration
export {
  getPolicyConfig,
  validatePolicyConfig,
  DEFAULT_POLICY_CONFIG,
  POLICY_ENV_DOCS,
} from "./policy.config.js";
