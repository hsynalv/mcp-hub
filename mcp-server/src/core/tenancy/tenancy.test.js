/**
 * Tenancy Test Suite
 *
 * Tests for the tenant/workspace infrastructure.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  extractTenantContext,
  buildTenantContext,
  validateTenantContext,
  isEmptyTenantContext,
  formatTenantContext,
} from "./tenant.context.js";
import {
  validateTenantId,
  validateWorkspaceId,
  validateProjectId,
  validateHierarchy,
  sanitizeTenantIdentifier,
  isValidTenantIdentifier,
  assertValidTenantId,
  generateValidIdentifier,
} from "./tenant.validation.js";
import {
  IsolationErrorCode,
  isTenantAccessAllowed,
  isWorkspaceAccessAllowed,
  isProjectAccessAllowed,
  assertTenantAccess,
  assertResourceAccess,
  checkResourceAccess,
  isSameTenantWorkspace,
} from "./tenant.isolation.js";
import {
  TenantPolicyReason,
  createPolicyContext,
  isTenantActive,
  isWorkspaceActive,
} from "./tenant.policy.js";
import {
  TenantRegistry,
  createTenantRegistry,
  getTenantRegistry,
  setTenantRegistry,
} from "./tenant.registry.js";

describe("Tenancy Infrastructure", () => {
  describe("Tenant Context", () => {
    it("should extract context from headers", () => {
      const req = {
        headers: {
          "x-tenant-id": "tenant_123",
          "x-workspace-id": "workspace_456",
          "x-project-id": "project_789",
        },
        user: { id: "user_abc", roles: ["admin"] },
      };

      const ctx = extractTenantContext(req);

      expect(ctx.tenantId).toBe("tenant_123");
      expect(ctx.workspaceId).toBe("workspace_456");
      expect(ctx.projectId).toBe("project_789");
      expect(ctx.actor).toBe("user_abc");
      expect(ctx.roles).toEqual(["admin"]);
    });

    it("should build context from input", () => {
      const ctx = buildTenantContext({
        tenantId: "t1",
        workspaceId: "w1",
        actor: "user1",
      });

      expect(ctx.tenantId).toBe("t1");
      expect(ctx.workspaceId).toBe("w1");
      expect(ctx.actor).toBe("user1");
      expect(ctx.roles).toEqual([]);
    });

    it("should validate context", () => {
      const ctx = {
        tenantId: "valid_tenant",
        workspaceId: "valid_workspace",
        projectId: "valid_project",
        actor: "user",
        roles: ["admin"],
        correlationId: "corr_123",
      };

      const result = validateTenantContext(ctx);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect invalid context", () => {
      const ctx = {
        tenantId: "invalid tenant!",
        workspaceId: "ok_workspace",
      };

      const result = validateTenantContext(ctx);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should warn on missing hierarchy", () => {
      const ctx = {
        projectId: "has_project",
        workspaceId: null,
      };

      const result = validateTenantContext(ctx);

      expect(result.warnings).toContain("projectId set but workspaceId is missing");
    });

    it("should detect empty context", () => {
      const empty = { tenantId: null, workspaceId: null, projectId: null };
      const notEmpty = { tenantId: "t1" };

      expect(isEmptyTenantContext(empty)).toBe(true);
      expect(isEmptyTenantContext(notEmpty)).toBe(false);
    });

    it("should format context for logging", () => {
      const ctx = {
        tenantId: "t1",
        workspaceId: "w1",
        projectId: "p1",
        actor: "user1",
      };

      const formatted = formatTenantContext(ctx);

      expect(formatted).toContain("t=t1");
      expect(formatted).toContain("w=w1");
      expect(formatted).toContain("p=p1");
      expect(formatted).toContain("a=user1");
    });

    it("should handle strict mode", () => {
      const req = { headers: {} };

      expect(() => {
        extractTenantContext(req, { strict: true, required: ["tenantId"] });
      }).toThrow();
    });
  });

  describe("Tenant Validation", () => {
    it("should validate valid tenant ID", () => {
      const result = validateTenantId("valid_tenant_123");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid characters", () => {
      const result = validateTenantId("invalid/tenant");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining("path traversal")
      );
    });

    it("should reject empty ID", () => {
      const result = validateTenantId("");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("tenantId is required");
    });

    it("should reject too long ID", () => {
      const longId = "a".repeat(200);
      const result = validateTenantId(longId);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining("maximum length")
      );
    });

    it("should reject control characters", () => {
      const result = validateTenantId("tenant\x00id");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("tenantId contains null bytes");
    });

    it("should warn on leading hyphen", () => {
      const result = validateTenantId("-tenant");

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "tenantId starts or ends with hyphen"
      );
    });

    it("should sanitize identifiers", () => {
      expect(sanitizeTenantIdentifier(" valid-id ")).toBe("valid-id");
      expect(sanitizeTenantIdentifier("valid/id")).toBe("validid");
      expect(sanitizeTenantIdentifier("valid\x00id")).toBe("validid");
      expect(sanitizeTenantIdentifier("invalid!@#$")).toBe("invalid");
    });

    it("should check valid identifier", () => {
      expect(isValidTenantIdentifier("valid_123")).toBe(true);
      expect(isValidTenantIdentifier("invalid/id")).toBe(false);
      expect(isValidTenantIdentifier("")).toBe(false);
      expect(isValidTenantIdentifier(null)).toBe(false);
    });

    it("should assert valid tenant ID", () => {
      expect(() => assertValidTenantId("valid_id")).not.toThrow();
      expect(() => assertValidTenantId("invalid/id")).toThrow();
    });

    it("should validate hierarchy", () => {
      const valid = validateHierarchy({
        tenantId: "t1",
        workspaceId: "w1",
        projectId: "p1",
      });

      expect(valid.valid).toBe(true);
    });

    it("should detect hierarchy violations", () => {
      const invalid = validateHierarchy({
        workspaceId: "w1",
      });

      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContain(
        "tenantId is required when workspaceId is provided"
      );
    });

    it("should generate valid identifier", () => {
      expect(generateValidIdentifier("Valid ID")).toBe("Valid_ID");
      expect(generateValidIdentifier("valid/id")).toBe("validid");
      expect(generateValidIdentifier("test", "prefix")).toBe("prefix_test");
    });
  });

  describe("Tenant Isolation", () => {
    const context = {
      tenantId: "tenant_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      actor: "user_1",
      roles: ["admin"],
    };

    it("should allow same tenant access", () => {
      const result = isTenantAccessAllowed(context, "tenant_1");

      expect(result.allowed).toBe(true);
    });

    it("should deny cross-tenant access", () => {
      const result = isTenantAccessAllowed(context, "tenant_2");

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(IsolationErrorCode.TENANT_MISMATCH);
    });

    it("should deny when context missing tenant", () => {
      const result = isTenantAccessAllowed({ tenantId: null }, "tenant_1");

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(IsolationErrorCode.MISSING_CONTEXT);
    });

    it("should allow same workspace access", () => {
      const result = isWorkspaceAccessAllowed(
        context,
        "tenant_1",
        "workspace_1"
      );

      expect(result.allowed).toBe(true);
    });

    it("should deny cross-workspace access", () => {
      const result = isWorkspaceAccessAllowed(
        context,
        "tenant_1",
        "workspace_2"
      );

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(IsolationErrorCode.WORKSPACE_MISMATCH);
    });

    it("should allow same project access", () => {
      const result = isProjectAccessAllowed(
        context,
        "tenant_1",
        "workspace_1",
        "project_1"
      );

      expect(result.allowed).toBe(true);
    });

    it("should deny cross-project access", () => {
      const result = isProjectAccessAllowed(
        context,
        "tenant_1",
        "workspace_1",
        "project_2"
      );

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(IsolationErrorCode.PROJECT_MISMATCH);
    });

    it("should assert tenant access", () => {
      expect(() =>
        assertTenantAccess(context, "tenant_1")
      ).not.toThrow();

      expect(() =>
        assertTenantAccess(context, "tenant_2")
      ).toThrow("Tenant access denied");
    });

    it("should check resource access", () => {
      const resource = {
        tenantId: "tenant_1",
        workspaceId: "workspace_1",
      };

      expect(checkResourceAccess(context, resource).allowed).toBe(true);

      const otherResource = {
        tenantId: "tenant_2",
      };

      expect(checkResourceAccess(context, otherResource).allowed).toBe(false);
    });

    it("should assert resource access", () => {
      const resource = { tenantId: "tenant_1", workspaceId: "workspace_1" };

      expect(() => assertResourceAccess(context, resource)).not.toThrow();

      const badResource = { tenantId: "tenant_2" };

      expect(() => assertResourceAccess(context, badResource)).toThrow();
    });

    it("should check same tenant/workspace", () => {
      expect(
        isSameTenantWorkspace(context, {
          tenantId: "tenant_1",
          workspaceId: "workspace_1",
        })
      ).toBe(true);

      expect(
        isSameTenantWorkspace(context, { tenantId: "tenant_2" })
      ).toBe(false);
    });
  });

  describe("Tenant Registry", () => {
    let registry;

    beforeEach(() => {
      registry = createTenantRegistry();
    });

    it("should register tenant", () => {
      const tenant = registry.registerTenant({
        tenantId: "tenant_1",
        name: "Test Tenant",
        status: "active",
      });

      expect(tenant.tenantId).toBe("tenant_1");
      expect(tenant.name).toBe("Test Tenant");
      expect(tenant.createdAt).toBeDefined();
    });

    it("should get tenant", () => {
      registry.registerTenant({
        tenantId: "tenant_1",
        name: "Test",
      });

      const retrieved = registry.getTenant("tenant_1");

      expect(retrieved).toBeDefined();
      expect(retrieved.tenantId).toBe("tenant_1");
    });

    it("should check tenant existence", () => {
      registry.registerTenant({ tenantId: "t1" });

      expect(registry.hasTenant("t1")).toBe(true);
      expect(registry.hasTenant("t2")).toBe(false);
    });

    it("should register workspace", () => {
      registry.registerTenant({ tenantId: "t1" });

      const workspace = registry.registerWorkspace({
        workspaceId: "w1",
        tenantId: "t1",
        name: "Test Workspace",
      });

      expect(workspace.workspaceId).toBe("w1");
      expect(workspace.tenantId).toBe("t1");
    });

    it("should fail to register workspace without tenant", () => {
      expect(() =>
        registry.registerWorkspace({
          workspaceId: "w1",
          tenantId: "nonexistent",
        })
      ).toThrow("Tenant not found");
    });

    it("should register project", () => {
      registry.registerTenant({ tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1" });

      const project = registry.registerProject({
        projectId: "p1",
        workspaceId: "w1",
        tenantId: "t1",
        name: "Test Project",
      });

      expect(project.projectId).toBe("p1");
    });

    it("should list tenant workspaces", () => {
      registry.registerTenant({ tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w2", tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w3", tenantId: "t2" });

      const workspaces = registry.listTenantWorkspaces("t1");

      expect(workspaces).toHaveLength(2);
      expect(workspaces.map(w => w.workspaceId)).toContain("w1");
      expect(workspaces.map(w => w.workspaceId)).toContain("w2");
    });

    it("should list workspace projects", () => {
      registry.registerTenant({ tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1" });
      registry.registerProject({ projectId: "p1", workspaceId: "w1", tenantId: "t1" });
      registry.registerProject({ projectId: "p2", workspaceId: "w1", tenantId: "t1" });

      const projects = registry.listWorkspaceProjects("w1");

      expect(projects).toHaveLength(2);
    });

    it("should resolve full path", () => {
      registry.registerTenant({ tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1" });
      registry.registerProject({ projectId: "p1", workspaceId: "w1", tenantId: "t1" });

      const resolved = registry.resolvePath("t1", "w1", "p1");

      expect(resolved.tenant).toBeDefined();
      expect(resolved.workspace).toBeDefined();
      expect(resolved.project).toBeDefined();
    });

    it("should fail to resolve invalid path", () => {
      registry.registerTenant({ tenantId: "t1" });

      const resolved = registry.resolvePath("t1", "w1");

      expect(resolved).toBeNull();
    });

    it("should get stats", () => {
      registry.registerTenant({ tenantId: "t1", status: "active" });
      registry.registerTenant({ tenantId: "t2", status: "deleted" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1", status: "active" });
      registry.registerProject({ projectId: "p1", workspaceId: "w1", tenantId: "t1" });

      const stats = registry.getStats();

      expect(stats.tenants).toBe(2);
      expect(stats.activeTenants).toBe(1);
      expect(stats.workspaces).toBe(1);
      expect(stats.projects).toBe(1);
    });

    it("should remove tenant with cascade", () => {
      registry.registerTenant({ tenantId: "t1" });
      registry.registerWorkspace({ workspaceId: "w1", tenantId: "t1" });
      registry.registerProject({ projectId: "p1", workspaceId: "w1", tenantId: "t1" });

      registry.removeTenant("t1");

      expect(registry.hasTenant("t1")).toBe(false);
      expect(registry.hasWorkspace("w1")).toBe(false);
      expect(registry.hasProject("p1")).toBe(false);
    });

    it("should use global registry", () => {
      setTenantRegistry(null);

      const reg1 = getTenantRegistry();
      const reg2 = getTenantRegistry();

      expect(reg1).toBe(reg2);
    });
  });

  describe("Tenant Policy", () => {
    it("should create policy context", () => {
      const tenantCtx = {
        actor: "user1",
        roles: ["admin"],
        tenantId: "t1",
        workspaceId: "w1",
        projectId: "p1",
        correlationId: "corr_123",
      };

      const policyCtx = createPolicyContext(tenantCtx);

      expect(policyCtx.actor).toBe("user1");
      expect(policyCtx.tenantId).toBe("t1");
      expect(policyCtx.workspaceId).toBe("w1");
    });

    it("should check tenant active status", () => {
      expect(isTenantActive({ status: "active" })).toBe(true);
      expect(isTenantActive({ status: "suspended" })).toBe(false);
      expect(isTenantActive(null)).toBe(false);
    });

    it("should check workspace active status", () => {
      expect(isWorkspaceActive({ status: "active" })).toBe(true);
      expect(isWorkspaceActive({ status: "archived" })).toBe(false);
      expect(isWorkspaceActive(null)).toBe(false);
    });
  });
});
