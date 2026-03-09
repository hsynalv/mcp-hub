/**
 * Policy Rules
 *
 * Default policy rules and rule engine for authorization decisions.
 */

import { allow, deny, PolicyCodes } from "./policy.result.js";
import { isDestructiveAction, inferScope } from "./policy.context.js";

/**
 * Policy Rule
 * @typedef {Object} PolicyRule
 * @property {string} name - Rule name
 * @property {string} description - Rule description
 * @property {Function} matches - Function(context) => boolean
 * @property {Function} evaluate - Function(context) => PolicyResult
 * @property {number} [priority=0] - Rule priority (higher = first)
 */

/**
 * Built-in policy rules
 */
export const DefaultRules = {
  /**
   * Allow read operations with read scope
   */
  readScope: {
    name: "read-scope",
    description: "Allow read operations with read scope",
    priority: 100,
    matches: (ctx) => {
      const scope = ctx.scope || inferScope(ctx.action, ctx.method);
      return scope === "read" &&
        ["read", "write", "admin"].includes(ctx.scope || "");
    },
    evaluate: (ctx) => allow({
      code: PolicyCodes.ALLOWED_READ_SCOPE,
      policy: "read-scope",
      metadata: { scope: ctx.scope },
    }),
  },

  /**
   * Allow write operations with write scope
   */
  writeScope: {
    name: "write-scope",
    description: "Allow write operations with write scope",
    priority: 90,
    matches: (ctx) => {
      const scope = ctx.scope || inferScope(ctx.action, ctx.method);
      return scope === "write" &&
        ["write", "admin"].includes(ctx.scope || "");
    },
    evaluate: (ctx) => allow({
      code: PolicyCodes.ALLOWED_WRITE_SCOPE,
      policy: "write-scope",
      metadata: { scope: ctx.scope },
    }),
  },

  /**
   * Deny destructive actions by default
   */
  destructiveDefaultDeny: {
    name: "destructive-default-deny",
    description: "Destructive operations require explicit authorization",
    priority: 200,
    matches: (ctx) => {
      return ctx.destructive ||
        isDestructiveAction(ctx.action, ctx.plugin);
    },
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_DESTRUCTIVE_ACTION,
      policy: "destructive-default-deny",
      reason: `Destructive action '${ctx.action}' requires explicit authorization`,
      metadata: {
        action: ctx.action,
        plugin: ctx.plugin,
        destructive: true,
      },
    }),
  },

  /**
   * Deny when in read-only mode
   */
  readOnlyMode: {
    name: "readonly-mode",
    description: "Deny write operations when in read-only mode",
    priority: 250,
    matches: (ctx) => ctx.readonly === true,
    evaluate: (ctx) => {
      const scope = ctx.scope || inferScope(ctx.action, ctx.method);
      if (scope !== "read") {
        return deny({
          code: PolicyCodes.DENIED_READONLY_MODE,
          policy: "readonly-mode",
          reason: "System is in read-only mode",
          metadata: { attemptedScope: scope },
        });
      }
      return null; // Pass through for read operations
    },
  },

  /**
   * Shell execution special handling
   */
  shellExecution: {
    name: "shell-execution",
    description: "Special handling for shell execution",
    priority: 300,
    matches: (ctx) => ctx.plugin === "shell" &&
      /execute|run|exec/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_SHELL_EXECUTION,
      policy: "shell-execution",
      reason: "Shell execution requires explicit authorization",
      metadata: {
        action: ctx.action,
        command: ctx.metadata?.command,
      },
    }),
  },

  /**
   * Secret resolution special handling
   */
  secretResolve: {
    name: "secret-resolve",
    description: "Special handling for secret resolution",
    priority: 300,
    matches: (ctx) => ctx.plugin === "secrets" &&
      /resolve|get|read/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_SECRET_RESOLVE,
      policy: "secret-resolve",
      reason: "Secret resolution requires explicit authorization",
      metadata: {
        action: ctx.action,
        secretName: ctx.metadata?.secretName,
      },
    }),
  },

  /**
   * Database write special handling
   */
  databaseWrite: {
    name: "database-write",
    description: "Special handling for database writes",
    priority: 280,
    matches: (ctx) => ctx.plugin === "database" &&
      /insert|update|delete|drop|create/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_DATABASE_WRITE,
      policy: "database-write",
      reason: "Database write operations require explicit authorization",
      metadata: {
        action: ctx.action,
        table: ctx.metadata?.table,
      },
    }),
  },

  /**
   * File delete special handling
   */
  fileDelete: {
    name: "file-delete",
    description: "Special handling for file deletion",
    priority: 280,
    matches: (ctx) => ctx.plugin === "file-storage" &&
      /delete|remove|unlink|rmdir/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_FILE_DELETE,
      policy: "file-delete",
      reason: "File deletion requires explicit authorization",
      metadata: {
        action: ctx.action,
        path: ctx.path,
      },
    }),
  },

  /**
   * Workspace modification special handling
   */
  workspaceModify: {
    name: "workspace-modify",
    description: "Special handling for workspace modification",
    priority: 260,
    matches: (ctx) => ctx.plugin === "workspace" &&
      /delete|archive|modify|update/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_DESTRUCTIVE_ACTION,
      policy: "workspace-modify",
      reason: "Workspace modification requires explicit authorization",
      metadata: {
        action: ctx.action,
        workspaceId: ctx.workspaceId,
      },
    }),
  },

  /**
   * RAG clear/reset special handling
   */
  ragClear: {
    name: "rag-clear",
    description: "Special handling for RAG clear operations",
    priority: 260,
    matches: (ctx) => ctx.plugin === "rag" &&
      /clear|reset|delete.*all/i.test(ctx.action),
    evaluate: (ctx) => deny({
      code: PolicyCodes.DENIED_DESTRUCTIVE_ACTION,
      policy: "rag-clear",
      reason: "RAG clear operation requires explicit authorization",
      metadata: {
        action: ctx.action,
        workspaceId: ctx.workspaceId,
      },
    }),
  },
};

