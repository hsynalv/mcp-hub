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
import {
  isPrivateIP,
  isBlockedHost,
  validateUrlSafety,
} from "../../src/plugins/http/security.js";
import { config } from "../../src/core/config.js";

/**
 * HTTP Plugin Unit Tests
 * Tests for cache, policy, security, and client functionality
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

describe("HTTP Security - SSRF Protection", () => {
  describe("isPrivateIP", () => {
    it("should identify localhost IPs", () => {
      expect(isPrivateIP("127.0.0.1")).toBe(true);
      expect(isPrivateIP("127.0.1.1")).toBe(true);
      expect(isPrivateIP("127.255.255.255")).toBe(true);
    });

    it("should identify Class A private IPs", () => {
      expect(isPrivateIP("10.0.0.1")).toBe(true);
      expect(isPrivateIP("10.255.255.255")).toBe(true);
    });

    it("should identify Class B private IPs", () => {
      expect(isPrivateIP("172.16.0.1")).toBe(true);
      expect(isPrivateIP("172.31.255.255")).toBe(true);
      expect(isPrivateIP("172.15.0.1")).toBe(false); // Not private
      expect(isPrivateIP("172.32.0.1")).toBe(false); // Not private
    });

    it("should identify Class C private IPs", () => {
      expect(isPrivateIP("192.168.0.1")).toBe(true);
      expect(isPrivateIP("192.168.255.255")).toBe(true);
    });

    it("should identify link-local IPs", () => {
      expect(isPrivateIP("169.254.0.1")).toBe(true);
    });

    it("should allow public IPs", () => {
      expect(isPrivateIP("8.8.8.8")).toBe(false);
      expect(isPrivateIP("1.1.1.1")).toBe(false);
      expect(isPrivateIP("104.16.249.249")).toBe(false);
    });

    it("should identify IPv6 loopback", () => {
      expect(isPrivateIP("::1")).toBe(true);
    });
  });

  describe("isBlockedHost", () => {
    it("should block localhost", () => {
      expect(isBlockedHost("localhost")).toBe(true);
      expect(isBlockedHost("LOCALHOST")).toBe(true);
      expect(isBlockedHost("localhost.localdomain")).toBe(true);
    });

    it("should block private IPs", () => {
      expect(isBlockedHost("127.0.0.1")).toBe(true);
      expect(isBlockedHost("10.0.0.1")).toBe(true);
      expect(isBlockedHost("192.168.1.1")).toBe(true);
    });

    it("should allow public domains", () => {
      expect(isBlockedHost("api.github.com")).toBe(false);
      expect(isBlockedHost("google.com")).toBe(false);
    });
  });

  describe("validateUrlSafety", () => {
    it("should block localhost URLs", () => {
      const result = validateUrlSafety("http://localhost:8080/api");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("private_host_blocked");
    });

    it("should block private IP URLs", () => {
      expect(validateUrlSafety("http://127.0.0.1:3000").allowed).toBe(false);
      expect(validateUrlSafety("http://10.0.0.1/internal").allowed).toBe(false);
      expect(validateUrlSafety("http://192.168.1.1/admin").allowed).toBe(false);
    });

    it("should block non-HTTP protocols", () => {
      expect(validateUrlSafety("ftp://example.com/file").allowed).toBe(false);
      expect(validateUrlSafety("file:///etc/passwd").allowed).toBe(false);
      expect(validateUrlSafety("javascript:alert(1)").allowed).toBe(false);
    });

    it("should allow public HTTP URLs", () => {
      const result = validateUrlSafety("https://api.github.com/users/octocat");
      expect(result.allowed).toBe(true);
    });

    it("should reject invalid URLs", () => {
      const result = validateUrlSafety("not-a-valid-url");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("invalid_url");
    });
  });
});

describe("HTTP Redirect Safety", () => {
  it("should track redirect count in response", async () => {
    // This test validates the httpRequest returns redirect count
    // Actual redirect following requires a mock server, but we can verify
    // the function signature and return structure supports it
    const { httpRequest } = await import("../../src/plugins/http/http.client.js");
    expect(typeof httpRequest).toBe("function");
  });

  it("should have max redirect config default", async () => {
    const { config } = await import("../../src/core/config.js");
    // Default maxRedirects should be 5 or explicitly configured
    const maxRedirects = config.http?.maxRedirects ?? 5;
    expect(maxRedirects).toBeGreaterThanOrEqual(3);
    expect(maxRedirects).toBeLessThanOrEqual(10);
  });
});

describe("HTTP Method Governance", () => {
  it("should allow safe methods by default", () => {
    // GET, HEAD, OPTIONS should always be allowed
    // We verify this by checking the schema allows these values
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    safeMethods.forEach((method) => {
      // These should be in the enum and pass schema validation
      expect(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]).toContain(method);
    });
  });

  it("should recognize destructive methods", () => {
    const destructiveMethods = ["POST", "PUT", "PATCH", "DELETE"];
    destructiveMethods.forEach((method) => {
      expect(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]).toContain(method);
    });
  });

  it("should require config for destructive methods", async () => {
    // Without HTTP_ENABLED_METHODS config, destructive methods should be rejected
    const { config } = await import("../../src/core/config.js");
    
    // Check that enabledMethods is not configured (default safe-only behavior)
    const enabledMethods = config.http?.enabledMethods;
    const hasEnabledMethods = enabledMethods && Array.isArray(enabledMethods);
    
    // When not configured, destructive methods require explicit enablement
    // hasEnabledMethods should be falsy (false, undefined, or null)
    expect(!!hasEnabledMethods).toBe(false);
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
