/**
 * Debug Utilities Module
 *
 * Enhanced debugging tools for MCP Hub development.
 * Provides request tracing, performance profiling, and detailed logging.
 */

import { performance } from "perf_hooks";
import { createWriteStream } from "fs";
import { format } from "util";

// Debug state
const debugState = {
  enabled: process.env.DEBUG === "true" || process.env.DEBUG === "1",
  traceRequests: true,
  traceTools: true,
  profilePerformance: true,
  logLevel: process.env.DEBUG_LEVEL || "info", // debug, info, warn, error
  output: process.stdout, // Can be redirected to file
  startTime: performance.now(),
};

// Request trace storage
const requestTraces = new Map();
const toolTraces = new Map();
const performanceMetrics = [];

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Format timestamp
 */
function timestamp() {
  const now = new Date();
  return now.toISOString().split("T")[1].slice(0, -1);
}

/**
 * Colorized log output
 */
function colorLog(level, message, meta = {}) {
  if (!debugState.enabled) return;

  const levelColors = {
    debug: colors.gray,
    info: colors.blue,
    warn: colors.yellow,
    error: colors.red,
    success: colors.green,
  };

  const color = levelColors[level] || colors.reset;
  const ts = `${colors.dim}[${timestamp()}]${colors.reset}`;
  const prefix = `${color}[${level.toUpperCase()}]${colors.reset}`;

  let output = `${ts} ${prefix} ${message}`;

  if (meta.plugin) {
    output += ` ${colors.cyan}(${meta.plugin})${colors.reset}`;
  }

  if (meta.duration) {
    const durColor = meta.duration > 1000 ? colors.red : meta.duration > 500 ? colors.yellow : colors.green;
    output += ` ${durColor}${meta.duration}ms${colors.reset}`;
  }

  if (meta.error) {
    output += `\n  ${colors.red}→ ${meta.error}${colors.reset}`;
  }

  debugState.output.write(output + "\n");
}

/**
 * Enable/disable debug mode
 */
export function setDebug(enabled, options = {}) {
  debugState.enabled = enabled;
  if (options.traceRequests !== undefined) debugState.traceRequests = options.traceRequests;
  if (options.traceTools !== undefined) debugState.traceTools = options.traceTools;
  if (options.profilePerformance !== undefined) debugState.profilePerformance = options.profilePerformance;

  if (enabled) {
    colorLog("success", "Debug mode enabled", options);
  }
}

/**
 * Check if debug is enabled
 */
export function isDebug() {
  return debugState.enabled;
}

/**
 * Middleware to trace HTTP requests
 */
export function requestTracer() {
  return (req, res, next) => {
    if (!debugState.enabled || !debugState.traceRequests) {
      return next();
    }

    const start = performance.now();
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store trace info
    const trace = {
      id,
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: req.headers,
      startTime: start,
    };

    requestTraces.set(id, trace);

    colorLog("debug", `→ ${req.method} ${req.path}`, { id });

    // Capture response
    const originalEnd = res.end;
    res.end = function (chunk, encoding) {
      const duration = Math.round(performance.now() - start);

      trace.duration = duration;
      trace.statusCode = res.statusCode;
      trace.responseSize = chunk ? chunk.length : 0;

      const level = res.statusCode >= 400 ? "error" : "info";
      colorLog(level, `← ${req.method} ${req.path} ${res.statusCode}`, {
        duration,
        status: res.statusCode,
      });

      res.end = originalEnd;
      res.end(chunk, encoding);
    };

    next();
  };
}

/**
 * Wrap tool execution with tracing
 */
