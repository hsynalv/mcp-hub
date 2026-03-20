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

function defaultTimeoutMs(tool) {
  if (tool?.timeoutMs != null && tool.timeoutMs >= 0) {
    return tool.timeoutMs;
  }
  const env = Number(process.env.TOOL_EXECUTION_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 0) {
    return env;
  }
  return 120000;
}

function coerceArgs(args) {
  if (args == null) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args;
  return {};
}

function writeToolAuditLine(payload) {
  const logLine = JSON.stringify({
    type: "tool_audit",
    ...maskToolAuditPayload(payload),
  });
  console.error(logLine);
}

async function emitToolMetrics(name, tool, out, startedAt) {
  try {
    const { recordToolCall } = await import("../observability/tools.metrics.js");
    const plugin = tool?.plugin ?? "unknown";
    const status = out.ok ? "success" : "error";
    const dur =
      typeof out.meta?.durationMs === "number"
        ? out.meta.durationMs
        : Date.now() - startedAt;
    recordToolCall(name, plugin, status, dur);
  } catch (err) {
    console.error("[execute-tool] metrics failed:", err.message);
  }
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

  const authzBlock = await authorizeToolCall({ name, tool, args: normalizedArgs, context: ctx });
  if (authzBlock) {
    const duration = Date.now() - started;
    const out = normalizeShortCircuitResult(authzBlock, ctx, duration);
    writeToolAuditLine({
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
    await emitToolMetrics(name, tool, out, started);
    await executeAfterHooks(name, normalizedArgs, ctx, out);
    return out;
  }

  const short = await executeBeforeHooks(name, normalizedArgs, ctx);
  if (short) {
    const duration = Date.now() - started;
    const out = normalizeShortCircuitResult(short, ctx, duration);
    writeToolAuditLine({
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
    await emitToolMetrics(name, tool, out, started);
    await executeAfterHooks(name, normalizedArgs, ctx, out);
    return out;
  }

  const validation = validateToolArgs(tool.inputSchema, normalizedArgs);
  if (!validation.ok) {
    const duration = Date.now() - started;
    const out = validationErrorEnvelope(validation.errors, ctx, duration);
    writeToolAuditLine({
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
    await emitToolMetrics(name, tool, out, started);
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

  writeToolAuditLine({
    toolName: name,
    timestamp: new Date().toISOString(),
    projectId: ctx.projectId,
    parameters: normalizedArgs,
    result: out,
    duration: out.meta?.durationMs ?? Date.now() - started,
    user: ctx.user,
    approvalId: ctx.approvalId,
    failed: !out.ok,
    phase: "handler",
  });

  await emitToolMetrics(name, tool, out, started);
  await executeAfterHooks(name, normalizedArgs, ctx, out);
  return out;
}