/**
 * Rule Engine
 * Evaluates policy rules against context
 */
export class RuleEngine {
  constructor(options = {}) {
    this.rules = [];
    this.defaultDeny = options.defaultDeny !== false;
    this.logDecisions = options.logDecisions === true;
  }

  /**
   * Add a rule to the engine
   * @param {PolicyRule} rule - Rule to add
   */
  addRule(rule) {
    this.rules.push(rule);
    // Sort by priority (descending)
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Remove a rule by name
   * @param {string} name - Rule name
   */
  removeRule(name) {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  /**
   * Load default rules
   */
  loadDefaults() {
    Object.values(DefaultRules).forEach(rule => this.addRule(rule));
  }

  /**
   * Evaluate context against all rules
   * @param {PolicyContext} context - Policy context
   * @returns {PolicyResult}
   */
  evaluate(context) {
    for (const rule of this.rules) {
      try {
        if (rule.matches(context)) {
          const result = rule.evaluate(context);

          // If rule returns null, continue to next rule
          if (result === null) continue;

          if (this.logDecisions) {
            console.log(`[policy-rule] ${result.allowed ? "ALLOW" : "DENY"} by ${rule.name}: ${result.reason}`);
          }

          return result;
        }
      } catch (err) {
        console.error(`[policy-rule] Error evaluating rule ${rule.name}:`, err);
        // Continue to next rule on error (fail-safe)
      }
    }

    // No matching rule - use default
    if (this.logDecisions) {
      console.log(`[policy-rule] No matching rule, default ${this.defaultDeny ? "DENY" : "ALLOW"}`);
    }

    return this.defaultDeny
      ? deny({
        code: PolicyCodes.DENIED_DEFAULT,
        policy: "default",
        reason: "No matching policy rule found",
      })
      : allow({
        code: PolicyCodes.ALLOWED,
        policy: "default",
        reason: "No matching policy rule found, allowed by default",
      });
  }

  /**
   * Get list of loaded rules
   * @returns {Array<{name: string, description: string, priority: number}>}
   */
  listRules() {
    return this.rules.map(r => ({
      name: r.name,
      description: r.description,
      priority: r.priority || 0,
    }));
  }
}

/**
 * Create a custom rule
 * @param {Object} options - Rule options
 * @param {string} options.name - Rule name
 * @param {string} options.description - Rule description
 * @param {Function} options.condition - Function(context) => boolean
 * @param {'allow'|'deny'} options.effect - Rule effect
 * @param {string} options.reason - Reason message
 * @param {string} [options.code] - Policy code
 * @param {number} [options.priority=0] - Rule priority
 * @returns {PolicyRule}
 */
export function createRule(options) {
  const resultFn = options.effect === "allow" ? allow : deny;

  return {
    name: options.name,
    description: options.description,
    priority: options.priority || 0,
    matches: options.condition,
    evaluate: () => resultFn({
      code: options.code ||
        (options.effect === "allow" ? PolicyCodes.ALLOWED : PolicyCodes.DENIED_DEFAULT),
      policy: options.name,
      reason: options.reason,
    }),
  };
}

/**
 * Create a scoped rule that matches specific scopes
 * @param {Object} options - Rule options
 * @param {string[]} options.scopes - Allowed scopes
 * @param {string[]} options.actions - Allowed actions (optional)
 * @param {string[]} options.plugins - Allowed plugins (optional)
 * @param {number} [options.priority=50] - Rule priority
 * @returns {PolicyRule}
 */
export function createScopedRule(options) {
  return {
    name: options.name || `scoped-rule-${options.scopes.join("-")}`,
    description: options.description || `Allow ${options.scopes.join(", ")} scope operations`,
    priority: options.priority || 50,
    matches: (ctx) => {
      const scope = ctx.scope || inferScope(ctx.action, ctx.method);

      const scopeMatch = options.scopes.includes(scope);
      const actionMatch = !options.actions || options.actions.includes(ctx.action);
      const pluginMatch = !options.plugins || options.plugins.includes(ctx.plugin);

      return scopeMatch && actionMatch && pluginMatch;
    },
    evaluate: (ctx) => {
      const scope = ctx.scope || inferScope(ctx.action, ctx.method);
      return allow({
        code: scope === "read"
          ? PolicyCodes.ALLOWED_READ_SCOPE
          : scope === "write"
            ? PolicyCodes.ALLOWED_WRITE_SCOPE
            : PolicyCodes.ALLOWED,
        policy: options.name,
        metadata: { scope, action: ctx.action, plugin: ctx.plugin },
      });
    },
  };
}
