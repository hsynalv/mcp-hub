/**
 * Policy Manager
 *
 * Centralized authorization management for all plugins.
 */

import { PolicyEvaluator } from "./policy.interface.js";
import { RuleEngine } from "./policy.rules.js";
import {
  buildPolicyContext,
  validatePolicyContext,
  sanitizeContextForLogging,
} from "./policy.context.js";
import {
  allow,
  deny,
  isAllowed as isAllowedResult,
  PolicyCodes,
} from "./policy.result.js";

/**
 * @typedef {import("./policy.interface.js").PolicyContext} PolicyContext
 * @typedef {import("./policy.result.js").PolicyResult} PolicyResult
 */

/**
 * Policy Manager
 * Centralized authorization with fail-safe behavior
 */
export class PolicyManager {
  constructor(options = {}) {
    this.evaluators = [];
    this.ruleEngine = new RuleEngine({
      defaultDeny: options.defaultDeny !== false,
      logDecisions: options.logDecisions || false,
    });
    this.config = {
      strictMode: options.strictMode || false,
      defaultDeny: options.defaultDeny !== false,
      logDecisions: options.logDecisions || false,
      failSafe: options.failSafe !== false,
      trustedPlugins: options.trustedPlugins || [],
    };
    this.initialized = false;
    this.decisionCount = 0;
    this.allowCount = 0;
    this.denyCount = 0;
    this.errorCount = 0;
  }

  /**
   * Initialize the policy manager
   */
  async init() {
    if (this.initialized) return;

    // Load default rules
    this.ruleEngine.loadDefaults();

    this.initialized = true;
    console.log("[policy-manager] Initialized with", this.ruleEngine.listRules().length, "rules");
  }

