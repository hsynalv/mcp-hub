/**
 * Tracing / Correlation
 *
 * Distributed tracing and correlation ID management.
 * Provides trace context propagation across request → plugin → job → tool calls.
 */

import { randomBytes } from "crypto";

/**
 * Trace context structure
 * @typedef {Object} TraceContext
 * @property {string} correlationId - Unique correlation ID
 * @property {string} [traceId] - Trace ID for distributed tracing
 * @property {string} [spanId] - Current span ID
 * @property {string} [parentSpanId] - Parent span ID
 * @property {Object} [ baggage] - Additional context data
 */

/**
 * Generate a unique correlation ID
 * Format: corr_<timestamp>_<random>
 * @returns {string}
 */
export function generateCorrelationId() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(8).toString("hex").substring(0, 8);
  return `corr_${timestamp}_${random}`;
}

/**
 * Generate a span ID
 * @returns {string}
 */
export function generateSpanId() {
  return randomBytes(8).toString("hex");
}

/**
 * Generate a trace ID
 * @returns {string}
 */
export function generateTraceId() {
  return randomBytes(16).toString("hex");
}

/**
 * Extract trace context from HTTP request
 * @param {Object} req - Express request or headers object
 * @returns {TraceContext}
 */
export function extractTraceContext(req) {
  const headers = req.headers || req;

  const correlationId =
    headers["x-correlation-id"] ||
    headers["x-request-id"] ||
    headers["x-trace-id"] ||
    generateCorrelationId();

  const traceId = headers["x-trace-id"] || correlationId;
  const spanId = headers["x-span-id"] || generateSpanId();
  const parentSpanId = headers["x-parent-span-id"] || null;

  // Parse baggage if present
  let baggage = {};
  if (headers["x-baggage"]) {
    try {
      baggage = JSON.parse(headers["x-baggage"]);
    } catch {
      baggage = {};
    }
  }

  return {
    correlationId,
    traceId,
    spanId,
    parentSpanId,
    baggage,
  };
}

/**
 * Create a new trace context with child span
 * @param {TraceContext} parentContext
 * @returns {TraceContext}
 */
export function createChildContext(parentContext) {
  return {
    correlationId: parentContext.correlationId,
    traceId: parentContext.traceId || parentContext.correlationId,
    spanId: generateSpanId(),
    parentSpanId: parentContext.spanId,
    baggage: { ...parentContext.baggage },
  };
}

/**
 * Create HTTP headers from trace context
 * @param {TraceContext} context
 * @returns {Object}
 */
export function contextToHeaders(context) {
  const headers = {
    "x-correlation-id": context.correlationId,
    "x-trace-id": context.traceId || context.correlationId,
    "x-span-id": context.spanId,
  };

  if (context.parentSpanId) {
    headers["x-parent-span-id"] = context.parentSpanId;
  }

  if (context.baggage && Object.keys(context.baggage).length > 0) {
    headers["x-baggage"] = JSON.stringify(context.baggage);
  }

  return headers;
}

/**
 * Add baggage item to context
 * @param {TraceContext} context
 * @param {string} key
 * @param {any} value
 * @returns {TraceContext}
 */
export function addBaggage(context, key, value) {
  return {
    ...context,
    baggage: {
      ...context.baggage,
      [key]: value,
    },
  };
}

/**
 * Get baggage item from context
 * @param {TraceContext} context
 * @param {string} key
 * @returns {any | undefined}
 */
export function getBaggage(context, key) {
  return context.baggage?.[key];
}

/**
 * Store trace context in AsyncLocalStorage (Node.js 12.17+)
 * Falls back to global storage for older versions
 */
class TraceContextStorage {
  constructor() {
    this.storage = null;
    this.fallback = new Map();

    // Try to use AsyncLocalStorage if available
    try {
      // eslint-disable-next-line no-undef
      const { AsyncLocalStorage } = require("async_hooks");
      this.storage = new AsyncLocalStorage();
    } catch {
      // Fallback to sync storage
    }
  }

  /**
   * Run function with trace context
   * @param {TraceContext} context
   * @param {Function} fn
   * @returns {any}
   */
  run(context, fn) {
    if (this.storage) {
      return this.storage.run(context, fn);
    }

    // Fallback: use call stack tracking
    const key = process.hrtime.bigint().toString();
    this.fallback.set(key, context);
    try {
      return fn();
    } finally {
      this.fallback.delete(key);
    }
  }

  /**
   * Get current trace context
   * @returns {TraceContext | undefined}
   */
  getStore() {
    if (this.storage) {
      return this.storage.getStore();
    }

    // Fallback: return last added context
    const keys = Array.from(this.fallback.keys());
    if (keys.length > 0) {
      return this.fallback.get(keys[keys.length - 1]);
    }

    return undefined;
  }
}

// Global storage instance
const traceStorage = new TraceContextStorage();

/**
 * Execute function with trace context
 * @param {TraceContext} context
 * @param {Function} fn
 * @returns {any}
 */
export function withTraceContext(context, fn) {
  return traceStorage.run(context, fn);
}

/**
 * Get current trace context
 * @returns {TraceContext | undefined}
 */
export function getCurrentTraceContext() {
  return traceStorage.getStore();
}

/**
 * Create a traced function wrapper
 * @param {Function} fn
 * @param {string} [operationName]
 * @returns {Function}
 */
export function traced(fn, operationName = fn.name) {
  return async (...args) => {
    const parentContext = getCurrentTraceContext();
    const childContext = parentContext
      ? createChildContext(parentContext)
      : {
          correlationId: generateCorrelationId(),
          traceId: generateTraceId(),
          spanId: generateSpanId(),
          parentSpanId: null,
          baggage: {},
        };

    // Add operation name to baggage
    addBaggage(childContext, "operation", operationName);

    return withTraceContext(childContext, () => fn(...args));
  };
}

/**
 * Log context decorator - adds correlation ID to log entries
 * @param {Object} logEntry
 * @param {TraceContext} [context]
 * @returns {Object}
 */
export function addTraceToLog(logEntry, context) {
  const ctx = context || getCurrentTraceContext();

  if (!ctx) {
    return logEntry;
  }

  return {
    ...logEntry,
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
  };
}

/**
 * Check if context is valid
 * @param {any} context
 * @returns {boolean}
 */
export function isValidTraceContext(context) {
  return (
    context &&
    typeof context === "object" &&
    typeof context.correlationId === "string" &&
    context.correlationId.length > 0
  );
}

/**
 * Format context for display/logging
 * @param {TraceContext} context
 * @returns {string}
 */
export function formatTraceContext(context) {
  if (!context) return "no-trace";

  return [
    `corr=${context.correlationId.substring(0, 16)}...`,
    context.traceId && context.traceId !== context.correlationId
      ? `trace=${context.traceId.substring(0, 16)}...`
      : null,
    `span=${context.spanId?.substring(0, 8)}`,
  ]
    .filter(Boolean)
    .join(" ");
}
