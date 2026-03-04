/**
 * Rate limiting module — unified rate limiting with sliding window.
 *
 * PR-7: Rate limit standard — tek library
 * - Sliding window rate limiting
 * - Per-key tracking (IP, user, API key)
 * - Configurable window size and max requests
 */

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100;

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.windows = new Map(); // key → { timestamps: [] }
  }

  _cleanOldEntries(key) {
    const window = this.windows.get(key);
    if (!window) return;

    const now = Date.now();
    const cutoff = now - this.windowMs;

    window.timestamps = window.timestamps.filter((ts) => ts > cutoff);

    if (window.timestamps.length === 0) {
      this.windows.delete(key);
    }
  }

  isAllowed(key) {
    this._cleanOldEntries(key);

    const window = this.windows.get(key);
    if (!window) return true;

    return window.timestamps.length < this.maxRequests;
  }

  recordRequest(key) {
    this._cleanOldEntries(key);

    if (!this.windows.has(key)) {
      this.windows.set(key, { timestamps: [] });
    }

    const window = this.windows.get(key);
    window.timestamps.push(Date.now());

    return this.getStatus(key);
  }

  getStatus(key) {
    this._cleanOldEntries(key);

    const window = this.windows.get(key);
    const current = window?.timestamps.length ?? 0;
    const remaining = Math.max(0, this.maxRequests - current);
    const resetTime = window?.timestamps[0]
      ? window.timestamps[0] + this.windowMs
      : Date.now() + this.windowMs;

    return {
      allowed: current < this.maxRequests,
      current,
      max: this.maxRequests,
      remaining,
      resetTime,
      windowMs: this.windowMs,
    };
  }

  reset(key) {
    this.windows.delete(key);
  }

  resetAll() {
    this.windows.clear();
  }

  stats() {
    let totalKeys = 0;
    let totalRequests = 0;

    for (const [key, window] of this.windows.entries()) {
      this._cleanOldEntries(key);
      if (this.windows.has(key)) {
        totalKeys++;
        totalRequests += window.timestamps.length;
      }
    }

    return {
      totalKeys,
      totalRequests,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
    };
  }
}

// Global rate limiter instances
const limiters = new Map();

export function getRateLimiter(name, options) {
  if (!limiters.has(name)) {
    limiters.set(name, new RateLimiter(options));
  }
  return limiters.get(name);
}

export function createRateLimiter(options) {
  return new RateLimiter(options);
}

/**
 * Express middleware factory for rate limiting.
 * @param {Object} options
 * @param {string} options.name - Rate limiter instance name
 * @param {Function} options.keyGenerator - (req) => string key
 * @param {number} options.windowMs - Window size in ms
 * @param {number} options.maxRequests - Max requests per window
 */
export function rateLimitMiddleware(options = {}) {
  const {
    name = "default",
    keyGenerator = (req) => req.ip ?? req.connection?.remoteAddress ?? "unknown",
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
  } = options;

  const limiter = getRateLimiter(name, { windowMs, maxRequests });

  return (req, res, next) => {
    const key = keyGenerator(req);

    if (!limiter.isAllowed(key)) {
      const status = limiter.getStatus(key);
      return res.status(429).json({
        ok: false,
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests. Please try again later.",
          details: {
            retryAfter: Math.ceil((status.resetTime - Date.now()) / 1000),
          },
        },
        meta: { requestId: req.requestId ?? null },
      });
    }

    limiter.recordRequest(key);

    // Add rate limit headers
    const status = limiter.getStatus(key);
    res.setHeader("X-RateLimit-Limit", status.max);
    res.setHeader("X-RateLimit-Remaining", status.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(status.resetTime / 1000));

    next();
  };
}

export { RateLimiter };
