/**
 * REST discovery → same hub event family as MCP ListTools (AuditManager + metrics).
 */

import { emitHubAuditEvent, emitDiscoveryRequestedEvent, emitDiscoveryFilteredEvent } from "./emit-hub-event.js";
import { HubEventTypes, HubOutcomes } from "./event-types.js";
import { normalizeDiscoveryDeny } from "./normalize-discovery-deny.js";
import { resolveActorString } from "./base-envelope.js";

function actorFromReq(req) {
  return resolveActorString(req?.actor);
}

function workspaceFromReq(req) {
  return req?.workspaceId != null ? String(req.workspaceId) : "global";
}

/**
 * @param {import("express").Request} req
 * @param {string} discoverySurface
 */
export async function emitRestDiscoveryRequested(req, discoverySurface) {
  await emitDiscoveryRequestedEvent({
    transport: "http",
    discoverySurface,
    correlationId: req.correlationId,
    sessionId: undefined,
    workspaceId: workspaceFromReq(req),
    tenantId: req.tenantId ?? null,
    actor: actorFromReq(req),
    httpMethod: req.method,
    httpPath: req.path,
  });
}

/**
 * @param {import("express").Request} req
 * @param {string} discoverySurface
 * @param {{ totalCandidates: number, visibleCount: number }} counts
 */
export async function emitRestDiscoveryFiltered(req, discoverySurface, counts) {
  const { totalCandidates, visibleCount } = counts;
  const filteredCount = Math.max(0, totalCandidates - visibleCount);
  await emitDiscoveryFilteredEvent({
    transport: "http",
    discoverySurface,
    correlationId: req.correlationId,
    sessionId: undefined,
    workspaceId: workspaceFromReq(req),
    tenantId: req.tenantId ?? null,
    actor: actorFromReq(req),
    totalCount: totalCandidates,
    visibleCount,
    filteredCount,
    httpMethod: req.method,
    httpPath: req.path,
  });
}

/**
 * @param {import("express").Request} req
 * @param {string} discoverySurface
 * @param {object} detail — passed to {@link normalizeDiscoveryDeny}
 */
export async function emitRestDiscoveryDenied(req, discoverySurface, detail) {
  const norm = normalizeDiscoveryDeny(detail);
  await emitHubAuditEvent({
    eventType: HubEventTypes.DISCOVERY_DENIED,
    outcome: HubOutcomes.DENIED,
    plugin: "core",
    actor: actorFromReq(req),
    workspaceId: workspaceFromReq(req),
    correlationId:
      req.correlationId != null
        ? String(req.correlationId)
        : req.requestId != null
          ? String(req.requestId)
          : undefined,
    durationMs: 0,
    allowed: false,
    success: false,
    reason: norm.reason,
    toolContext: {
      workspaceId: workspaceFromReq(req),
      tenantId: req.tenantId ?? null,
      correlationId: req.correlationId,
      sessionId: undefined,
      source: "http",
      method: req.method,
    },
    metadata: {
      hubDiscoverySurface: discoverySurface,
      hubTransport: "http",
      hubHttpMethod: req.method,
      hubHttpPath: req.path,
      ...norm.metadata,
    },
  });
}
