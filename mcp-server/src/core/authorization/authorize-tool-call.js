/**
 * Central tool authorization: scopes, workspace permissions, cross-workspace args, policy rules.
 * Runs in executeRegisteredTool before before-hooks (approval workflow stays in hooks).
 */

import { getPolicyEvaluator } from "../policy-hooks.js";
import { getSecurityRuntime } from "../security/resolve-runtime-security.js";
import { ToolTags } from "../tool-tags.js";
import { canRunTool, checkCrossWorkspaceAccess } from "../workspace-permissions.js";
import { auditToolAuthzDenial } from "./deny-with-audit.js";
import { resolvePrincipalScopes, maxScopeRank, resolveRequestedBy } from "./resolve-principal.js";
import { assertTenantBoundary } from "./assert-tenant-boundary.js";
import { assertRegisteredWorkspaceBoundary } from "./assert-workspace-boundary.js";

const WORKSPACE_ID_KEYS = new Set([
  "workspaceId",
  "workspace_id",
  "target_workspace_id",
  "targetWorkspaceId",
]);

function toolRequiresWriteOrHigher(tool) {
  const tags = tool.tags || [];
  return tags.some(
    (t) => t === ToolTags.WRITE || t === ToolTags.DESTRUCTIVE || t === ToolTags.NEEDS_APPROVAL
  );
}

function inferOperationType(tool) {
  const tags = tool.tags || [];
  if (tags.includes(ToolTags.GIT)) return "git";
  if (
    tags.some(
      (t) => t === ToolTags.WRITE || t === ToolTags.DESTRUCTIVE || t === ToolTags.NEEDS_APPROVAL
    )
  ) {
    return "write";
  }
  return "read";
}

function collectWorkspaceIdsFromArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const ids = [];
  for (const [k, v] of Object.entries(args)) {
    if (!WORKSPACE_ID_KEYS.has(k)) continue;
    if (typeof v === "string" && v.trim()) ids.push(v.trim());
  }
  return ids;
}

function permissionContext(context, tool, name) {
  return {
    workspaceId: context.workspaceId || "global",
    actor: context.user || resolveRequestedBy(context),
    plugin: tool.plugin || "unknown",
    correlationId: context.requestId || context.correlationId,
    toolName: name,
  };
}

/**
 * @param {object} params
 * @param {string} params.name
 * @param {object} params.tool
 * @param {object} params.args
 * @param {object} params.context
 * @returns {Promise<object|null>} null if allowed; otherwise short-circuit { ok:false, error }
 */
