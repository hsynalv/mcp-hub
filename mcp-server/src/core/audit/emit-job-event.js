/**
 * Job lifecycle hub telemetry: one path via emitHubAuditEvent (AuditManager + metrics).
 */

import { emitHubAuditEvent } from "./emit-hub-event.js";
import { HubEventTypes, HubOutcomes } from "./event-types.js";
import { resolveActorString } from "./base-envelope.js";

/** @typedef {"submitted"|"started"|"completed"|"failed"|"cancelled"} JobLifecyclePhase */
/** @typedef {"user"|"system"|"timeout"} JobCancelSource */

const PHASE_TO_EVENT = {
  submitted: HubEventTypes.JOB_SUBMITTED,
  started: HubEventTypes.JOB_STARTED,
  completed: HubEventTypes.JOB_COMPLETED,
  failed: HubEventTypes.JOB_FAILED,
  cancelled: HubEventTypes.JOB_CANCELLED,
};

/**
 * Derive audit plugin segment from job type (e.g. rag.ingestion → rag).
 * @param {string} type
 * @returns {string}
 */
export function pluginFromJobType(type) {
  if (typeof type !== "string" || !type.length) return "core";
  const i = type.indexOf(".");
  return i > 0 ? type.slice(0, i) : "core";
}

/**
 * @param {Record<string, unknown>} ctx
 * @returns {"rest"|"mcp"|"internal"}
 */
export function resolveJobInvokeSource(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (c.invokeSource === "mcp" || c.invokeSource === "rest" || c.invokeSource === "internal") {
    return c.invokeSource;
  }
  if (c.source === "mcp" || c.method === "MCP") return "mcp";
  if (c.source === "rest" || c.source === "http") return "rest";
  return "internal";
}

/**
 * Map invoke source to toolContext.source for hub metadata (rest | mcp | internal).
 * @param {"rest"|"mcp"|"internal"} invoke
 */
function toolSourceForHub(invoke) {
  return invoke;
}

/**
 * @param {object} job
 * @param {string} job.id
 * @param {string} job.type
 * @param {object} [job.context]
 * @param {JobLifecyclePhase} phase
 * @param {object} [extra]
 * @param {string} [extra.queueBackend] — "redis" | "memory"
 * @param {number} [extra.durationMs]
 * @param {string} [extra.error]
 * @param {JobCancelSource} [extra.cancelSource]
 * @param {string} [extra.failureReason] — e.g. orphan_timeout
 * @returns {Promise<void>}
 */
export async function emitJobLifecycleHubEvent(job, phase, extra = {}) {
  const eventType = PHASE_TO_EVENT[phase];
  if (!eventType || !job || typeof job !== "object") return;

  const { queueBackend, durationMs = 0, error, cancelSource, failureReason } = extra;
  const ctx = job.context && typeof job.context === "object" ? job.context : {};
  const correlationRaw = ctx.correlationId ?? ctx.requestId;
  const correlationId =
    correlationRaw != null && String(correlationRaw).length > 0 ? String(correlationRaw) : undefined;

  const invokeSource = resolveJobInvokeSource(ctx);
  const srcForCtx = toolSourceForHub(invokeSource);

  const isCancelled = phase === "cancelled";
  const isTerminalFail = phase === "failed";
  const isTerminalOk = phase === "completed";

  /** @type {JobCancelSource | undefined} */
  const cancelSrc =
    cancelSource != null && ["user", "system", "timeout"].includes(String(cancelSource))
      ? /** @type {JobCancelSource} */ (String(cancelSource))
      : isCancelled
        ? "user"
        : undefined;

  await emitHubAuditEvent({
    eventType,
    outcome:
      isTerminalFail
        ? HubOutcomes.FAILURE
        : isTerminalOk || isCancelled
          ? HubOutcomes.SUCCESS
          : HubOutcomes.UNKNOWN,
    plugin: pluginFromJobType(job.type),
    actor: resolveActorString(ctx.userId ?? ctx.actorId),
    workspaceId: ctx.workspaceId != null ? String(ctx.workspaceId) : "global",
    projectId: ctx.projectId ?? null,
    correlationId,
    durationMs: typeof durationMs === "number" ? durationMs : 0,
    allowed: true,
    success: !isTerminalFail,
    ...(error != null && String(error).length > 0 && { error: String(error) }),
    toolContext: {
      workspaceId: ctx.workspaceId != null ? String(ctx.workspaceId) : "global",
      tenantId: ctx.tenantId ?? null,
      correlationId,
      projectId: ctx.projectId != null ? String(ctx.projectId) : null,
      source: srcForCtx,
    },
    metadata: {
      hubJobId: job.id,
      hubJobType: job.type,
      hubInvokeSource: invokeSource,
      ...(queueBackend != null && { hubJobQueue: String(queueBackend) }),
      ...(isCancelled && {
        hubJobStatus: "cancelled",
        ...(cancelSrc != null && { hubCancelSource: cancelSrc }),
      }),
      ...(correlationId != null && { hubCorrelationId: correlationId }),
      ...(failureReason != null &&
        String(failureReason).length > 0 && { hubFailureReason: String(failureReason) }),
    },
  });
}
