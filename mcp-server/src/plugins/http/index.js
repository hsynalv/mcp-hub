import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { validateBody } from "../../core/validate.js";
import { resolveDeep } from "../secrets/secrets.store.js";
import { isDomainAllowed, checkRateLimit, getPolicyInfo, getRateLimitState } from "./policy.js";
import { getFromCache, setInCache, clearCache, getCacheStats } from "./http.cache.js";
import { httpRequest } from "./http.client.js";
import { config } from "../../core/config.js";

export const name = "http";
export const version = "1.0.0";
export const description = "Controlled outbound HTTP with allowlist, rate limiting, caching, and secret ref resolution";
export const capabilities = ["write"];
export const requires = [];
export const endpoints = [
  { method: "POST",   path: "/http/request", description: "Make a controlled HTTP request",     scope: "write"  },
  { method: "GET",    path: "/http/cache",   description: "Cache stats",                        scope: "read"   },
  { method: "DELETE", path: "/http/cache",   description: "Clear the response cache",           scope: "danger" },
  { method: "GET",    path: "/http/policy",  description: "Allowlist, rate limits, config info", scope: "read"   },
  { method: "GET",    path: "/http/health",  description: "Plugin health",                      scope: "read"   },
];
export const examples = [
  'POST /http/request  body: {"method":"GET","url":"https://api.github.com/users/octocat"}',
  'POST /http/request  body: {"method":"POST","url":"https://api.example.com/data","headers":{"Authorization":"{{secret:MY_KEY}}"},"cache":true}',
  "GET  /http/policy",
  "GET  /http/cache",
];

const requestSchema = z.object({
  method:   z.string().toUpperCase().default("GET"),
  url:      z.string().url(),
  headers:  z.record(z.string()).optional().default({}),
  body:     z.any().optional(),
  cache:    z.boolean().optional().default(false),
  cacheTtl: z.number().int().min(1).optional(),
});

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /http/policy
   * Returns active allowlist, blocklist, rate limit, and timeout config.
   */
  router.get("/policy", requireScope("read"), (_req, res) => {
    res.json({ ok: true, policy: getPolicyInfo(), rateLimitState: getRateLimitState() });
  });

  /**
   * GET /http/cache
   * Returns cache statistics.
   */
  router.get("/cache", requireScope("read"), (_req, res) => {
    res.json({ ok: true, cache: getCacheStats() });
  });

  /**
   * DELETE /http/cache
   * Clear the entire response cache.
   */
  router.delete("/cache", requireScope("danger"), (_req, res) => {
    const cleared = clearCache();
    res.json({ ok: true, cleared });
  });

  /**
   * POST /http/request
   * Make a controlled outbound HTTP request.
   *
   * Enforces:
   *  - domain allowlist/blocklist
   *  - per-domain rate limit
   *  - response size limit
   *  - request timeout
   *  - optional TTL cache
   *  - {{secret:NAME}} header/body resolution
   */
  router.post("/request", requireScope("write"), validateBody(requestSchema), async (req, res) => {
    const data = req.validatedBody;

    const { method, url, headers, body: reqBody, cache: useCache, cacheTtl } = data;

    // Allowlist check
    if (!isDomainAllowed(url)) {
      return res.status(403).json({
        ok:     false,
        error:  "domain_not_allowed",
        url,
        message: "This domain is blocked or not in the allowlist. Check GET /http/policy for allowed domains.",
      });
    }

    // Rate limit check
    const rateCheck = checkRateLimit(url);
    if (!rateCheck.allowed) {
      return res.status(429).json({ ok: false, error: rateCheck.reason, ...rateCheck });
    }

    // Resolve {{secret:NAME}} refs in headers and body
    const resolvedHeaders = resolveDeep(headers ?? {});
    const resolvedBody    = resolveDeep(reqBody);

    // Check cache
    if (useCache && method.toUpperCase() === "GET") {
      const cached = getFromCache(method, url, null);
      if (cached) {
        return res.json({ ok: true, cached: true, ageSeconds: cached.ageSeconds, ...cached });
      }
    }

    // Make the request
    const result = await httpRequest({
      method,
      url,
      headers: resolvedHeaders,
      body:    resolvedBody,
    });

    if (!result.ok && result.error) {
      return res.status(result.status ?? 502).json({ ok: false, ...result });
    }

    // Store in cache
    if (useCache && method.toUpperCase() === "GET" && result.status < 400) {
      const ttl = cacheTtl ?? config.http?.cacheTtlSeconds ?? 300;
      setInCache(method, url, null, {
        status:  result.status,
        headers: result.headers,
        body:    result.body,
        size:    result.size,
      }, ttl);
    }

    res.json({
      cached:     false,
      status:     result.status,
      statusText: result.statusText,
      headers:    result.headers,
      body:       result.body,
      size:       result.size,
      truncated:  result.truncated,
      durationMs: result.durationMs,
    });
  });

  app.use("/http", router);
}