export function traceToolExecution(pluginName, toolName, handler) {
  return async (params) => {
    if (!debugState.enabled || !debugState.traceTools) {
      return handler(params);
    }

    const start = performance.now();
    const traceId = `${pluginName}:${toolName}:${Date.now()}`;

    colorLog("debug", `▶ ${pluginName}.${toolName}()`, { plugin: pluginName });

    try {
      const result = await handler(params);
      const duration = Math.round(performance.now() - start);

      colorLog("success", `✓ ${pluginName}.${toolName}()`, {
        plugin: pluginName,
        duration,
      });

      // Store trace
      toolTraces.set(traceId, {
        plugin: pluginName,
        tool: toolName,
        params,
        result,
        duration,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);

      colorLog("error", `✗ ${pluginName}.${toolName}()`, {
        plugin: pluginName,
        duration,
        error: error.message,
      });

      toolTraces.set(traceId, {
        plugin: pluginName,
        tool: toolName,
        params,
        error: error.message,
        duration,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  };
}

/**
 * Performance profiler
 */
export class Profiler {
  constructor(name) {
    this.name = name;
    this.startTime = null;
    this.checkpoints = [];
  }

  start() {
    this.startTime = performance.now();
    colorLog("debug", `⏱ ${this.name} started`);
    return this;
  }

  checkpoint(label) {
    const elapsed = Math.round(performance.now() - this.startTime);
    this.checkpoints.push({ label, elapsed });
    colorLog("debug", `  ↳ ${label}: ${elapsed}ms`);
    return this;
  }

  end() {
    const total = Math.round(performance.now() - this.startTime);
    colorLog("info", `⏹ ${this.name} completed`, { duration: total });

    performanceMetrics.push({
      name: this.name,
      total,
      checkpoints: this.checkpoints,
      timestamp: new Date().toISOString(),
    });

    return total;
  }
}

/**
 * Debug endpoint handler - returns debug info
 */
export function getDebugInfo() {
  return {
    state: debugState,
    requestCount: requestTraces.size,
    toolCallCount: toolTraces.size,
    recentRequests: Array.from(requestTraces.values()).slice(-10),
    recentTools: Array.from(toolTraces.values()).slice(-10),
    performanceMetrics: performanceMetrics.slice(-20),
  };
}

/**
 * Clear debug data
 */
export function clearDebugData() {
  requestTraces.clear();
  toolTraces.clear();
  performanceMetrics.length = 0;
  colorLog("info", "Debug data cleared");
}

/**
 * Pretty print object for debugging
 */
export function inspect(obj, depth = 2) {
  if (!debugState.enabled) return;

  const str = format("%O", obj);
  console.log(`${colors.gray}${str}${colors.reset}`);
}

/**
 * Debug assertion
 */
export function assert(condition, message) {
  if (!condition) {
    colorLog("error", `ASSERTION FAILED: ${message}`);
    if (debugState.enabled) {
      throw new Error(`Debug assertion failed: ${message}`);
    }
  }
}

/**
 * Measure async function execution time
 */
export function measure(name, fn) {
  return async (...args) => {
    const profiler = new Profiler(name).start();
    try {
      const result = await fn(...args);
      profiler.end();
      return result;
    } catch (error) {
      profiler.end();
      throw error;
    }
  };
}

/**
 * Create debug middleware for Express
 */
export function createDebugMiddleware() {
  return {
    requestTracer: requestTracer(),
    errorHandler: (err, req, res, next) => {
      if (debugState.enabled) {
        colorLog("error", `Error in ${req.method} ${req.path}`, {
          error: err.message,
          stack: err.stack,
        });
      }
      next(err);
    },
  };
}

/**
 * Plugin loader with debug tracing
 */
export function tracePluginLoader(loader) {
  return async (...args) => {
    const profiler = new Profiler("Plugin Load").start();

    try {
      const result = await loader(...args);
      profiler.checkpoint("loaded").end();
      colorLog("success", `Plugins loaded: ${result.length || 0}`);
      return result;
    } catch (error) {
      profiler.end();
      colorLog("error", "Plugin load failed", { error: error.message });
      throw error;
    }
  };
}

// Export default API
export default {
  setDebug,
  isDebug,
  requestTracer,
  traceToolExecution,
  Profiler,
  getDebugInfo,
  clearDebugData,
  inspect,
  assert,
  measure,
  createDebugMiddleware,
  tracePluginLoader,
};
