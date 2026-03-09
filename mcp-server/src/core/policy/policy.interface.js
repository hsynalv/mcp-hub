/**
 * Policy Interface
 *
 * Base interface for policy evaluators.
 * Defines the contract that all policy implementations must follow.
 */

/**
 * Policy Context
 * @typedef {Object} PolicyContext
 * @property {string} actor - User/system identifier
 * @property {string|string[]} [actorRole] - Role(s) of the actor
 * @property {string} plugin - Plugin name
 * @property {string} action - Action being performed
 * @property {string} [resourceType] - Type of resource
 * @property {string} [resourceId] - Resource identifier
 * @property {string} workspaceId - Workspace identifier
 * @property {string} [projectId] - Project identifier
 * @property {string} [correlationId] - Request correlation ID
 * @property {Object} [metadata] - Additional context
 * @property {string} [scope] - Operation scope
 * @property {string} [backend] - Backend type
 * @property {string} [provider] - Provider name
 * @property {string} [operationType] - Type of operation
 * @property {boolean} [readonly] - Read-only flag
 * @property {boolean} [destructive] - Destructive operation flag
 * @property {string} [path] - Resource path
 * @property {string} [method] - HTTP method
 */

/**
 * Policy Result
 * @typedef {Object} PolicyResult
 * @property {boolean} allowed - Whether operation is allowed
 * @property {string} [reason] - Human-readable reason
 * @property {string} [code] - Machine-readable code
 * @property {string} [policy] - Policy that made the decision
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Abstract Policy Evaluator class
 * All policy evaluators must extend this class
 */
export class PolicyEvaluator {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.enabled = options.enabled !== false;
  }

  /**
   * Evaluate a policy decision
   * @abstract
   * @param {PolicyContext} context - Policy context
   * @returns {Promise<PolicyResult>|PolicyResult}
   */
  async evaluate(context) {
    throw new Error(`PolicyEvaluator ${this.name} must implement evaluate()`);
  }

  /**
   * Check if this evaluator can handle the given context
   * @param {PolicyContext} context - Policy context
   * @returns {boolean}
   */
  canEvaluate(context) {
    return true;
  }

  /**
   * Get evaluator priority (higher = evaluated first)
   * @returns {number}
   */
  getPriority() {
    return this.options.priority || 0;
  }

  /**
   * Enable/disable evaluator
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

/**
 * Policy Rule Definition
 * @typedef {Object} PolicyRule
 * @property {string} name - Rule name
 * @property {string} description - Rule description
 * @property {Function} condition - Function(context) => boolean
 * @property {'allow'|'deny'} effect - Rule effect
 * @property {string} [reason] - Deny reason
 * @property {string} [code] - Error code
 * @property {number} [priority] - Rule priority
 */

/**
 * Policy Configuration
 * @typedef {Object} PolicyConfig
 * @property {boolean} [strictMode] - Fail on missing context fields
 * @property {boolean} [defaultDeny] - Default to deny if no rule matches
 * @property {boolean} [logDecisions] - Log all policy decisions
 * @property {string[]} [trustedPlugins] - Plugins that bypass some checks
 * @property {Object} [customRules] - Custom rule definitions
 */
