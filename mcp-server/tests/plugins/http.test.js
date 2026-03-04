import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getFromCache,
  setInCache,
  clearCache,
  getCacheStats,
} from "../../src/plugins/http/http.cache.js";
import {
  isDomainAllowed,
  checkRateLimit,
  getRateLimitState,
  getPolicyInfo,
} from "../../src/plugins/http/policy.js";
import { config } from "../../src/core/config.js";

/**
 * HTTP Plugin Unit Tests
 * Tests for cache, policy, and client functionality
 */

// Mock config
vi.mock("../../src/core/config.js", () => ({
  config: {
    http: {
      allowedDomains: "*.github.com,api.example.com",
      blockedDomains: "malicious.com,*.badsite.org",
      rateLimitRpm: 60,
      maxResponseSizeKb: 512,
      defaultTimeoutMs: 10000,
      cacheTtlSeconds: 300,
    },
  },
}));

describe("HTTP Cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Operations", () => {
    it("should store and retrieve cached responses", () => {
      const data = {
        status: 200,
        body: { message: "Hello" },
        headers: { "content-type": "application/json" },
      };

      setInCache("GET", "https://api.example.com/data", null, data, 60);
      const cached = getFromCache("GET", "https://api.example.com/data", null);

      expect(cached).not.toBeNull();
      expect(cached.status).toBe(200);
      expect(cached.body).toEqual({ message: "Hello" });
    });

    it("should return null for cache misses", () => {
      const cached = getFromCache("GET", "https://api.example.com/missing", null);
      expect(cached).toBeNull();
    });

    it("should include different body in cache key", () => {
      const data = { status: 200, body: {} };
      setInCache("POST", "https://api.example.com/data", { id: 1 }, data, 60);

      const cached1 = getFromCache("POST", "https://api.example.com/data", { id: 1 });
      const cached2 = getFromCache("POST", "https://api.example.com/data", { id: 2 });

      expect(cached1).not.toBeNull();
      expect(cached2).toBeNull();
    });

    it("should clear all cache entries", () => {
      setInCache("GET", "https://api.example.com/1", null, { status: 200 }, 60);
      setInCache("GET", "https://api.example.com/2", null, { status: 200 }, 60);

      const cleared = clearCache();

      expect(cleared).toBe(2);
      expect(getFromCache("GET", "https://api.example.com/1", null)).toBeNull();
      expect(getFromCache("GET", "https://api.example.com/2", null)).toBeNull();
    });
  });

  describe("TTL Handling", () => {
  it("should return null for expired entries", () => {
      const data = { status: 200, body: {} };
      setInCache("GET", "https://api.example.com/data", null, data, 0);

      // Wait a bit for expiration
      vi.advanceTimersByTime(1500);

      const cached = getFromCache("GET", "https://api.example.com/data", null);
      expect(cached).toBeNull();
    });

    it("should include age information for fresh entries", () => {
      const data = { status: 200, body: {} };
      setInCache("GET", "https://api.example.com/data", null, data, 60);

      const cached = getFromCache("GET", "https://api.example.com/data", null);

      expect(cached.ageSeconds).toBeGreaterThanOrEqual(0);
      expect(cached.ageSeconds).toBeLessThan(1);
    });

    it("should report cache statistics", () => {
      setInCache("GET", "https://api.example.com/1", null, { status: 200 }, 60);
      setInCache("GET", "https://api.example.com/2", null, { status: 200 }, 0);

      vi.advanceTimersByTime(1500);

      const stats = getCacheStats();

      expect(stats.total).toBe(2);
      expect(stats.fresh).toBe(1);
      expect(stats.stale).toBe(1);
    });
  });
});

describe("HTTP Policy - Domain Allowlist", () => {
  it("should allow domains matching wildcard pattern", () => {
    expect(isDomainAllowed("https://api.github.com/users")).toBe(true);
    expect(isDomainAllowed("https://raw.github.com/content")).toBe(true);
  });

  it("should allow exact domain matches", () => {
    expect(isDomainAllowed("https://api.example.com/v1")).toBe(true);
  });

  it("should block non-matching domains when allowlist is set", () => {
    expect(isDomainAllowed("https://unknown.com/api")).toBe(false);
    expect(isDomainAllowed("https://other.org/data")).toBe(false);
  });

  it("should block domains in blocklist", () => {
    expect(isDomainAllowed("https://malicious.com/page")).toBe(false);
    expect(isDomainAllowed("https://sub.badsite.org/resource")).toBe(false);
  });

  it("should give precedence to blocklist over allowlist", () => {
    // Even if a domain matches allowlist, blocklist should win
    expect(isDomainAllowed("https://badsite.org.github.com")).toBe(false);
  });

  it("should reject invalid URLs", () => {
    expect(isDomainAllowed("not-a-url")).toBe(false);
    expect(isDomainAllowed("")).toBe(false);
  });

  it("should handle URLs without protocol", () => {
    expect(isDomainAllowed("api.github.com/users")).toBe(false);
  });
});

describe("HTTP Policy - Rate Limiting", () => {
  beforeEach(() => {
    // Reset rate limit windows
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests under rate limit", () => {
    const result = checkRateLimit("https://api.example.com/data");
    expect(result.allowed).toBe(true);
  });

  it("should track requests per domain", () => {
    const url = "https://track-test.example.com/data";

    for (let i = 0; i < 5; i++) {
      checkRateLimit(url);
    }

    const state = getRateLimitState();
    expect(state["track-test.example.com"].requestsInWindow).toBe(5);
  });

  it("should block requests over rate limit", () => {
    const url = "https://block-test.example.com/data";
    const limit = 60;

    // Make limit requests
    for (let i = 0; i < limit; i++) {
      checkRateLimit(url);
    }

    // Next request should be blocked
    const result = checkRateLimit(url);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("rate_limit_exceeded");
    expect(result.limit).toBe(limit);
    expect(result.resetInSeconds).toBeGreaterThan(0);
  });

  it("should reset window after 60 seconds", () => {
    const url = "https://reset-test.example.com/data";

    // Make limit requests
    for (let i = 0; i < 60; i++) {
      checkRateLimit(url);
    }

    // Advance time past window
    vi.advanceTimersByTime(61000);

    // Should be allowed again
    const result = checkRateLimit(url);
    expect(result.allowed).toBe(true);
  });

  it("should reject invalid URLs", () => {
    const result = checkRateLimit("not-a-valid-url");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid_url");
  });

  it("should track separate windows for different domains", () => {
    checkRateLimit("https://sep1.example.com/data");
    checkRateLimit("https://sep2.example.com/data");

    const state = getRateLimitState();
    expect(state["sep1.example.com"].requestsInWindow).toBe(1);
    expect(state["sep2.example.com"].requestsInWindow).toBe(1);
  });
});

describe("HTTP Policy - Configuration", () => {
  it("should return policy configuration", () => {
    const info = getPolicyInfo();

    expect(info.allowedDomains).toContain("*.github.com");
    expect(info.allowedDomains).toContain("api.example.com");
    expect(info.blockedDomains).toContain("malicious.com");
    expect(info.rateLimitRpm).toBe(60);
    expect(info.maxResponseKb).toBe(512);
    expect(info.timeoutMs).toBe(10000);
    expect(info.cacheTtlSeconds).toBe(300);
  });
});
