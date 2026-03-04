/**
 * HTTP plugin policy module — allowlist/blocklist and per-domain rate limiting.
 */

import { config } from "../../core/config.js";

/**
 * Parse domain patterns from a comma-separated env string.
 * Supports wildcards: *.github.com
 */
function parsePatterns(str) {
  if (!str) return [];
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}

function patternToRegex(pattern) {
  // Escape dots, convert * to wildcard
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
  return new RegExp(`^${escaped}$`, "i");
}

function extractHostname(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// ─── Allowlist / Blocklist ────────────────────────────────────────────────────

export function isDomainAllowed(url) {
  const hostname = extractHostname(url);
  if (!hostname) return false;

  const allowed = parsePatterns(config.http?.allowedDomains);
  const blocked = parsePatterns(config.http?.blockedDomains);

  // Blocklist takes precedence
  if (blocked.some((p) => patternToRegex(p).test(hostname))) return false;

  // If no allowlist configured, allow everything (except blocked)
  if (!allowed.length) return true;

  return allowed.some((p) => patternToRegex(p).test(hostname));
}

// ─── Rate Limiter (per domain, in-memory) ────────────────────────────────────

const rateWindows = new Map(); // hostname → { count, windowStart }

export function checkRateLimit(url) {
  const hostname = extractHostname(url);
  if (!hostname) return { allowed: false, reason: "invalid_url" };

  const rpm = config.http?.rateLimitRpm ?? 60;
  const now = Date.now();
  const windowMs = 60_000;

  if (!rateWindows.has(hostname)) {
    rateWindows.set(hostname, { count: 1, windowStart: now });
    return { allowed: true };
  }

  const state = rateWindows.get(hostname);

  // Reset window if expired
  if (now - state.windowStart > windowMs) {
    state.count = 1;
    state.windowStart = now;
    return { allowed: true };
  }

  if (state.count >= rpm) {
    const resetIn = Math.ceil((state.windowStart + windowMs - now) / 1000);
    return { allowed: false, reason: "rate_limit_exceeded", resetInSeconds: resetIn, limit: rpm };
  }

  state.count += 1;
  return { allowed: true };
}

export function getRateLimitState() {
  const result = {};
  for (const [hostname, state] of rateWindows) {
    result[hostname] = {
      requestsInWindow: state.count,
      windowStarted:    new Date(state.windowStart).toISOString(),
    };
  }
  return result;
}

export function getPolicyInfo() {
  return {
    allowedDomains: parsePatterns(config.http?.allowedDomains),
    blockedDomains: parsePatterns(config.http?.blockedDomains),
    rateLimitRpm:   config.http?.rateLimitRpm ?? 60,
    maxResponseKb:  config.http?.maxResponseSizeKb ?? 512,
    timeoutMs:      config.http?.defaultTimeoutMs ?? 10000,
    cacheTtlSeconds:config.http?.cacheTtlSeconds ?? 300,
  };
}
