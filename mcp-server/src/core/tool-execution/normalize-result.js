/**
 * Standard tool result envelope: { ok, data?, error?, meta }.
 */

/**
 * @param {object} context
 * @param {number} durationMs
 * @returns {object}
 */
function baseMeta(context, durationMs) {
  const meta = {
    ...(context.requestId != null ? { requestId: context.requestId } : {}),
    durationMs,
  };
  return meta;
}

/**
 * Normalize before-hook / policy short-circuit payloads to the standard envelope.
 * @param {*} raw
 * @param {object} context
 * @param {number} durationMs
 * @returns {{ ok: boolean, data?: *, error?: object, meta: object }}
 */
export function normalizeShortCircuitResult(raw, context, durationMs) {
  if (raw && typeof raw === "object" && raw.ok === false) {
    if (raw.status === "approval_required" || (raw.approval && !raw.error)) {
      return {
        ok: false,
        error: {
          code: "require_approval",
          message: raw.message || "Approval required",
          ...(raw.approval ? { approval: raw.approval } : {}),
          ...(raw.tool ? { tool: raw.tool } : {}),
          ...(raw.explanation ? { explanation: raw.explanation } : {}),
        },
        meta: { ...baseMeta(context, durationMs), ...(raw.meta || {}) },
      };
    }

    if (raw.error && typeof raw.error === "object" && typeof raw.error.code === "string") {
      return {
        ok: false,
        error: {
          code: raw.error.code,
          message: raw.error.message || "Request failed",
          ...(raw.error.details ? { details: raw.error.details } : {}),
          ...(raw.error.approval ? { approval: raw.error.approval } : {}),
          ...(raw.error.preview ? { preview: raw.error.preview } : {}),
        },
        meta: { ...baseMeta(context, durationMs), ...(raw.meta || {}) },
      };
    }

    return {
      ok: false,
      error: {
        code: "tool_blocked",
        message: raw.message || "Tool execution was blocked",
      },
      meta: { ...baseMeta(context, durationMs), ...(raw.meta || {}) },
    };
  }

  return {
    ok: false,
    error: {
      code: "tool_blocked",
      message: "Tool execution was blocked",
    },
    meta: baseMeta(context, durationMs),
  };
}

/**
 * Normalize handler return value to standard envelope.
 * @param {*} result
 * @param {object} context
 * @param {number} durationMs
 * @returns {{ ok: boolean, data?: *, error?: object, meta: object }}
 */
export function normalizeHandlerResult(result, context, durationMs) {
  const meta = baseMeta(context, durationMs);

  if (result && typeof result === "object" && (result.ok === true || result.ok === false)) {
    const mergedMeta = { ...meta, ...(result.meta && typeof result.meta === "object" ? result.meta : {}) };
    if (result.ok === false) {
      const err = result.error;
      return {
        ok: false,
        error:
          err && typeof err === "object" && typeof err.code === "string"
            ? {
                code: err.code,
                message: err.message || "Tool failed",
                ...(err.details ? { details: err.details } : {}),
              }
            : { code: "tool_execution_error", message: typeof err === "string" ? err : "Tool failed" },
        meta: mergedMeta,
      };
    }
    return {
      ok: true,
      data: result.data !== undefined ? result.data : undefined,
      meta: mergedMeta,
    };
  }

  return {
    ok: true,
    data: result,
    meta,
  };
}

/**
 * Build validation error envelope.
 * @param {string[]} errors
 * @param {object} context
 * @param {number} durationMs
 */
export function validationErrorEnvelope(errors, context, durationMs) {
  return {
    ok: false,
    error: {
      code: "invalid_tool_input",
      message: "Tool arguments failed validation",
      details: { errors },
    },
    meta: baseMeta(context, durationMs),
  };
}
