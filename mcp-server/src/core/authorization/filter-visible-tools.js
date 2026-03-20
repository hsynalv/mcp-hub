/**
 * MCP listTools: hide tools the principal cannot run under current workspace + scope.
 */

import { isPluginAllowed } from "../workspace.js";
import { ToolTags } from "../tool-tags.js";
import { resolvePrincipalScopes, maxScopeRank } from "./resolve-principal.js";
import { getSecurityRuntime, hubKeysConfigured } from "../security/resolve-runtime-security.js";
import { assertTenantBoundary } from "./assert-tenant-boundary.js";
import { assertRegisteredWorkspaceBoundary } from "./assert-workspace-boundary.js";

function toolRequiresWriteOrHigher(tool) {
  const tags = tool.tags || [];
  return tags.some(
    (t) => t === ToolTags.WRITE || t === ToolTags.DESTRUCTIVE || t === ToolTags.NEEDS_APPROVAL
  );
}

/**
 * @param {object[]} tools - registry tool records
 * @param {object} opts
 * @param {string|null|undefined} opts.workspaceId
 * @param {string|null|undefined} [opts.tenantId]
 * @param {string[]} opts.scopes - from resolvePrincipalScopes
 * @returns {object[]}
 */
export function filterVisibleTools(tools, opts = {}) {
  const runtime = getSecurityRuntime();
  const scopes = opts.scopes || [];

  if (!runtime.allowOpenPrincipal && !hubKeysConfigured() && scopes.length === 0) {
    return [];
  }

  const fakeCtx = {
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId ?? null,
  };
  if (assertTenantBoundary(fakeCtx, runtime)) return [];
  if (assertRegisteredWorkspaceBoundary(opts.workspaceId, runtime)) return [];

  const workspaceId = opts.workspaceId ?? "global";
  const needWrite = maxScopeRank(scopes) >= 1;

  return tools.filter((tool) => {
    const plugin = tool.plugin || "unknown";
    if (!isPluginAllowed(workspaceId, plugin)) return false;

    if (toolRequiresWriteOrHigher(tool) && !needWrite) return false;

    return true;
  });
}

/**
 * Build filter options from callTool-style context (same fields MCP/REST pass).
 * @param {object} context
 * @returns {{ workspaceId: string, scopes: string[], tenantId: string|null }}
 */
export function filterOptionsFromContext(context = {}) {
  const workspaceId = context.workspaceId ?? "global";
  const scopes = resolvePrincipalScopes(context);
  const tenantId = context.tenantId ?? null;
  return { workspaceId, scopes, tenantId };
}
