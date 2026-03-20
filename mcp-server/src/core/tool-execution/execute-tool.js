/**
 * Central tool execution pipeline (before hooks → validate → timeout → handler → audit → after hooks).
 */

import { executeBeforeHooks, executeAfterHooks } from "../tool-hooks.js";
import { validateToolArgs } from "./validate-input.js";
import { withTimeout } from "./with-timeout.js";
import {
  normalizeHandlerResult,
  normalizeShortCircuitResult,
  validationErrorEnvelope,
} from "./normalize-result.js";
import { maskToolAuditPayload } from "./mask-sensitive-data.js";
import { authorizeToolCall } from "../authorization/authorize-tool-call.js";
import { emitHubAuditEvent } from "../audit/emit-hub-event.js";
import { HubEventTypes, HubOutcomes } from "../audit/event-types.js";
import { resolveActorString } from "../audit/base-envelope.js";

function defaultTimeoutMs(tool) {
  if (tool?.timeoutMs != null && tool.timeoutMs >= 0) {
    return tool.timeoutMs;
  }
  const envNumber = Number(process.env.TOOL_EXECUTION_TIMEOUT_MS);
  if (Number.isFinite(envNumber) && envNumber >= 0) {
    return envNumber;
  }
  return 120000;
}

function coerceArgs(args) {
  if (args == null) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args;
  return {};
}

/** Secondary / debug channel — off in production unless TOOL_AUDIT_STDERR=true */
function shouldWriteStderrToolAudit() {
  return (
    process.env.TOOL_AUDIT_STDERR === "true" ||
    (process.env.NODE_ENV !== "production" && process.env.TOOL_AUDIT_STDERR !== "false")
  );
}

function writeToolAuditLineDebug(payload) {
  if (!shouldWriteStderrToolAudit()) return;
  const logLine = JSON.stringify({
    type: "tool_audit_debug",
    ...maskToolAuditPayload(payload),
  });
  console.error(logLine);
}

/**
 * @param {object} p
 * @param {string} p.eventType
 * @param {string} p.outcome
 * @param {string} p.name
 * @param {object} p.tool
 * @param {object} p.ctx
 * @param {object} p.normalizedArgs
 * @param {number} p.durationMs
 * @param {boolean} p.allowed
 * @param {boolean} p.success
 * @param {string} [p.reason]
 * @param {string} [p.error]
 * @param {string} [p.phase]
 * @param {string} [p.errorCode]
 */
async function emitToolExecutionHub(p) {
  const {
    eventType,
    outcome,
    name,
    tool,
    ctx,
    normalizedArgs,
    durationMs,
    allowed,
    success,
    reason,
    error,
    phase,
    errorCode,
  } = p;

  await emitHubAuditEvent({
    eventType,
    outcome,
    plugin: tool?.plugin ?? "core",
    actor: resolveActorString(ctx.actor ?? ctx.user),
    workspaceId: ctx.workspaceId != null ? String(ctx.workspaceId) : "global",
    projectId: ctx.projectId ?? null,
    correlationId:
      ctx.correlationId != null
        ? String(ctx.correlationId)
        : ctx.requestId != null
          ? String(ctx.requestId)
          : undefined,
    durationMs,
    allowed,
    success,
    reason,
    error,
    toolContext: ctx,
    metadata: {
      hubToolName: name,
      hubPlugin: tool?.plugin ?? "unknown",
      hubPhase: phase ?? null,
      hubArgKeyCount: Object.keys(normalizedArgs).length,
      ...(errorCode ? { hubErrorCode: errorCode } : {}),
    },
  });
}

/**
 * @param {object} params
 * @param {string} params.name
 * @param {object} params.tool - Registry tool record
 * @param {object} params.args
 * @param {object} params.context
 * @returns {Promise<object>}
 */
