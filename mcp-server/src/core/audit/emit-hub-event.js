/**
 * Central hub audit emit: AuditManager + metrics from one path.
 */

import { auditEmit } from "./audit.manager.js";
import { generateCorrelationId } from "./audit.standard.js";
import { recordMetricFromHubEvent } from "../observability/record-metric-from-hub-event.js";
import { mergeHubMetadata, resolveActorString, hubMetadataFromToolContext } from "./base-envelope.js";
import {
  getTelemetryContextAsHubMeta,
  getTelemetryContext,
} from "../observability/telemetry-context.js";
import { HubEventTypes, HubOutcomes } from "./event-types.js";

/**
 * @typedef {Object} EmitHubAuditParams
 * @property {string} eventType
 * @property {string} [outcome]
 * @property {string} [plugin]
 * @property {string} [actor]
 * @property {string} [workspaceId]
 * @property {string|null} [projectId]
 * @property {string} [correlationId]
 * @property {number} [durationMs]
 * @property {boolean} [allowed]
 * @property {boolean} [success]
 * @property {string} [reason]
 * @property {string} [error]
 * @property {object} [toolContext]
 * @property {Record<string, string|number|boolean|null>} [metadata]
 */

/**
 * @param {EmitHubAuditParams} params
 * @returns {Promise<void>}
 */
export async function emitHubAuditEvent(params) {
  const {
    eventType,
    outcome = HubOutcomes.UNKNOWN,
    plugin = "core",
    actor: actorParam,
    workspaceId: workspaceIdParam,
    projectId = null,
    correlationId: correlationIdParam,
    durationMs = 0,
    allowed = true,
    success = true,
    reason = undefined,
    error = undefined,
    toolContext = undefined,
    metadata: extraMeta = undefined,
  } = params;

  const fromTool = toolContext ? hubMetadataFromToolContext(toolContext) : {};
  const fromAls = getTelemetryContextAsHubMeta();
  const mergedHub = mergeHubMetadata(fromAls || {}, fromTool);

  const correlationId =
    correlationIdParam != null && String(correlationIdParam).length > 0
      ? String(correlationIdParam)
      : mergedHub.hubCorrelationId != null
        ? String(mergedHub.hubCorrelationId)
        : generateCorrelationId();

  const tel = getTelemetryContext();
  const actor =
    actorParam != null && String(actorParam).length > 0
      ? String(actorParam)
      : toolContext
        ? resolveActorString(toolContext.actor ?? toolContext.user)
        : tel?.actor != null
          ? String(tel.actor)
          : "anonymous";

  const wsTel = tel?.workspaceId != null ? String(tel.workspaceId) : null;
  const ws =
    workspaceIdParam != null && workspaceIdParam !== "global"
      ? String(workspaceIdParam)
      : toolContext?.workspaceId != null
        ? String(toolContext.workspaceId)
        : wsTel ?? (mergedHub.hubWorkspaceId != null ? String(mergedHub.hubWorkspaceId) : "global");

  const proj =
    projectId != null
      ? projectId
      : toolContext?.projectId != null
        ? toolContext.projectId
        : mergedHub.hubProjectId;

  const metadata = {
    ...mergedHub,
    hubEventType: eventType,
    hubOutcome: outcome,
    ...(extraMeta && typeof extraMeta === "object" ? extraMeta : {}),
  };

  /** @type {import("./audit.standard.js").AuditEvent} */
  const event = {
    timestamp: new Date().toISOString(),
    plugin,
    operation: eventType,
    actor,
    workspaceId: ws,
    projectId: proj ?? null,
    correlationId,
    allowed,
    success,
    durationMs,
    ...(reason != null && { reason }),
    ...(error != null && { error }),
    metadata,
  };

  try {
    await auditEmit(event);
  } catch {
    /* best-effort */
  }

  try {
    recordMetricFromHubEvent(eventType, {
      outcome,
      durationMs,
      toolName: typeof metadata.hubToolName === "string" ? metadata.hubToolName : undefined,
      plugin: typeof metadata.hubPlugin === "string" ? metadata.hubPlugin : plugin,
      transport: typeof metadata.hubTransport === "string" ? metadata.hubTransport : undefined,
      phase: typeof metadata.hubPhase === "string" ? metadata.hubPhase : undefined,
      httpMethod: typeof metadata.hubHttpMethod === "string" ? metadata.hubHttpMethod : undefined,
      statusClass: typeof metadata.hubStatusClass === "string" ? metadata.hubStatusClass : undefined,
      statusCode: typeof metadata.hubStatusCode === "number" ? metadata.hubStatusCode : undefined,
      discoverySurface:
        typeof metadata.hubDiscoverySurface === "string" ? metadata.hubDiscoverySurface : undefined,
      jobType: typeof metadata.hubJobType === "string" ? metadata.hubJobType : undefined,
      jobQueue: typeof metadata.hubJobQueue === "string" ? metadata.hubJobQueue : undefined,
      jobFailureReason:
        typeof metadata.hubFailureReason === "string" ? metadata.hubFailureReason : undefined,
      jobCancelSource:
        typeof metadata.hubCancelSource === "string" ? metadata.hubCancelSource : undefined,
    });
  } catch (err) {
    console.error("[emit-hub-event] metrics failed:", err.message);
  }
}

