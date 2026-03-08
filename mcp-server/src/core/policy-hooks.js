/**
 * Policy Hooks
 *
 * Extension points for the policy system to register itself with core.
 * This breaks the circular dependency: core → plugins → core
 *
 * Architecture:
 *   - Core provides empty hooks
 *   - Policy plugin registers its functions at startup
 *   - Core uses hooks to call policy functions without direct imports
 */

let policyEvaluator = null;
let approvalStore = null;

/**
 * Register policy system hooks
 * Called by the policy plugin during initialization
 *
 * @param {Object} hooks
 * @param {Function} hooks.evaluate - Policy evaluation function
 * @param {Function} hooks.createApproval - Create approval request
 * @param {Function} hooks.updateApprovalStatus - Update approval status
 * @param {Function} hooks.getApproval - Get approval by ID
 * @param {Function} hooks.listApprovals - List approvals
 * @param {Function} hooks.loadPolicyConfig - Load policy configuration
 */
export function registerPolicyHooks({
  evaluate,
  createApproval,
  updateApprovalStatus,
  getApproval,
  listApprovals,
  loadPolicyConfig,
}) {
  policyEvaluator = evaluate;
  approvalStore = {
    createApproval,
    updateApprovalStatus,
    getApproval,
    listApprovals,
    loadPolicyConfig,
  };
  console.log("[policy-hooks] Policy system registered");
}

/** Get the policy evaluator function */
export function getPolicyEvaluator() {
  return policyEvaluator;
}

/** Get the approval store functions */
export function getApprovalStore() {
  return approvalStore;
}

/**
 * Check if policy system is registered
 * Used for graceful degradation if policy plugin is disabled
 */
export function isPolicySystemAvailable() {
  return policyEvaluator !== null && approvalStore !== null;
}
