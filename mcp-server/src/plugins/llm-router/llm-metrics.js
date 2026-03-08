/**
 * LLM Router Cost & Latency Tracking
 * 
 * Tracks actual costs and response times for LLM routing decisions.
 * Provides insights for optimization and budget control.
 */

import { routeTask, listModels, estimateCost } from "../llm-router/index.js";

// Metrics storage (in production, use Redis/DB)
const metrics = new Map();
const costHistory = [];
const latencyHistory = [];

/**
 * Track a routing decision with actual results
 */
export async function trackRouteWithMetrics(task, prompt, options = {}) {
  const startTime = Date.now();
  const estimatedCost = estimateCost(task, options.promptTokens, options.responseTokens);
  
  try {
    const result = await routeTask(task, prompt, options);
    const duration = Date.now() - startTime;
    
    // Record metrics
    const metric = {
      task,
      provider: result.provider,
      model: result.model,
      usedFallback: result.usedFallback,
      estimatedCost: estimatedCost?.estimatedCost || 0,
      actualCost: calculateActualCost(result, options),
      duration,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId,
      workspaceId: options.workspaceId,
      success: true,
    };
    
    recordMetric(metric);
    
    return {
      ...result,
      metrics: {
        duration,
        estimatedCost: estimatedCost?.estimatedCost,
        costCurrency: estimatedCost?.currency || "USD",
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    recordMetric({
      task,
      provider: options.targetProvider || "unknown",
      model: "unknown",
      usedFallback: false,
      estimatedCost: 0,
      actualCost: 0,
      duration,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId,
      workspaceId: options.workspaceId,
      success: false,
      error: error.message,
    });
    
    throw error;
  }
}

/**
 * Calculate actual cost based on result
 */
function calculateActualCost(result, options) {
  // Pricing per 1M tokens (approximate)
  const pricing = {
    "gpt-4o": { input: 5, output: 15 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "claude-3-opus-20240229": { input: 15, output: 75 },
    "claude-3-sonnet-20240229": { input: 3, output: 15 },
    "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
    "gemini-1.5-pro": { input: 3.5, output: 10.5 },
    "gemini-1.5-flash": { input: 0.35, output: 1.05 },
    "mistral-large-latest": { input: 2, output: 6 },
    "mistral-small-latest": { input: 0.2, output: 0.6 },
  };

  const model = result.model;
  const price = pricing[model];
  
  if (!price) return 0;
  
  const inputTokens = options.promptTokens || 1000;
  const outputTokens = options.responseTokens || 2000;
  
  const inputCost = (inputTokens / 1000000) * price.input;
  const outputCost = (outputTokens / 1000000) * price.output;
  
  return inputCost + outputCost;
}

/**
 * Record a metric
 */
function recordMetric(metric) {
  costHistory.push(metric);
  latencyHistory.push({
    task: metric.task,
    provider: metric.provider,
    model: metric.model,
    duration: metric.duration,
    timestamp: metric.timestamp,
  });
  
  // Trim history to last 1000 entries
  if (costHistory.length > 1000) costHistory.shift();
  if (latencyHistory.length > 1000) latencyHistory.shift();
}

/**
 * Get cost summary for a workspace
 */
export function getWorkspaceCostSummary(workspaceId, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const workspaceMetrics = costHistory.filter(
    m => m.workspaceId === workspaceId && new Date(m.timestamp) >= cutoff
  );
  
  const byProvider = {};
  const byTask = {};
  let totalCost = 0;
  let totalCalls = 0;
  
  for (const m of workspaceMetrics) {
    totalCost += m.actualCost;
    totalCalls++;
    
    byProvider[m.provider] = (byProvider[m.provider] || 0) + m.actualCost;
    byTask[m.task] = (byTask[m.task] || 0) + m.actualCost;
  }
  
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalCalls,
    averageCost: totalCalls > 0 ? Math.round((totalCost / totalCalls) * 1000) / 1000 : 0,
    byProvider,
    byTask,
    currency: "USD",
    period: `${days} days`,
  };
}

/**
 * Get latency statistics
 */
export function getLatencyStats(provider = null, task = null) {
  let filtered = latencyHistory;
  
  if (provider) {
    filtered = filtered.filter(m => m.provider === provider);
  }
  
  if (task) {
    filtered = filtered.filter(m => m.task === task);
  }
  
  if (filtered.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0 };
  }
  
  const durations = filtered.map(m => m.duration).sort((a, b) => a - b);
  
  return {
    count: durations.length,
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[Math.floor(durations.length * 0.95)],
    p99: durations[Math.floor(durations.length * 0.99)] || durations[durations.length - 1],
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    min: durations[0],
    max: durations[durations.length - 1],
  };
}

/**
 * Get provider availability status
 */
export function getProviderHealth() {
  const providers = listModels();
  const health = {};
  
  for (const provider of providers) {
    const providerMetrics = latencyHistory.filter(m => m.provider === provider.provider);
    const recent = providerMetrics.slice(-10);
    
    if (recent.length === 0) {
      health[provider.provider] = {
        available: provider.available,
        status: provider.available ? "unknown" : "unavailable",
        last24hCalls: 0,
        avgLatency: 0,
        errorRate: 0,
      };
      continue;
    }
    
    const successCount = recent.filter(m => m.success !== false).length;
    const errorRate = (recent.length - successCount) / recent.length;
    
    health[provider.provider] = {
      available: provider.available,
      status: errorRate > 0.5 ? "degraded" : errorRate > 0.2 ? "warning" : "healthy",
      last24hCalls: providerMetrics.filter(
        m => new Date(m.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length,
      avgLatency: Math.round(recent.reduce((a, b) => a + b.duration, 0) / recent.length),
      errorRate: Math.round(errorRate * 100),
    };
  }
  
  return health;
}

/**
 * MCP Tool: Route with metrics
 */
export const llmRouteWithMetricsTool = {
  name: "llm_route_tracked",
  description: "Route to LLM with cost and latency tracking",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task type" },
      prompt: { type: "string", description: "The prompt" },
      explanation: { type: "string", description: "Why this task" },
      promptTokens: { type: "number", description: "Estimated input tokens" },
      responseTokens: { type: "number", description: "Estimated output tokens" },
    },
    required: ["task", "prompt", "explanation"],
  },
  handler: async (args, context) => {
    const result = await trackRouteWithMetrics(args.task, args.prompt, {
      promptTokens: args.promptTokens,
      responseTokens: args.responseTokens,
      correlationId: context.correlationId,
      workspaceId: context.workspaceId,
    });
    
    return {
      ok: true,
      data: result,
    };
  },
};

/**
 * MCP Tool: Get cost summary
 */
export const llmCostSummaryTool = {
  name: "llm_cost_summary",
  description: "Get cost summary for workspace",
  inputSchema: {
  type: "object",
    properties: {
      days: { type: "number", default: 30 },
    },
  },
  handler: async (args, context) => {
    const summary = getWorkspaceCostSummary(context.workspaceId, args.days);
    return {
      ok: true,
      data: summary,
    };
  },
};

/**
 * MCP Tool: Get latency stats
 */
export const llmLatencyStatsTool = {
  name: "llm_latency_stats",
  description: "Get latency statistics for providers",
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string" },
      task: { type: "string" },
    },
  },
  handler: async (args) => {
    const stats = getLatencyStats(args.provider, args.task);
    return {
      ok: true,
      data: stats,
    };
  },
};

/**
 * MCP Tool: Get provider health
 */
export const llmProviderHealthTool = {
  name: "llm_provider_health",
  description: "Get provider health status",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const health = getProviderHealth();
    return {
      ok: true,
      data: health,
    };
  },
};
