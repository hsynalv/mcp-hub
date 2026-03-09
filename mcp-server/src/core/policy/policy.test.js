/**
 * Policy System Tests
 *
 * Comprehensive tests for the core policy infrastructure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PolicyEvaluator,
} from "./policy.interface.js";
import {
  buildPolicyContext,
  isDestructiveAction,
  inferScope,
  validatePolicyContext,
  sanitizeContextForLogging,
} from "./policy.context.js";
import {
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
import {
  DefaultRules,
  RuleEngine,
  createRule,
  createScopedRule,
} from "./policy.rules.js";
import {
  PolicyManager,
  getPolicyManager,
  initPolicyManager,
  authorize,
} from "./policy.manager.js";
import {
  canRead,
  canWrite,
  canDelete,
  canExecute,
  canResolveSecret,
  canAccessDatabase,
  canAccessFileStorage,
} from "./policy.helpers.js";
import {
  getPolicyConfig,
  validatePolicyConfig,
  DEFAULT_POLICY_CONFIG,
} from "./policy.config.js";

describe("Policy System", () => {
  describe("PolicyContext", () => {
    describe("buildPolicyContext", () => {
      it("should build context with required fields", () => {
        const ctx = buildPolicyContext({
          actor: "user123",
          plugin: "test",
          action: "read",
        });

        expect(ctx.actor).toBe("user123");
        expect(ctx.plugin).toBe("test");
        expect(ctx.action).toBe("read");
        expect(ctx.correlationId).toBeDefined();
        expect(ctx.timestamp).toBeDefined();
      });

      it("should infer scope from action", () => {
        const readCtx = buildPolicyContext({ action: "read" });
        expect(readCtx.scope).toBe("read");

        const writeCtx = buildPolicyContext({ action: "write" });
        expect(writeCtx.scope).toBe("write");

        const deleteCtx = buildPolicyContext({ action: "delete" });
        expect(deleteCtx.scope).toBe("admin");
      });

      it("should detect destructive actions", () => {
        const ctx = buildPolicyContext({ action: "rm -rf /" });
        expect(ctx.destructive).toBe(true);
      });

      it("should merge with defaults", () => {
        const ctx = buildPolicyContext({
          actor: "user",
          plugin: "test",
          action: "read",
        });

        expect(ctx.workspaceId).toBe("global");
        expect(ctx.projectId).toBeNull();
        expect(ctx.metadata).toEqual({});
      });
    });

    describe("isDestructiveAction", () => {
      it("should detect rm commands", () => {
        expect(isDestructiveAction("rm -rf /")).toBe(true);
        expect(isDestructiveAction("rm file.txt")).toBe(true);
      });

      it("should detect drop commands", () => {
        expect(isDestructiveAction("DROP TABLE users")).toBe(true);
      });

      it("should not flag read operations", () => {
        expect(isDestructiveAction("ls -la")).toBe(false);
        expect(isDestructiveAction("SELECT * FROM users")).toBe(false);
      });
    });

    describe("inferScope", () => {
      it("should infer read scope", () => {
        expect(inferScope("read", "GET")).toBe("read");
        expect(inferScope("list", "GET")).toBe("read");
        expect(inferScope("fetch")).toBe("read");
      });

      it("should infer write scope", () => {
        expect(inferScope("write", "POST")).toBe("write");
        expect(inferScope("create", "POST")).toBe("write");
        expect(inferScope("update", "PUT")).toBe("write");
      });

      it("should infer admin scope for destructive actions", () => {
        expect(inferScope("delete", "DELETE")).toBe("admin");
        expect(inferScope("drop")).toBe("admin");
      });
    });

    describe("validatePolicyContext", () => {
      it("should validate required fields", () => {
        const result = validatePolicyContext({
          actor: "user",
          plugin: "test",
          action: "read",
        });
        expect(result).toBeNull();
      });

      it("should reject missing actor", () => {
        const result = validatePolicyContext({
          plugin: "test",
          action: "read",
        });
        expect(result).toContain("actor");
      });

      it("should reject missing plugin", () => {
        const result = validatePolicyContext({
          actor: "user",
          action: "read",
        });
        expect(result).toContain("plugin");
      });

      it("should reject missing action", () => {
        const result = validatePolicyContext({
          actor: "user",
          plugin: "test",
        });
        expect(result).toContain("action");
      });
    });

    describe("sanitizeContextForLogging", () => {
      it("should mask sensitive data", () => {
        const ctx = {
          actor: "user",
          action: "read",
          metadata: { password: "secret123", token: "abc" },
        };
        const sanitized = sanitizeContextForLogging(ctx);

        expect(sanitized.metadata.password).toBe("***");
        expect(sanitized.metadata.token).toBe("***");
      });
    });
  });

  describe("PolicyResult", () => {
    describe("allow", () => {
      it("should create allow result", () => {
        const result = allow({ code: PolicyCodes.ALLOWED });
        expect(result.allowed).toBe(true);
        expect(result.code).toBe(PolicyCodes.ALLOWED);
        expect(result.timestamp).toBeDefined();
      });
    });

    describe("deny", () => {
      it("should create deny result", () => {
        const result = deny({
          code: PolicyCodes.DENIED_DEFAULT,
          reason: "Test denial",
        });
        expect(result.allowed).toBe(false);
        expect(result.code).toBe(PolicyCodes.DENIED_DEFAULT);
        expect(result.reason).toBe("Test denial");
      });
    });

    describe("fromBoolean", () => {
      it("should create allow from true", () => {
        const result = fromBoolean(true);
        expect(result.allowed).toBe(true);
      });

      it("should create deny from false", () => {
        const result = fromBoolean(false);
        expect(result.allowed).toBe(false);
      });
    });

    describe("isAllowed", () => {
      it("should return true for allowed result", () => {
        expect(isAllowed(allow())).toBe(true);
      });

      it("should return false for denied result", () => {
        expect(isAllowed(deny())).toBe(false);
      });
    });

    describe("isDenied", () => {
      it("should return true for denied result", () => {
        expect(isDenied(deny())).toBe(true);
      });

      it("should return false for allowed result", () => {
        expect(isDenied(allow())).toBe(false);
      });
    });

    describe("isDestructiveDenial", () => {
      it("should detect destructive denial", () => {
        const result = deny({ code: PolicyCodes.DENIED_DESTRUCTIVE_ACTION });
        expect(isDestructiveDenial(result)).toBe(true);
      });

      it("should not flag other denials", () => {
        const result = deny({ code: PolicyCodes.DENIED_DEFAULT });
        expect(isDestructiveDenial(result)).toBe(false);
      });
    });

    describe("mergeResults", () => {
      it("should return deny if any result denies", () => {
        const results = [
          allow(),
          deny({ code: PolicyCodes.DENIED_DEFAULT }),
          allow(),
        ];
        const merged = mergeResults(results);
        expect(merged.allowed).toBe(false);
      });

      it("should return allow if all results allow", () => {
        const results = [allow(), allow()];
        const merged = mergeResults(results);
        expect(merged.allowed).toBe(true);
      });
    });

    describe("requireConfirmation", () => {
      it("should mark result as requiring confirmation", () => {
        const result = requireConfirmation(deny(), true);
        expect(result.requiresConfirmation).toBe(true);
      });
    });
  });

  describe("PolicyRules", () => {
    describe("RuleEngine", () => {
      it("should evaluate rules in priority order", () => {
        const engine = new RuleEngine();
        engine.addRule(
          createRule({
            name: "test-rule",
            description: "Test rule",
            priority: 100,
            evaluate: () => allow({ policy: "test-rule" }),
          })
        );

        const result = engine.evaluate({ action: "read" });
        expect(result.allowed).toBe(true);
        expect(result.policy).toBe("test-rule");
      });

      it("should return default deny if no rules match", () => {
        const engine = new RuleEngine({ defaultDeny: true });
        const result = engine.evaluate({ action: "unknown" });
        expect(result.allowed).toBe(false);
      });

      it("should load default rules", () => {
        const engine = new RuleEngine();
        engine.loadDefaults();
        const rules = engine.listRules();
        expect(rules.length).toBeGreaterThan(0);
      });
    });

    describe("DefaultRules", () => {
      it("should deny destructive actions", () => {
        const ctx = {
          action: "rm -rf /",
          destructive: true,
          scope: "admin",
        };
        const result = DefaultRules.isDestructiveAction.evaluate(ctx);
        expect(result.allowed).toBe(false);
        expect(result.code).toBe(PolicyCodes.DENIED_DESTRUCTIVE_ACTION);
      });

      it("should deny shell execution", () => {
        const ctx = {
          plugin: "shell",
          action: "execute",
        };
        const result = DefaultRules.denyShellExecution.evaluate(ctx);
        expect(result.allowed).toBe(false);
        expect(result.code).toBe(PolicyCodes.DENIED_SHELL_EXECUTION);
      });

      it("should allow read scope", () => {
        const ctx = {
          scope: "read",
          action: "list",
        };
        const result = DefaultRules.allowReadScope.evaluate(ctx);
        expect(result.allowed).toBe(true);
        expect(result.code).toBe(PolicyCodes.ALLOWED_READ_SCOPE);
      });
    });
  });

  describe("PolicyManager", () => {
    let manager;

    beforeEach(() => {
      manager = new PolicyManager();
    });

    afterEach(() => {
      manager = null;
    });

    it("should initialize with defaults", async () => {
      await manager.init();
      expect(manager.initialized).toBe(true);
      expect(manager.listRules().length).toBeGreaterThan(0);
    });

    it("should authorize allowed actions", async () => {
      await manager.init();
      const result = await manager.authorize({
        actor: "user",
        plugin: "test",
        action: "read",
        scope: "read",
      });
      expect(result.allowed).toBe(true);
    });

    it("should deny destructive actions by default", async () => {
      await manager.init();
      const result = await manager.authorize({
        actor: "user",
        plugin: "test",
        action: "rm -rf /",
        destructive: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.code).toBe(PolicyCodes.DENIED_DESTRUCTIVE_ACTION);
    });

    it("should track statistics", async () => {
      await manager.init();
      await manager.authorize({ actor: "user", plugin: "test", action: "read", scope: "read" });
      await manager.authorize({ actor: "user", plugin: "test", action: "delete", destructive: true });

      const stats = manager.getStats();
      expect(stats.decisionCount).toBe(2);
      expect(stats.allowCount).toBe(1);
      expect(stats.denyCount).toBe(1);
    });

    it("should support custom evaluators", async () => {
      class TestEvaluator extends PolicyEvaluator {
        constructor() {
          super("test", 100);
        }

        canEvaluate(ctx) {
          return ctx.plugin === "test";
        }

        evaluate(ctx) {
          return allow({ policy: "test-evaluator" });
        }
      }

      manager.registerEvaluator(new TestEvaluator());
      await manager.init();

      const result = await manager.authorize({
        actor: "user",
        plugin: "test",
        action: "read",
      });

      expect(result.policy).toBe("test-evaluator");
    });
  });

  describe("PolicyHelpers", () => {
    describe("canRead", () => {
      it("should authorize read operations", async () => {
        const result = await canRead({
          actor: "user",
          workspaceId: "ws1",
          resourceType: "file",
        });
        expect(result.allowed).toBe(true);
      });
    });

    describe("canWrite", () => {
      it("should authorize write operations", async () => {
        const result = await canWrite({
          actor: "user",
          workspaceId: "ws1",
          resourceType: "file",
        });
        expect(result.allowed).toBe(true);
      });
    });

    describe("canDelete", () => {
      it("should mark as destructive", async () => {
        const result = await canDelete({
          actor: "user",
          workspaceId: "ws1",
          resourceType: "file",
        });
        expect(result.allowed).toBe(false); // Denied by default rules
        expect(result.code).toBe(PolicyCodes.DENIED_DESTRUCTIVE_ACTION);
      });
    });

    describe("canExecute", () => {
      it("should deny shell execution by default", async () => {
        const result = await canExecute({
          actor: "user",
          workspaceId: "ws1",
          command: "ls",
        });
        expect(result.allowed).toBe(false);
        expect(result.code).toBe(PolicyCodes.DENIED_SHELL_EXECUTION);
      });
    });

    describe("canResolveSecret", () => {
      it("should deny secret resolution by default", async () => {
        const result = await canResolveSecret({
          actor: "user",
          workspaceId: "ws1",
          secretName: "API_KEY",
        });
        expect(result.allowed).toBe(false);
      });
    });

    describe("canAccessDatabase", () => {
      it("should allow read queries", async () => {
        const result = await canAccessDatabase({
          actor: "user",
          workspaceId: "ws1",
          action: "SELECT",
          table: "users",
        });
        expect(result.allowed).toBe(true);
      });

      it("should deny destructive queries", async () => {
        const result = await canAccessDatabase({
          actor: "user",
          workspaceId: "ws1",
          action: "DROP",
          table: "users",
        });
        expect(result.allowed).toBe(false);
        expect(result.code).toBe(PolicyCodes.DENIED_DESTRUCTIVE_ACTION);
      });
    });

    describe("canAccessFileStorage", () => {
      it("should allow read operations", async () => {
        const result = await canAccessFileStorage({
          actor: "user",
          workspaceId: "ws1",
          action: "read",
          path: "/file.txt",
        });
        expect(result.allowed).toBe(true);
      });

      it("should deny delete operations", async () => {
        const result = await canAccessFileStorage({
          actor: "user",
          workspaceId: "ws1",
          action: "delete",
          path: "/file.txt",
        });
        expect(result.allowed).toBe(false);
      });
    });
  });

  describe("PolicyConfig", () => {
    describe("getPolicyConfig", () => {
      it("should return default config", () => {
        const config = getPolicyConfig();
        expect(config.enabled).toBe(true);
        expect(config.defaultDeny).toBe(true);
        expect(config.failSafe).toBe(true);
      });
    });

    describe("validatePolicyConfig", () => {
      it("should validate valid config", () => {
        const result = validatePolicyConfig({
          enabled: true,
          defaultDeny: false,
          trustedPlugins: ["test"],
        });
        expect(result).toBeNull();
      });

      it("should reject invalid boolean fields", () => {
        const result = validatePolicyConfig({
          enabled: "yes",
        });
        expect(result).toContain("enabled");
      });

      it("should reject non-array trustedPlugins", () => {
        const result = validatePolicyConfig({
          trustedPlugins: "test",
        });
        expect(result).toContain("trustedPlugins");
      });
    });
  });

  describe("Integration", () => {
    it("should work end-to-end with global manager", async () => {
      const manager = getPolicyManager();
      await manager.init();

      const result = await authorize({
        actor: "user",
        plugin: "test",
        action: "read",
        scope: "read",
      });

      expect(result.allowed).toBe(true);
    });

    it("should handle complex authorization scenarios", async () => {
      const manager = new PolicyManager();
      await manager.init();

      // Read should be allowed
      const readResult = await manager.authorize({
        actor: "user",
        plugin: "file-storage",
        action: "list",
        scope: "read",
      });
      expect(readResult.allowed).toBe(true);

      // Shell execution should be denied
      const shellResult = await manager.authorize({
        actor: "user",
        plugin: "shell",
        action: "execute",
        scope: "admin",
      });
      expect(shellResult.allowed).toBe(false);
      expect(shellResult.code).toBe(PolicyCodes.DENIED_SHELL_EXECUTION);

      // Destructive action should be denied
      const destructiveResult = await manager.authorize({
        actor: "user",
        plugin: "file-storage",
        action: "delete",
        destructive: true,
      });
      expect(destructiveResult.allowed).toBe(false);
      expect(destructiveResult.code).toBe(PolicyCodes.DENIED_DESTRUCTIVE_ACTION);
    });
  });
});
