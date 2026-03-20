/**
 * Tenant boundary for tool execution (and mirrored in discovery via filterVisibleTools).
 */

/**
 * @param {object} context - tool / MCP context
 * @param {import('../security/resolve-runtime-security.js').SecurityRuntime} runtime
 * @returns {{ ok: false, error: object } | null}
 */
export function assertTenantBoundary(context = {}, runtime) {
  if (!runtime?.requireTenantId) return null;

  const tid = context.tenantId;
  if (tid == null || String(tid).trim() === "") {
    return {
      ok: false,
      error: {
        code: "missing_tenant_context",
        message:
          "Tenant context is required. Set x-tenant-id, HUB_TENANT_ID, or disable HUB_REQUIRE_TENANT_ID for non-multi-tenant deployments.",
      },
    };
  }
  return null;
}