/**
 * @param {object} p
 * @param {string} p.transport
 * @param {string} p.discoverySurface — {@link ./discovery-surfaces.js DiscoverySurfaces}
 * @param {string} [p.correlationId]
 * @param {string} [p.sessionId]
 * @param {string} [p.workspaceId]
 * @param {string} [p.actor]
 * @param {string|null} [p.tenantId]
 * @param {number} p.totalCount
 * @param {number} p.visibleCount
 * @param {number} [p.filteredCount] — if omitted, max(0, totalCount - visibleCount)
 * @param {string} [p.httpMethod]
 * @param {string} [p.httpPath]
 */
export async function emitDiscoveryFilteredEvent(p) {
  const {
    transport,
    discoverySurface,
    correlationId,
    sessionId,
    workspaceId = "global",
    actor = "anonymous",
    tenantId,
    totalCount,
    visibleCount,
    filteredCount: filteredCountParam,
    httpMethod,
    httpPath,
  } = p;

  const filteredCount =
    typeof filteredCountParam === "number"
      ? filteredCountParam
      : Math.max(0, totalCount - visibleCount);

  await emitHubAuditEvent({
    eventType: HubEventTypes.DISCOVERY_FILTERED,
    outcome: HubOutcomes.SUCCESS,
    plugin: "core",
    actor,
    workspaceId,
    correlationId: correlationId ?? generateCorrelationId(),
    durationMs: 0,
    allowed: true,
    success: true,
    toolContext: {
      workspaceId,
      tenantId: tenantId ?? null,
      correlationId,
      sessionId,
      source: transport === "mcp" ? "mcp" : "http",
      method: transport === "mcp" ? "MCP" : undefined,
    },
    metadata: {
      hubDiscoverySurface: discoverySurface,
      hubTotalCount: totalCount,
      hubVisibleCount: visibleCount,
      hubFilteredCount: filteredCount,
      hubTransport: transport,
      ...(httpMethod != null && { hubHttpMethod: httpMethod }),
      ...(httpPath != null && { hubHttpPath: httpPath }),
    },
  });
}

/**
 * @param {object} p
 * @param {string} p.transport
 * @param {string} p.discoverySurface
 * @param {string} [p.correlationId]
 * @param {string} [p.sessionId]
 * @param {string} [p.workspaceId]
 * @param {string} [p.actor]
 * @param {string|null} [p.tenantId]
 * @param {string} [p.httpMethod]
 * @param {string} [p.httpPath]
 */
export async function emitDiscoveryRequestedEvent(p) {
  const {
    transport,
    discoverySurface,
    correlationId,
    sessionId,
    workspaceId = "global",
    actor = "anonymous",
    tenantId,
    httpMethod,
    httpPath,
  } = p;

  await emitHubAuditEvent({
    eventType: HubEventTypes.DISCOVERY_REQUESTED,
    outcome: HubOutcomes.UNKNOWN,
    plugin: "core",
    actor,
    workspaceId,
    correlationId: correlationId ?? generateCorrelationId(),
    durationMs: 0,
    allowed: true,
    success: true,
    toolContext: {
      workspaceId,
      tenantId: tenantId ?? null,
      correlationId,
      sessionId,
      source: transport === "mcp" ? "mcp" : "http",
      method: transport === "mcp" ? "MCP" : undefined,
    },
    metadata: {
      hubDiscoverySurface: discoverySurface,
      hubTransport: transport,
      ...(httpMethod != null && { hubHttpMethod: httpMethod }),
      ...(httpPath != null && { hubHttpPath: httpPath }),
    },
  });
}
