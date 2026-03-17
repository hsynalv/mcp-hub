/**
 * Tools Metrics
 *
 * Metrics collection for tool discovery and usage.
 */

import { getToolStats } from "../tool-registry.js";
import { Metrics, getMetricsRegistry } from "./metrics.js";

/**
 * Record tool call
 * @param {string} toolName
 * @param {string} plugin
 * @param {string} status - "success" | "error"
 * @param {number} [duration]
 */
export function recordToolCall(toolName, plugin, status, duration) {
  const registry = getMetricsRegistry();

  // Increment tool calls counter
  registry.increment(Metrics.TOOL_CALLS_TOTAL, 1, {
    tool: toolName,
    plugin,
    status,
  });

  // Record errors
  if (status === "error") {
    registry.increment(Metrics.ERRORS_TOTAL, 1, {
      type: "tool",
      tool: toolName,
      plugin,
    });
  }
}

/**
 * Record LLM call
 * @param {string} provider
 * @param {string} model
 * @param {number} durationMs
 * @param {string} status - "success" | "error"
 */
export function recordLLMCall(provider, model, durationMs, status) {
  const registry = getMetricsRegistry();

  registry.increment("llm_calls_total", 1, {
    provider,
    model,
    status,
  });

  registry.observe(Metrics.LLM_DURATION_MS, durationMs, {
    provider,
    model,
    status,
  });
}

/**
 * Record RAG query
 * @param {string} operation - "index" | "search" | "clear"
 * @param {number} durationMs
 * @param {string} status - "success" | "error"
 */
export function recordRAGQuery(operation, durationMs, status) {
  const registry = getMetricsRegistry();

  registry.increment("rag_queries_total", 1, {
    operation,
    status,
  });

  registry.observe(Metrics.RAG_QUERY_DURATION_MS, durationMs, {
    operation,
    status,
  });
}

/**
 * Get tool metrics snapshot
 * @returns {Object}
 */
export function getToolMetrics() {
  const stats = getToolStats();

  return {
    tools_total: stats.total,
    tools_production_ready: 0,
    tools_by_plugin: stats.byPlugin,
    tools_by_category: stats.byCategory || {},
  };
}

/**
 * Sync tool metrics with tool registry
 */
export function syncToolMetrics() {
  const stats = getToolStats();
  const metrics = getMetricsRegistry();

  metrics.set(Metrics.TOOLS_TOTAL, stats.total);
}

/**
 * Initialize tool metrics
 */
export function initializeToolMetrics() {
  const registry = getMetricsRegistry();

  // Initialize gauges
  registry.set(Metrics.TOOLS_TOTAL, 0);
}