export async function executeRegisteredTool({ name, tool, args, context }) {
  const started = Date.now();
  const ctx = context && typeof context === "object" ? context : {};
  const normalizedArgs = coerceArgs(args);

  await emitToolExecutionHub({
    eventType: HubEventTypes.TOOL_EXECUTION_STARTED,
    outcome: HubOutcomes.UNKNOWN,
    name,
    tool,
    ctx,
    normalizedArgs,
    durationMs: 0,
    allowed: true,
    success: true,
    phase: "started",
  });

  const authzBlock = await authorizeToolCall({ name, tool, args: normalizedArgs, context: ctx });
  if (authzBlock) {
    const duration = Date.now() - started;
    const out = normalizeShortCircuitResult(authzBlock, ctx, duration);
    writeToolAuditLineDebug({
      toolName: name,
      timestamp: new Date().toISOString(),
      projectId: ctx.projectId,
      parameters: normalizedArgs,
      result: out,
      duration,
      user: ctx.user,
      approvalId: ctx.approvalId,
      failed: !out.ok,
      phase: "authorization",
    });
    await executeAfterHooks(name, normalizedArgs, ctx, out);
    return out;
  }

  const short = await executeBeforeHooks(name, normalizedArgs, ctx);
  if (short) {
    const duration = Date.now() - started;
    const out = normalizeShortCircuitResult(short, ctx, duration);
    const code = out.error?.code;
    if (code === "require_approval") {
      await emitToolExecutionHub({
        eventType: HubEventTypes.TOOL_EXECUTION_APPROVAL_REQUIRED,
        outcome: HubOutcomes.PENDING,
        name,
        tool,
        ctx,
        normalizedArgs,
        durationMs: duration,
        allowed: true,
        success: true,
        phase: "before_hook",
        errorCode: code,
      });
    } else {
      await emitToolExecutionHub({
        eventType: HubEventTypes.TOOL_EXECUTION_FAILED,
        outcome: HubOutcomes.FAILURE,
        name,
        tool,
        ctx,
        normalizedArgs,
        durationMs: duration,
        allowed: true,
        success: false,
        error: code,
        phase: "before_hook",
        errorCode: code,
      });
    }
    writeToolAuditLineDebug({
      toolName: name,
      timestamp: new Date().toISOString(),
      projectId: ctx.projectId,
      parameters: normalizedArgs,
      result: out,
      duration,
      user: ctx.user,
      approvalId: ctx.approvalId,
      failed: !out.ok,
      phase: "before_hook",
    });
    await executeAfterHooks(name, normalizedArgs, ctx, out);
    return out;
  }

  const validation = validateToolArgs(tool.inputSchema, normalizedArgs);
  if (!validation.ok) {
    const duration = Date.now() - started;
    const out = validationErrorEnvelope(validation.errors, ctx, duration);
    await emitToolExecutionHub({
      eventType: HubEventTypes.TOOL_EXECUTION_FAILED,
      outcome: HubOutcomes.FAILURE,
      name,
      tool,
      ctx,
      normalizedArgs,
      durationMs: duration,
      allowed: true,
      success: false,
      error: "validation_failed",
      phase: "validation",
      errorCode: "validation_failed",
    });
    writeToolAuditLineDebug({
      toolName: name,
      timestamp: new Date().toISOString(),
      projectId: ctx.projectId,
      parameters: normalizedArgs,
      result: out,
      duration,
      user: ctx.user,
      approvalId: ctx.approvalId,
      failed: true,
      phase: "validation",
    });
    await executeAfterHooks(name, normalizedArgs, ctx, out);
    return out;
  }

  const timeoutMs = defaultTimeoutMs(tool);
  let out;
  try {
    const run = tool.handler(normalizedArgs, ctx);
    const finished = await withTimeout(Promise.resolve(run), timeoutMs, {
      code: "tool_timeout",
      message: `Tool '${name}' exceeded timeout of ${timeoutMs}ms`,
    });
    out = normalizeHandlerResult(finished, ctx, Date.now() - started);
  } catch (err) {
    const duration = Date.now() - started;
    out = {
      ok: false,
      error: {
        code: err.code || "tool_execution_error",
        message: err.message || "Tool execution failed",
        ...(err.details ? { details: err.details } : {}),
      },
      meta: {
        ...(ctx.requestId != null ? { requestId: ctx.requestId } : {}),
        durationMs: duration,
      },
    };
  }

  const durationFinal = out.meta?.durationMs ?? Date.now() - started;

  if (out.ok) {
    await emitToolExecutionHub({
      eventType: HubEventTypes.TOOL_EXECUTION_COMPLETED,
      outcome: HubOutcomes.SUCCESS,
      name,
      tool,
      ctx,
      normalizedArgs,
      durationMs: durationFinal,
      allowed: true,
      success: true,
      phase: "handler",
    });
  } else if (out.error?.code === "tool_timeout") {
    await emitToolExecutionHub({
      eventType: HubEventTypes.TOOL_EXECUTION_TIMED_OUT,
      outcome: HubOutcomes.FAILURE,
      name,
      tool,
      ctx,
      normalizedArgs,
      durationMs: durationFinal,
      allowed: true,
      success: false,
      error: "tool_timeout",
      phase: "handler",
      errorCode: "tool_timeout",
    });
  } else if (out.error?.code === "require_approval") {
    await emitToolExecutionHub({
      eventType: HubEventTypes.TOOL_EXECUTION_APPROVAL_REQUIRED,
      outcome: HubOutcomes.PENDING,
      name,
      tool,
      ctx,
      normalizedArgs,
      durationMs: durationFinal,
      allowed: true,
      success: true,
      phase: "handler",
      errorCode: "require_approval",
    });
  } else {
    await emitToolExecutionHub({
      eventType: HubEventTypes.TOOL_EXECUTION_FAILED,
      outcome: HubOutcomes.FAILURE,
      name,
      tool,
      ctx,
      normalizedArgs,
      durationMs: durationFinal,
      allowed: true,
      success: false,
      error: out.error?.code,
      phase: "handler",
      errorCode: out.error?.code,
    });
  }

  writeToolAuditLineDebug({
    toolName: name,
    timestamp: new Date().toISOString(),
    projectId: ctx.projectId,
    parameters: normalizedArgs,
    result: out,
    duration: durationFinal,
    user: ctx.user,
    approvalId: ctx.approvalId,
    failed: !out.ok,
    phase: "handler",
  });

  await executeAfterHooks(name, normalizedArgs, ctx, out);
  return out;
}
