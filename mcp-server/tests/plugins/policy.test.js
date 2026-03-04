import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluate } from "../../src/plugins/policy/policy.engine.js";
import {
  listRules,
  addRule,
  removeRule,
  getRule,
  listApprovals,
  createApproval,
  updateApprovalStatus,
  checkPolicyRateLimit,
} from "../../src/plugins/policy/policy.store.js";

/**
 * Policy Plugin Unit Tests
 * Tests for policy engine and store functionality
 */

describe("Policy Engine", () => {
  // Mock the store functions
  vi.mock("../../src/plugins/policy/policy.store.js", () => ({
    listRules: vi.fn(),
    createApproval: vi.fn(),
    checkPolicyRateLimit: vi.fn(),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Rule Matching", () => {
    it("should allow requests when no rules match", () => {
      listRules.mockReturnValue([]);

      const result = evaluate("GET", "/health", null, "test");

      expect(result.allowed).toBe(true);
      expect(result.explanation).toContain("allowed");
    });

    it("should block requests matching block rule", () => {
      listRules.mockReturnValue([
        {
          id: "rule-block-db",
          pattern: "POST /database/crud/*",
          action: "block",
          description: "Block database writes",
          enabled: true,
        },
      ]);

      const result = evaluate("POST", "/database/crud/insert", {}, "test");

      expect(result.allowed).toBe(false);
      expect(result.action).toBe("block");
      expect(result.rule).toBe("rule-block-db");
    });

    it("should match exact pattern with method", () => {
      listRules.mockReturnValue([
        {
          id: "rule-exact",
          pattern: "GET /health",
          action: "block",
          description: "Block health",
          enabled: true,
        },
      ]);

      const result = evaluate("GET", "/health", null, "test");

      expect(result.allowed).toBe(false);
      expect(result.action).toBe("block");
    });

    it("should not match different method", () => {
      listRules.mockReturnValue([
        {
          id: "rule-get-only",
          pattern: "GET /api/resource",
          action: "block",
          description: "Block GET only",
          enabled: true,
        },
      ]);

      const result = evaluate("POST", "/api/resource", {}, "test");

      expect(result.allowed).toBe(true);
    });

    it("should match wildcard patterns", () => {
      listRules.mockReturnValue([
        {
          id: "rule-wildcard",
          pattern: "* /api/*",
          action: "block",
          description: "Block all API paths",
          enabled: true,
        },
      ]);

      const result = evaluate("GET", "/api/users", null, "test");

      expect(result.allowed).toBe(false);
    });

    it("should match path-only patterns for any method", () => {
      listRules.mockReturnValue([
        {
          id: "rule-path-only",
          pattern: "/sensitive/path",
          action: "require_approval",
          description: "Require approval for sensitive path",
          enabled: true,
        },
      ]);
      createApproval.mockReturnValue({
        id: "approval-path",
        status: "pending",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const getResult = evaluate("GET", "/sensitive/path", null, "test");
      const postResult = evaluate("POST", "/sensitive/path", {}, "test");

      expect(getResult.allowed).toBe(false);
      expect(getResult.action).toBe("require_approval");
      expect(postResult.allowed).toBe(false);
    });
  });

  describe("Rule Actions", () => {
    it("should require approval for matching requests", () => {
      const mockApproval = {
        id: "approval-123",
        status: "pending",
        createdAt: "2024-01-01T00:00:00Z",
      };
      listRules.mockReturnValue([
        {
          id: "rule-approval",
          pattern: "DELETE /critical/resource",
          action: "require_approval",
          description: "Require approval for deletes",
          enabled: true,
        },
      ]);
      createApproval.mockReturnValue(mockApproval);

      const result = evaluate("DELETE", "/critical/resource", {}, "test");

      expect(result.allowed).toBe(false);
      expect(result.action).toBe("require_approval");
      expect(result.approval).toEqual(mockApproval);
      expect(createApproval).toHaveBeenCalledWith({
        ruleId: "rule-approval",
        path: "/critical/resource",
        method: "DELETE",
        body: {},
        requestedBy: "test",
      });
    });

    it("should handle dry_run_first action", () => {
      listRules.mockReturnValue([
        {
          id: "rule-dry-run",
          pattern: "POST /api/apply",
          action: "dry_run_first",
          description: "Require dry run",
          enabled: true,
        },
      ]);

      const result = evaluate("POST", "/api/apply", { data: "test" }, "user");

      expect(result.allowed).toBe(false);
      expect(result.action).toBe("dry_run");
      expect(result.preview).toEqual({
        method: "POST",
        path: "/api/apply",
        body: { data: "test" },
      });
    });

    it("should handle rate_limit action when allowed", () => {
      listRules.mockReturnValue([
        {
          id: "rule-rate-limit",
          pattern: "POST /api/action",
          action: "rate_limit",
          description: "Rate limit",
          enabled: true,
          limit: 10,
          window: "1h",
        },
      ]);
      checkPolicyRateLimit.mockReturnValue({ allowed: true });

      const result = evaluate("POST", "/api/action", {}, "test");

      expect(result.allowed).toBe(true);
      expect(checkPolicyRateLimit).toHaveBeenCalled();
    });

    it("should block when rate limit exceeded", () => {
      listRules.mockReturnValue([
        {
          id: "rule-rate-limit",
          pattern: "POST /api/action",
          action: "rate_limit",
          description: "Rate limit",
          enabled: true,
          limit: 5,
          window: "1m",
        },
      ]);
      checkPolicyRateLimit.mockReturnValue({
        allowed: false,
        reason: "policy_rate_limit",
        rule: "rule-rate-limit",
      });

      const result = evaluate("POST", "/api/action", {}, "test");

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("policy_rate_limit");
    });
  });

  describe("Rule Priority", () => {
    it("should apply first matching rule", () => {
      listRules.mockReturnValue([
        {
          id: "rule-first",
          pattern: "POST /api/*",
          action: "block",
          description: "First rule",
          enabled: true,
        },
        {
          id: "rule-second",
          pattern: "POST /api/resource",
          action: "require_approval",
          description: "Second rule",
          enabled: true,
        },
      ]);

      const result = evaluate("POST", "/api/resource", {}, "test");

      expect(result.allowed).toBe(false);
      expect(result.rule).toBe("rule-first");
      expect(result.action).toBe("block");
    });

    it("should skip disabled rules", () => {
      listRules.mockReturnValue([
        {
          id: "rule-disabled",
          pattern: "GET /blocked",
          action: "block",
          description: "Disabled rule",
          enabled: false,
        },
        {
          id: "rule-enabled",
          pattern: "GET /blocked",
          action: "require_approval",
          description: "Enabled rule",
          enabled: true,
        },
      ]);
      createApproval.mockReturnValue({
        id: "approval-1",
        status: "pending",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const result = evaluate("GET", "/blocked", null, "test");

      expect(result.allowed).toBe(false);
      expect(result.rule).toBe("rule-enabled");
      expect(result.action).toBe("require_approval");
    });
  });
});
