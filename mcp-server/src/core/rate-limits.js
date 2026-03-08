/**
 * Multi-Layer Rate Limiting & Quota System
 * 
 * Layers:
 * 1. Request level - Per-minute per-IP/API key
 * 2. Job level - Per-hour queue depth per workspace  
 * 3. Provider level - Token budget per LLM provider (daily)
 * 4. Workspace level - Daily quota (requests + cost)
 * 5. Plugin level - Sensitive plugins stricter (shell, database)
 */

import { config } from "./config.js";

// In-memory stores (use Redis in production)
const requestCounters = new Map();
const jobCounters = new Map();
const providerCounters = new Map();
const workspaceCounters = new Map();
const pluginCounters = new Map();

/**
 * Rate limit configuration
 */
export const RateLimits = {
  // Request level
  request: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,    // per window
  },
  
  // Job level
  job: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxJobs: 50,              // per hour per workspace
  },
  
  // Provider level (LLM tokens)
  provider: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    maxTokens: 1000000,           // 1M tokens per day
    maxCost: 10.00,               // $10 per day
  },
  
  // Workspace level
  workspace: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    maxRequests: 10000,
    maxCost: 50.00,               // $50 per day
  },
  
  // Plugin level (stricter for dangerous plugins)
  plugin: {
    shell: { windowMs: 60 * 1000, maxCalls: 10 },
    database: { windowMs: 60 * 1000, maxCalls: 30 },
    http: { windowMs: 60 * 1000, maxCalls: 60 },
  },
};

/**
 * Check request rate limit
 */
export function checkRequestLimit(key) {
  const { windowMs, maxRequests } = RateLimits.request;
  return checkLimit(requestCounters, key, windowMs, maxRequests);
}

/**
 * Check job rate limit
 */
export function checkJobLimit(workspaceId) {
  const { windowMs, maxJobs } = RateLimits.job;
  return checkLimit(jobCounters, workspaceId, windowMs, maxJobs);
}

/**
 * Check provider token/cost budget
 */
export function checkProviderLimit(provider, tokens = 0, cost = 0) {
  const key = `${provider}:${new Date().toISOString().split('T')[0]}`;
  const { windowMs, maxTokens, maxCost } = RateLimits.provider;
  
  const counter = providerCounters.get(key) || { tokens: 0, cost: 0, resetTime: Date.now() + windowMs };
  
  // Check if window expired
  if (Date.now() > counter.resetTime) {
    counter.tokens = 0;
    counter.cost = 0;
    counter.resetTime = Date.now() + windowMs;
  }
  
  // Check limits
  if (counter.tokens + tokens > maxTokens) {
    return {
      allowed: false,
      reason: `Daily token limit exceeded (${maxTokens})`,
      current: counter.tokens,
      limit: maxTokens,
    };
  }
  
  if (counter.cost + cost > maxCost) {
    return {
      allowed: false,
      reason: `Daily cost limit exceeded ($${maxCost})`,
      current: counter.cost,
      limit: maxCost,
    };
  }
  
  // Update counters
  counter.tokens += tokens;
  counter.cost += cost;
  providerCounters.set(key, counter);
  
  return {
    allowed: true,
    remaining: {
      tokens: maxTokens - counter.tokens,
      cost: maxCost - counter.cost,
    },
  };
}

/**
 * Check workspace quota
 */
export function checkWorkspaceQuota(workspaceId, cost = 0) {
  const key = `${workspaceId}:${new Date().toISOString().split('T')[0]}`;
  const { windowMs, maxRequests, maxCost } = RateLimits.workspace;
  
  const counter = workspaceCounters.get(key) || { 
    requests: 0, 
    cost: 0, 
    resetTime: Date.now() + windowMs 
  };
  
  // Check if window expired
  if (Date.now() > counter.resetTime) {
    counter.requests = 0;
    counter.cost = 0;
    counter.resetTime = Date.now() + windowMs;
  }
  
  // Check limits
  if (counter.requests >= maxRequests) {
    return {
      allowed: false,
      reason: `Daily request limit exceeded (${maxRequests})`,
      current: counter.requests,
      limit: maxRequests,
    };
  }
  
  if (counter.cost + cost > maxCost) {
    return {
      allowed: false,
      reason: `Daily cost limit exceeded ($${maxCost})`,
      current: counter.cost,
      limit: maxCost,
    };
  }
  
  // Update counters
  counter.requests += 1;
  counter.cost += cost;
  workspaceCounters.set(key, counter);
  
  return {
    allowed: true,
    remaining: {
      requests: maxRequests - counter.requests,
      cost: maxCost - counter.cost,
    },
  };
}

/**
 * Check plugin rate limit (stricter for dangerous plugins)
 */
export function checkPluginLimit(pluginName, key) {
  const limit = RateLimits.plugin[pluginName];
  if (!limit) return { allowed: true }; // No limit for this plugin
  
  const compositeKey = `${pluginName}:${key}`;
  return checkLimit(pluginCounters, compositeKey, limit.windowMs, limit.maxCalls);
}

/**
 * Generic limit checker
 */
function checkLimit(store, key, windowMs, maxCount) {
  const now = Date.now();
  const counter = store.get(key) || { count: 0, resetTime: now + windowMs };
  
  // Check if window expired
  if (now > counter.resetTime) {
    counter.count = 0;
    counter.resetTime = now + windowMs;
  }
  
  // Check limit
  if (counter.count >= maxCount) {
    return {
      allowed: false,
      reason: `Rate limit exceeded (${maxCount} per ${windowMs}ms)`,
      current: counter.count,
      limit: maxCount,
      resetTime: counter.resetTime,
    };
  }
  
  // Increment
  counter.count += 1;
  store.set(key, counter);
  
  return {
    allowed: true,
    remaining: maxCount - counter.count,
    resetTime: counter.resetTime,
  };
}

/**
 * Get quota headers
 */
export function getQuotaHeaders(result) {
  if (!result.allowed) {
    return {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
      'Retry-After': String(Math.ceil((result.resetTime - Date.now()) / 1000)),
    };
  }
  
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    ...(result.resetTime && { 'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)) }),
  };
}

/**
 * Workspace quota dashboard data
 */
export function getWorkspaceQuotaStatus(workspaceId) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${workspaceId}:${today}`;
  
  const counter = workspaceCounters.get(key) || { requests: 0, cost: 0 };
  
  return {
    workspaceId,
    date: today,
    requests: {
      used: counter.requests,
      limit: RateLimits.workspace.maxRequests,
      remaining: RateLimits.workspace.maxRequests - counter.requests,
      percentage: Math.round((counter.requests / RateLimits.workspace.maxRequests) * 100),
    },
    cost: {
      used: counter.cost,
      limit: RateLimits.workspace.maxCost,
      remaining: RateLimits.workspace.maxCost - counter.cost,
      percentage: Math.round((counter.cost / RateLimits.workspace.maxCost) * 100),
    },
    alert: counter.requests / RateLimits.workspace.maxRequests > 0.8 ||
           counter.cost / RateLimits.workspace.maxCost > 0.8,
  };
}

/**
 * Reset all counters (for testing)
 */
export function resetAllCounters() {
  requestCounters.clear();
  jobCounters.clear();
  providerCounters.clear();
  workspaceCounters.clear();
  pluginCounters.clear();
}
