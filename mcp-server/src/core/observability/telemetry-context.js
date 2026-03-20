/**
 * AsyncLocalStorage-backed telemetry context for HTTP requests (requestId, correlation, transport).
 */

import { AsyncLocalStorage } from "async_hooks";
import { HUB_EVENT_SCHEMA_VERSION } from "../audit/event-types.js";

const storage = new AsyncLocalStorage();

/**
 * @typedef {Object} TelemetryContext
 * @property {string} [hubSchemaVersion]
 * @property {string} [requestId]
 * @property {string} [correlationId]
 * @property {string|null} [sessionId]
 * @property {"http"|"mcp"|"stdio"|"internal"} [transport]
 * @property {string|null} [workspaceId]
 * @property {string|null} [tenantId]
 * @property {string|null} [projectId]
 * @property {string|null} [actor]
 */

/**
 * @param {TelemetryContext} ctx
 * @param {() => void} next
 */
export function runWithTelemetryContext(ctx, next) {
  return storage.run(ctx, next);
}

/** @returns {TelemetryContext | undefined} */
export function getTelemetryContext() {
  return storage.getStore();
}

/**
 * Express middleware: populate ALS after security so req.user / req.actor exist.
 */
export function httpTelemetryContextMiddleware(req, res, next) {
  const requestId = req.requestId != null ? String(req.requestId) : undefined;
  const correlationId =
    req.correlationId != null ? String(req.correlationId) : requestId;
  const actor =
    req.user?.email ||
    req.user?.id ||
    (req.actor && (req.actor.subject || req.actor.id)) ||
    null;

  const ctx = {
    hubSchemaVersion: HUB_EVENT_SCHEMA_VERSION,
    requestId,
    correlationId,
    transport: /** @type {const} */ ("http"),
    sessionId: null,
    workspaceId: req.workspaceId ?? null,
    tenantId: req.tenantId ?? null,
    projectId: req.projectId ?? null,
    actor: actor != null ? String(actor) : null,
  };

  runWithTelemetryContext(ctx, () => next());
}

/**
 * Flatten ALS + hub defaults for emit-hub-event metadata merge.
 * @returns {Record<string, string|null|number|boolean>|undefined}
 */
export function getTelemetryContextAsHubMeta() {
  const t = getTelemetryContext();
  if (!t) return undefined;
  return {
    hubSchemaVersion: HUB_EVENT_SCHEMA_VERSION,
    hubTransport: t.transport ?? "http",
    hubRequestId: t.requestId ?? null,
    hubSessionId: t.sessionId ?? null,
    hubCorrelationId: t.correlationId ?? t.requestId ?? null,
    hubWorkspaceId: t.workspaceId ?? null,
    hubTenantId: t.tenantId ?? null,
    hubProjectId: t.projectId ?? null,
  };
}