  /**
   * Register a policy evaluator
   * @param {PolicyEvaluator} evaluator - Policy evaluator
   */
  registerEvaluator(evaluator) {
    if (!(evaluator instanceof PolicyEvaluator)) {
      throw new Error("Evaluator must extend PolicyEvaluator");
    }

    this.evaluators.push(evaluator);
    // Sort by priority (descending)
    this.evaluators.sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * Unregister a policy evaluator
   * @param {string} name - Evaluator name
   */
  unregisterEvaluator(name) {
    this.evaluators = this.evaluators.filter(e => e.name !== name);
  }

  /**
   * Add a custom rule to the rule engine
   * @param {import("./policy.rules.js").PolicyRule} rule
   */
  addRule(rule) {
    this.ruleEngine.addRule(rule);
  }

  /**
   * Remove a rule
   * @param {string} name - Rule name
   */
  removeRule(name) {
    this.ruleEngine.removeRule(name);
  }

  /**
   * Authorize an action
   * Fail-safe: returns deny on errors
   *
   * @param {PolicyContext|Object} context - Policy context
   * @returns {Promise<PolicyResult>}
   */
  async authorize(context) {
    if (!this.initialized) {
      await this.init();
    }

    this.decisionCount++;

    // Build and validate context
    const policyContext = buildPolicyContext(context, {
      strict: this.config.strictMode,
    });

    const validationError = validatePolicyContext(policyContext);
    if (validationError) {
      this.denyCount++;
      return deny({
        code: PolicyCodes.DENIED_INVALID_CONTEXT,
        reason: validationError,
        metadata: { validationError },
      });
    }

    try {
      // First, try custom evaluators
      for (const evaluator of this.evaluators) {
        if (!evaluator.enabled) continue;
        if (!evaluator.canEvaluate(policyContext)) continue;

        try {
          const result = await evaluator.evaluate(policyContext);

          if (this.config.logDecisions) {
            console.log(`[policy-manager] ${result.allowed ? "ALLOW" : "DENY"} by ${evaluator.name}: ${result.reason}`);
          }

          if (result.allowed) {
            this.allowCount++;
          } else {
            this.denyCount++;
          }

          return result;
        } catch (evalErr) {
          console.error(`[policy-manager] Evaluator ${evaluator.name} error:`, evalErr.message);
          // Continue to next evaluator
        }
      }

      // No evaluator matched, use rule engine
      const result = this.ruleEngine.evaluate(policyContext);

      if (this.config.logDecisions) {
        console.log(`[policy-manager] ${result.allowed ? "ALLOW" : "DENY"} by rule engine: ${result.reason}`);
      }

      if (result.allowed) {
        this.allowCount++;
      } else {
        this.denyCount++;
      }

      return result;
    } catch (err) {
      console.error("[policy-manager] Authorization error:", err);
      this.errorCount++;

      // Fail-safe: deny on error (unless configured otherwise)
      if (this.config.failSafe) {
        return deny({
          code: PolicyCodes.DENIED_DEFAULT,
          reason: "Authorization evaluation failed",
          metadata: { error: err.message },
        });
      }

      // Non-fail-safe: allow on error (not recommended)
      return allow({
        code: PolicyCodes.ALLOWED,
        reason: "Authorization evaluation failed, allowed by non-fail-safe mode",
        metadata: { error: err.message },
      });
    }
  }

  /**
   * Quick check if action is allowed
   * @param {PolicyContext|Object} context
   * @returns {Promise<boolean>}
   */
  async isAllowed(context) {
    const result = await this.authorize(context);
    return isAllowedResult(result);
  }

  /**
   * Quick check if action is denied
   * @param {PolicyContext|Object} context
   * @returns {Promise<boolean>}
   */
  async isDenied(context) {
    const result = await this.authorize(context);
    return !isAllowedResult(result);
  }

  /**
   * Require authorization or throw
   * @param {PolicyContext|Object} context
   * @param {string} [message] - Error message
   * @returns {Promise<PolicyResult>}
   */
  async require(context, message) {
    const result = await this.authorize(context);

    if (!isAllowedResult(result)) {
      const error = new Error(message || result.reason || "Authorization required");
      error.code = result.code;
      error.policy = result.policy;
      error.status = 403;
      throw error;
    }

    return result;
  }

  /**
   * Get manager statistics
   * @returns {Object}
   */
  getStats() {
    return {
      initialized: this.initialized,
      decisionCount: this.decisionCount,
      allowCount: this.allowCount,
      denyCount: this.denyCount,
      errorCount: this.errorCount,
      evaluatorCount: this.evaluators.length,
      ruleCount: this.ruleEngine.listRules().length,
      config: { ...this.config },
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.decisionCount = 0;
    this.allowCount = 0;
    this.denyCount = 0;
    this.errorCount = 0;
  }

  /**
   * List registered evaluators
   * @returns {Array<{name: string, priority: number, enabled: boolean}>}
   */
  listEvaluators() {
    return this.evaluators.map(e => ({
      name: e.name,
      priority: e.getPriority(),
      enabled: e.enabled,
    }));
  }

  /**
   * List loaded rules
   * @returns {Array<{name: string, description: string, priority: number}>}
   */
  listRules() {
    return this.ruleEngine.listRules();
  }
}

// Global singleton instance
let globalPolicyManager = null;

/**
 * Get or create the global policy manager
 * @param {Object} [config] - Configuration (only used on first call)
 * @returns {PolicyManager}
 */
export function getPolicyManager(config) {
  if (!globalPolicyManager) {
    globalPolicyManager = new PolicyManager(config);
  }
  return globalPolicyManager;
}

/**
 * Initialize the global policy manager
 * @param {Object} [config]
 * @returns {Promise<PolicyManager>}
 */
export async function initPolicyManager(config) {
  const manager = getPolicyManager(config);
  await manager.init();
  return manager;
}

/**
 * Authorize using global manager
 * @param {PolicyContext|Object} context
 * @returns {Promise<PolicyResult>}
 */
export async function authorize(context) {
  const manager = getPolicyManager();
  if (!manager.initialized) {
    await manager.init();
  }
  return await manager.authorize(context);
}

/**
 * Quick check using global manager
 * @param {PolicyContext|Object} context
 * @returns {Promise<boolean>}
 */
export async function isAllowed(context) {
  const manager = getPolicyManager();
  if (!manager.initialized) {
    await manager.init();
  }
  return await manager.isAllowed(context);
}

/**
 * Quick deny check using global manager
 * @param {PolicyContext|Object} context
 * @returns {Promise<boolean>}
 */
export async function isDenied(context) {
  const manager = getPolicyManager();
  if (!manager.initialized) {
    await manager.init();
  }
  return await manager.isDenied(context);
}

/**
 * Require authorization using global manager
 * @param {PolicyContext|Object} context
 * @param {string} [message]
 * @returns {Promise<PolicyResult>}
 */
export async function requireAuth(context, message) {
  const manager = getPolicyManager();
  if (!manager.initialized) {
    await manager.init();
  }
  return await manager.require(context, message);
}
