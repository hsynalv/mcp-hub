/**
 * Discovery surfaces (/plugins, OpenAPI) use the same visibility rules as MCP ListTools.
 */

import { listTools } from "../tool-registry.js";
import { filterVisibleTools, filterOptionsFromContext } from "./filter-visible-tools.js";
import { getRuntimeSecurityMode } from "../auth/get-runtime-security-mode.js";

/**
 * @param {import("express").Request|null} req
 * @returns {{ workspaceId: string, scopes: string[], tenantId: string|null }}
 */
export function discoveryVisibilityContextFromRequest(req) {
  if (!req || typeof req !== "object") {
    return filterOptionsFromContext({ workspaceId: "global", tenantId: null });
  }
  return filterOptionsFromContext({
    workspaceId: req.workspaceId,
    tenantId: req.tenantId ?? null,
    actor: req.actor,
    scopes: req.authScopes,
    authScopes: req.authScopes,
    user: req.user,
  });
}

/**
 * @param {object[]} plugins - getPlugins() snapshot
 * @param {{ workspaceId: string, scopes: string[], tenantId?: string|null }} visibilityCtx
 * @returns {object[]}
 */
export function filterPluginsForDiscovery(plugins, visibilityCtx) {
  const mode = getRuntimeSecurityMode();
  if (!mode.discoveryFilterByPrincipal) {
    return plugins;
  }

  const allRegistry = listTools();
  const visible = filterVisibleTools(allRegistry, visibilityCtx);
  const byPlugin = new Map();
  for (const t of visible) {
    const p = t.plugin || "unknown";
    if (!byPlugin.has(p)) byPlugin.set(p, new Set());
    byPlugin.get(p).add(t.name);
  }

  return plugins.map((plugin) => {
    const names = byPlugin.get(plugin.name);
    if (!names || names.size === 0) {
      return { ...plugin, tools: [] };
    }
    const tools = Array.isArray(plugin.tools) ? plugin.tools.filter((t) => names.has(t.name)) : [];
    return { ...plugin, tools };
  });
}
