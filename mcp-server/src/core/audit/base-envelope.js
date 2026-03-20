/**
 * Build hub telemetry metadata fields and resolve actor string for AuditManager.
 */

import { HUB_EVENT_SCHEMA_VERSION } from "./event-types.js";

/**
 * @param {unknown} actor
 * @returns {string}
 */
export function resolveActorString(actor) {
  if (actor == null) return "anonymous";
  if (typeof actor === "string") return actor;
  if (typeof actor === "object" && actor.subject) return String(actor.subject);
  if (typeof actor === "object" && actor.type === "open_hub") return "open_hub";
  if (typeof actor === "object" && Array.isArray(actor.scopes)) {
    return `actor:${actor.type || "unknown"}:${actor.scopes.join(",")}`;
  }
  return "anonymous";
}

/**
 * @param {object} [toolCtx] callTool context
 * @returns {object} flat metadata keys (hub*) for AuditManager.metadata
 */
export function hubMetadataFromToolContext(toolCtx = {}) {
  const ctx = toolCtx && typeof toolCtx === "object" ? toolCtx : {};
  const requestId =
    ctx.requestId != null ? String(ctx.requestId) : ctx.correlationId != null ? String(ctx.correlationId) : null;
  const correlationId =
    ctx.correlationId != null ? String(ctx.correlationId) : requestId;
  let transport = "internal";
  if (ctx.source === "mcp" || ctx.method === "MCP") transport = "mcp";
  else if (ctx.source === "rest" || ctx.source === "http") transport = "http";
  else if (ctx.source === "internal") transport = "internal";

  return {
    hubSchemaVersion: HUB_EVENT_SCHEMA_VERSION,
    hubTransport: transport,
    hubRequestId: requestId,
    hubCorrelationId: correlationId,
    hubSessionId: ctx.sessionId != null ? String(ctx.sessionId) : null,
    hubWorkspaceId: ctx.workspaceId != null ? String(ctx.workspaceId) : null,
    hubTenantId: ctx.tenantId != null ? String(ctx.tenantId) : null,
    hubProjectId: ctx.projectId != null ? String(ctx.projectId) : null,
    hubRpcId: ctx.requestId != null && ctx.method === "MCP" ? String(ctx.requestId) : null,
  };
}

/**
 * Merge hub metadata from ALS telemetry context (HTTP) with tool context (tool wins on conflicts).
 * @param {Record<string, unknown>|undefined} als
 * @param {Record<string, unknown>|undefined} toolMeta
 */
export function mergeHubMetadata(als, toolMeta) {
  const a = als && typeof als === "object" ? als : {};
  const b = toolMeta && typeof toolMeta === "object" ? toolMeta : {};
  const out = { ...a, ...b };
  return out;
}
