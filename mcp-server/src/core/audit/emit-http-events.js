/**
 * HTTP hub audit: request lifecycle + normalized denies (AuditManager + metrics via emitHubAuditEvent).
 */

import { isPublicSecurityPath } from "../security/public-http-paths.js";
import { emitHubAuditEvent } from "./emit-hub-event.js";
import { HubEventTypes, HubOutcomes } from "./event-types.js";
import { normalizeHttpDenyEvent } from "./normalize-http-deny.js";
import { resolveActorString } from "./base-envelope.js";

/**
 * Safe HTTP fields for hub metadata (no query string, no bodies).
 * @param {import("express").Request} req
 */
export function buildHttpHubMetadata(req) {
  const requestId =
    req.requestId != null
      ? String(req.requestId)
      : req.headers["x-request-id"]?.toString?.().trim?.() || null;
  const correlationId = req.correlationId != null ? String(req.correlationId) : requestId;
  return {
    hubTransport: "http",
    hubHttpMethod: req.method,
    hubHttpPath: req.path,
    hubRequestId: requestId,
    hubCorrelationId: correlationId,
  };
}

function httpActorFromReq(req) {
  return resolveActorString(req.actor);
}

/**
 * @param {import("express").Request} req
 */
export async function emitHttpRequestReceived(req) {
  const ws = req.workspaceId != null ? String(req.workspaceId) : "global";
  await emitHubAuditEvent({
    eventType: HubEventTypes.HTTP_REQUEST_RECEIVED,
    outcome: HubOutcomes.UNKNOWN,
    plugin: "core",
    actor: httpActorFromReq(req),
    workspaceId: ws,
    correlationId:
      req.correlationId != null
        ? String(req.correlationId)
        : req.requestId != null
          ? String(req.requestId)
          : undefined,
    durationMs: 0,
    allowed: true,
    success: true,
    metadata: buildHttpHubMetadata(req),
  });
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {number} durationMs
 */
export async function emitHttpRequestCompleted(req, res, durationMs) {
  const code = res.statusCode;
  const ws = req.workspaceId != null ? String(req.workspaceId) : "global";
  const statusClass =
    code >= 500 ? "5xx" : code >= 400 ? "4xx" : code >= 300 ? "3xx" : "2xx";

  let outcome = HubOutcomes.SUCCESS;
  if (code >= 500) outcome = HubOutcomes.FAILURE;
  else if (code >= 400) outcome = HubOutcomes.DENIED;

  await emitHubAuditEvent({
    eventType: HubEventTypes.HTTP_REQUEST_COMPLETED,
    outcome,
    plugin: "core",
    actor: httpActorFromReq(req),
    workspaceId: ws,
    correlationId:
      req.correlationId != null
        ? String(req.correlationId)
        : req.requestId != null
          ? String(req.requestId)
          : undefined,
    durationMs,
    allowed: code < 400,
    success: code < 500,
    metadata: {
      ...buildHttpHubMetadata(req),
      hubStatusCode: code,
      hubStatusClass: statusClass,
    },
  });
}

/**
 * @param {import("express").Request} req
 * @param {object} detail — see {@link normalizeHttpDenyEvent}
 */
export async function emitHttpDenyHubEvent(req, detail) {
  if (req.hubHttpDenyAuditEmitted) {
    return;
  }
  req.hubHttpDenyAuditEmitted = true;

  const norm = normalizeHttpDenyEvent(detail);
  const ws = req.workspaceId != null ? String(req.workspaceId) : "global";

  await emitHubAuditEvent({
    eventType: norm.eventType,
    outcome: HubOutcomes.DENIED,
    plugin: "core",
    actor: httpActorFromReq(req),
    workspaceId: ws,
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
    metadata: {
      ...buildHttpHubMetadata(req),
      ...norm.metadata,
    },
  });
}

/**
 * After {@link ../audit.js auditMiddleware} so `req.requestId` is final. Skips public/static paths (same as security bypass).
 * @type {import("express").RequestHandler}
 */
export function httpHubAuditLifecycleMiddleware(req, res, next) {
  if (isPublicSecurityPath(req)) {
    return next();
  }

  const start = Date.now();
  void emitHttpRequestReceived(req).catch(() => {});

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    void emitHttpRequestCompleted(req, res, durationMs).catch(() => {});
  });

  next();
}
