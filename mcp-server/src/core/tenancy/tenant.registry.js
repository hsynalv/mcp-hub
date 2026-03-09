/**
 * Tenant Registry
 *
 * Memory-based registry for tenant/workspace/project management.
 */

import { TenantStatus, WorkspaceStatus } from "./tenant.types.js";
import { validateTenantId, validateWorkspaceId, validateProjectId } from "./tenant.validation.js";

/**
 * Tenant Registry
 */
export class TenantRegistry {
  constructor() {
    /** @type {Map<string, import("./tenant.types.js").Tenant>} */
    this.tenants = new Map();

    /** @type {Map<string, import("./tenant.types.js").Workspace>} */
    this.workspaces = new Map();

    /** @type {Map<string, import("./tenant.types.js").Project>} */
    this.projects = new Map();

    this.initialized = false;
  }

  // ==================== Tenant Operations ====================

  /**
   * Register a tenant
   * @param {import("./tenant.types.js").Tenant} tenant
   * @returns {import("./tenant.types.js").Tenant}
   */
  registerTenant(tenant) {
    const validation = validateTenantId(tenant.tenantId);
    if (!validation.valid) {
      throw new Error(`Invalid tenantId: ${validation.errors.join(", ")}`);
    }

    const existing = this.tenants.get(tenant.tenantId);
    const now = new Date().toISOString();

    const stored = {
      ...existing,
      ...tenant,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.tenants.set(tenant.tenantId, stored);
    return stored;
  }

  /**
   * Get tenant by ID
   * @param {string} tenantId
   * @returns {import("./tenant.types.js").Tenant | undefined}
   */
  getTenant(tenantId) {
    return this.tenants.get(tenantId);
  }

  /**
   * Check if tenant exists
   * @param {string} tenantId
   * @returns {boolean}
   */
  hasTenant(tenantId) {
    return this.tenants.has(tenantId);
  }

  /**
   * List all tenants
   * @param {import("./tenant.types.js").TenantFilter} [filter]
   * @returns {import("./tenant.types.js").Tenant[]}
   */
  listTenants(filter = {}) {
    let tenants = Array.from(this.tenants.values());

    if (filter.status) {
      tenants = tenants.filter(t => t.status === filter.status);
    }

    return tenants;
  }

  /**
   * Remove tenant
   * @param {string} tenantId
   * @returns {boolean}
   */
  removeTenant(tenantId) {
    // Also remove associated workspaces and projects
    const workspaces = this.listTenantWorkspaces(tenantId);
    for (const ws of workspaces) {
      this.removeWorkspace(ws.workspaceId);
    }

    return this.tenants.delete(tenantId);
  }

  // ==================== Workspace Operations ====================

  /**
   * Register a workspace
   * @param {import("./tenant.types.js").Workspace} workspace
   * @returns {import("./tenant.types.js").Workspace}
   */
  registerWorkspace(workspace) {
    const validation = validateWorkspaceId(workspace.workspaceId);
    if (!validation.valid) {
      throw new Error(`Invalid workspaceId: ${validation.errors.join(", ")}`);
    }

    // Ensure tenant exists
    if (!this.hasTenant(workspace.tenantId)) {
      throw new Error(`Tenant not found: ${workspace.tenantId}`);
    }

    const existing = this.workspaces.get(workspace.workspaceId);
    const now = new Date().toISOString();

    const stored = {
      ...existing,
      ...workspace,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.workspaces.set(workspace.workspaceId, stored);
    return stored;
  }

  /**
   * Get workspace by ID
   * @param {string} workspaceId
   * @returns {import("./tenant.types.js").Workspace | undefined}
   */
  getWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Check if workspace exists
   * @param {string} workspaceId
   * @returns {boolean}
   */
  hasWorkspace(workspaceId) {
    return this.workspaces.has(workspaceId);
  }

  /**
   * List workspaces for tenant
   * @param {string} tenantId
   * @returns {import("./tenant.types.js").Workspace[]}
   */
  listTenantWorkspaces(tenantId) {
    return Array.from(this.workspaces.values()).filter(
      ws => ws.tenantId === tenantId
    );
  }

  /**
   * Remove workspace
   * @param {string} workspaceId
   * @returns {boolean}
   */
  removeWorkspace(workspaceId) {
    // Also remove associated projects
    const projects = this.listWorkspaceProjects(workspaceId);
    for (const proj of projects) {
      this.removeProject(proj.projectId);
    }

    return this.workspaces.delete(workspaceId);
  }

  // ==================== Project Operations ====================

  /**
   * Register a project
   * @param {import("./tenant.types.js").Project} project
   * @returns {import("./tenant.types.js").Project}
   */
  registerProject(project) {
    const validation = validateProjectId(project.projectId);
    if (!validation.valid) {
      throw new Error(`Invalid projectId: ${validation.errors.join(", ")}`);
    }

    // Ensure workspace exists
    if (!this.hasWorkspace(project.workspaceId)) {
      throw new Error(`Workspace not found: ${project.workspaceId}`);
    }

    const existing = this.projects.get(project.projectId);
    const now = new Date().toISOString();

    const stored = {
      ...existing,
      ...project,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.projects.set(project.projectId, stored);
    return stored;
  }

  /**
   * Get project by ID
   * @param {string} projectId
   * @returns {import("./tenant.types.js").Project | undefined}
   */
  getProject(projectId) {
    return this.projects.get(projectId);
  }

  /**
   * Check if project exists
   * @param {string} projectId
   * @returns {boolean}
   */
  hasProject(projectId) {
    return this.projects.has(projectId);
  }

  /**
   * List projects for workspace
   * @param {string} workspaceId
   * @returns {import("./tenant.types.js").Project[]}
   */
  listWorkspaceProjects(workspaceId) {
    return Array.from(this.projects.values()).filter(
      p => p.workspaceId === workspaceId
    );
  }

  /**
   * Remove project
   * @param {string} projectId
   * @returns {boolean}
   */
  removeProject(projectId) {
    return this.projects.delete(projectId);
  }

  // ==================== Lookup Operations ====================

  /**
   * Resolve full path: tenant -> workspace -> project
   * @param {string} tenantId
   * @param {string} [workspaceId]
   * @param {string} [projectId]
   * @returns {Object | null}
   */
  resolvePath(tenantId, workspaceId, projectId) {
    const tenant = this.getTenant(tenantId);
    if (!tenant) return null;

    const result = { tenant };

    if (workspaceId) {
      const workspace = this.getWorkspace(workspaceId);
      if (!workspace || workspace.tenantId !== tenantId) {
        return null;
      }
      result.workspace = workspace;

      if (projectId) {
        const project = this.getProject(projectId);
        if (!project || project.workspaceId !== workspaceId) {
          return null;
        }
        result.project = project;
      }
    }

    return result;
  }

  /**
   * Get stats
   * @returns {Object}
   */
  getStats() {
    return {
      tenants: this.tenants.size,
      workspaces: this.workspaces.size,
      projects: this.projects.size,
      activeTenants: Array.from(this.tenants.values()).filter(
        t => t.status === TenantStatus.ACTIVE
      ).length,
      activeWorkspaces: Array.from(this.workspaces.values()).filter(
        ws => ws.status === WorkspaceStatus.ACTIVE
      ).length,
    };
  }

  /**
   * Clear all data
   */
  clear() {
    this.tenants.clear();
    this.workspaces.clear();
    this.projects.clear();
  }
}

/**
 * Create a new tenant registry
 * @returns {TenantRegistry}
 */
export function createTenantRegistry() {
  return new TenantRegistry();
}

/**
 * Global registry instance
 * @type {TenantRegistry | null}
 */
let globalRegistry = null;

/**
 * Get or create global registry
 * @returns {TenantRegistry}
 */
export function getTenantRegistry() {
  if (!globalRegistry) {
    globalRegistry = new TenantRegistry();
  }
  return globalRegistry;
}

/**
 * Set global registry
 * @param {TenantRegistry} registry
 */
export function setTenantRegistry(registry) {
  globalRegistry = registry;
}