export async function authorizeToolCall({ name, tool, args, context }) {
  const ctx = context && typeof context === "object" ? context : {};
  const scopes = resolvePrincipalScopes(ctx);
  const workspaceId = ctx.workspaceId ?? "global";
  const actorLabel = ctx.user || resolveRequestedBy(ctx);
  const permCtx = permissionContext(ctx, tool, name);
  const runtimeEarly = getSecurityRuntime();
  const hasCredentialInfra =
    runtimeEarly.hubKeysConfigured ||
    !!process.env.OAUTH_INTROSPECTION_ENDPOINT?.trim();

  if (!hasCredentialInfra && !runtimeEarly.allowOpenPrincipal) {
    await auditToolAuthzDenial({
      phase: "scope",
      code: "insufficient_scope",
      reason: "hub_keys_or_open_hub_required",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
      metadata: { requiresAuth: true },
    });
    return {
      ok: false,
      error: {
        code: "insufficient_scope",
        message:
          "API keys are not configured and open hub mode is disabled. Set HUB_READ_KEY (etc.) or HUB_ALLOW_OPEN_HUB=true for local use only.",
      },
    };
  }

  if (hasCredentialInfra && !runtimeEarly.allowOpenPrincipal && scopes.length === 0) {
    await auditToolAuthzDenial({
      phase: "scope",
      code: "insufficient_scope",
      reason: "no_scopes",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
      metadata: { requiresAuth: true },
    });
    return {
      ok: false,
      error: {
        code: "insufficient_scope",
        message:
          "Authenticated scopes are required to run tools. Provide a valid API key or Bearer token.",
      },
    };
  }

  if (toolRequiresWriteOrHigher(tool) && maxScopeRank(scopes) < 1) {
    await auditToolAuthzDenial({
      phase: "scope",
      code: "insufficient_scope",
      reason: "write_scope_required",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
    });
    return {
      ok: false,
      error: {
        code: "insufficient_scope",
        message: "This tool requires write or admin scope.",
      },
    };
  }

  const runtime = runtimeEarly;

  const wsBoundary = assertRegisteredWorkspaceBoundary(ctx.workspaceId, runtime);
  if (wsBoundary) {
    await auditToolAuthzDenial({
      phase: "workspace_boundary",
      code: wsBoundary.error.code,
      reason: "workspace_not_registered",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
    });
    return wsBoundary;
  }

  const tenantDeny = assertTenantBoundary(ctx, runtime);
  if (tenantDeny) {
    await auditToolAuthzDenial({
      phase: "tenant",
      code: tenantDeny.error.code,
      reason: "missing_tenant_context",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
    });
    return tenantDeny;
  }

  const opType = inferOperationType(tool);
  const runPerm = await canRunTool(name, permCtx, opType);
  if (!runPerm.allowed) {
    await auditToolAuthzDenial({
      phase: "workspace_permission",
      code: "workspace_denied",
      reason: runPerm.reason || "denied",
      toolName: name,
      plugin: tool.plugin,
      actor: actorLabel,
      workspaceId,
      correlationId: ctx.requestId,
    });
    return {
      ok: false,
      error: {
        code: "workspace_forbidden",
        message: runPerm.reason || "Tool not allowed in this workspace context",
        details: { reason: runPerm.reason },
      },
    };
  }

  const callerWs = ctx.workspaceId ?? "global";
  for (const targetWs of collectWorkspaceIdsFromArgs(args)) {
    const cross = await checkCrossWorkspaceAccess(callerWs, targetWs, permCtx);
    if (!cross.allowed) {
      await auditToolAuthzDenial({
        phase: "workspace_boundary",
        code: "cross_workspace_forbidden",
        reason: cross.reason || "cross_workspace_access_denied",
        toolName: name,
        plugin: tool.plugin,
        actor: actorLabel,
        workspaceId,
        correlationId: ctx.requestId,
        metadata: { targetWorkspaceId: targetWs },
      });
      return {
        ok: false,
        error: {
          code: "cross_workspace_forbidden",
          message: cross.reason || "Cross-workspace access denied",
        },
      };
    }
  }

  const evaluate = getPolicyEvaluator();
  if (!evaluate) {
    if (
      toolRequiresWriteOrHigher(tool) &&
      !runtime.policyAllowMissingEvaluator
    ) {
      await auditToolAuthzDenial({
        phase: "policy",
        code: "policy_unavailable",
        reason: "policy_evaluator_required",
        toolName: name,
        plugin: tool.plugin,
        actor: actorLabel,
        workspaceId,
        correlationId: ctx.requestId,
        metadata: { requiresPolicy: true },
      });
      return {
        ok: false,
        error: {
          code: "policy_unavailable",
          message:
            "Policy engine is required for this tool. Load the policy plugin or set POLICY_ALLOW_MISSING_EVALUATOR=true (or TOOL_/POLICY_GUARD_ legacy) for local development only.",
        },
      };
    }
  } else {
    const method = ctx.method || "POST";
    const path = `/tools/${name}`;
    const policy = evaluate(method, path, args, resolveRequestedBy(ctx));
    if (!policy.allowed) {
      await auditToolAuthzDenial({
        phase: "policy",
        code: policy.action || "policy_denied",
        reason: policy.explanation || policy.reason || "policy",
        toolName: name,
        plugin: tool.plugin,
        actor: actorLabel,
        workspaceId,
        correlationId: ctx.requestId,
        metadata: { rule: policy.rule },
      });
      return {
        ok: false,
        error: {
          code: policy.action || "policy_denied",
          message: policy.explanation || policy.reason || "Request denied by policy",
          ...(policy.approval ? { approval: policy.approval } : {}),
          ...(policy.preview ? { preview: policy.preview } : {}),
        },
      };
    }
  }

  return null;
}
