import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { validateBody } from "../../core/validate.js";
import { Errors, standardizeError, createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { auditLog, generateCorrelationId, getAuditManager } from "../../core/audit/index.js";
import { resolveDeep } from "../secrets/secrets.store.js";
import { isDomainAllowed, checkRateLimit, getPolicyInfo, getRateLimitState } from "./policy.js";
import { getFromCache, setInCache, clearCache, getCacheStats } from "./http.cache.js";
import { httpRequest } from "./http.client.js";
import { validateUrlSafety } from "./security.js";
import { config } from "../../core/config.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

// ── Plugin Metadata ──────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "http",
  version: "1.0.0",
  description: "HTTP client with caching, rate limiting, and security controls",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["http", "request", "cache", "audit", "security"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: false,
  supportsWorkspaceIsolation: false,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  tags: ["http", "client", "api", "rest", "webhook"],
  dependencies: [],
  since: "1.0.0",
  notes: "HTTP client with built-in caching, rate limiting, and domain security controls.",
});

const handleError = createPluginErrorHandler("http");

// ── Audit helper ──────────────────────────────────────────────────────────────

async function httpAudit({ operation, actor, correlationId, durationMs, success, method, url, statusCode, error }) {
  try {
    await auditLog({
      plugin: "http",
      operation,
      actor:         actor || "anonymous",
      correlationId,
      durationMs,
      success,
      error:         error ? String(error) : undefined,
      method,
      url,
      statusCode,
    });
  } catch { /* never crash on audit failure */ }
}

async function getAuditLogEntries(limit = 100) {
  const manager = getAuditManager();
  return manager.getRecentEntries({ limit, plugin: "http" });
}

export const endpoints = [
  { method: "POST",   path: "/http/request", description: "Make a controlled HTTP request",     scope: "write"  },
  { method: "GET",    path: "/http/cache",   description: "Cache stats",                        scope: "read"   },
  { method: "DELETE", path: "/http/cache",   description: "Clear the response cache",           scope: "danger" },
  { method: "GET",    path: "/http/policy",  description: "Allowlist, rate limits, config info", scope: "read"   },
  { method: "GET",    path: "/http/audit",   description: "HTTP request audit log",             scope: "read"   },
  { method: "GET",    path: "/http/health",  description: "Plugin health",                      scope: "read"   },
];
export const examples = [
  'POST /http/request  body: {"method":"GET","url":"https://api.github.com/users/octocat"}',
  'POST /http/request  body: {"method":"POST","url":"https://api.example.com/data","headers":{"Authorization":"{{secret:MY_KEY}}"},"cache":true}',
  "GET  /http/policy",
  "GET  /http/cache",
  "GET  /http/audit?limit=10",
];

const requestSchema = z.object({
  method:   z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url:      z.string().url(),
  headers:  z.record(z.string()).optional().default({}),
  body:     z.any().optional(),
  cache:    z.boolean().optional().default(false),
  cacheTtl: z.number().int().min(1).optional(),
});

/**
 * Check if HTTP method is allowed by configuration
 * Default: only safe methods (GET, HEAD, OPTIONS)
 * Destructive methods (POST, PUT, PATCH, DELETE) require explicit enablement
 */
function isMethodAllowedByConfig(method) {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  const destructiveMethods = ["POST", "PUT", "PATCH", "DELETE"];
  const upperMethod = method?.toUpperCase();

  // Safe methods are always allowed
  if (safeMethods.includes(upperMethod)) {
    return { allowed: true };
  }

  // Destructive methods require explicit enablement
  if (destructiveMethods.includes(upperMethod)) {
    const enabledMethods = config.http?.enabledMethods;
    
    // If enabledMethods is not configured, destructive methods are blocked
    if (!enabledMethods || !Array.isArray(enabledMethods)) {
      return {
        allowed: false,
        reason: "destructive_methods_disabled",
        message: `Method ${upperMethod} is not enabled. Configure HTTP_ENABLED_METHODS to enable destructive methods.`,
        requiredConfig: "HTTP_ENABLED_METHODS",
      };
    }

    // Check if specific method is enabled
    if (!enabledMethods.includes(upperMethod)) {
      return {
        allowed: false,
        reason: "method_not_enabled",
        message: `Method ${upperMethod} is not in the enabled methods list`,
        enabledMethods,
      };
    }

    return { allowed: true };
  }

  return { allowed: false, reason: "unknown_method" };
}

export function register(app) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      const policy = getPolicyInfo();
      const cache  = getCacheStats();
      res.json({
        ok:      true,
        plugin:  "http",
        version: "1.0.0",
        config: {
          allowlistSize:  policy.allowlist?.length  ?? 0,
          blocklistSize:  policy.blocklist?.length  ?? 0,
          rateLimitRpm:   policy.rateLimit?.requestsPerMinute ?? null,
          enabledMethods: policy.enabledMethods ?? ["GET", "HEAD", "OPTIONS"],
          secretsEnabled: true,
        },
        cache: { entries: cache.entries ?? 0, hitRate: cache.hitRate ?? null },
      });
    } catch (err) {
      res.status(500).json(handleError(err, "health"));
    }
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
   *  - SSRF protection (localhost, private IPs)
   *  - HTTP method restrictions
   *  - domain allowlist/blocklist
   *  - per-domain rate limit
   *  - response size limit
   *  - request timeout
   *  - optional TTL cache
   *  - {{secret:NAME}} header/body resolution
   *  - audit logging
   */
  router.post("/request", requireScope("write"), validateBody(requestSchema), async (req, res) => {
    const data = req.validatedBody;
    const { method, url, headers, body: reqBody, cache: useCache, cacheTtl } = data;
    const correlationId = generateCorrelationId();
    const actor         = req.user?.sub || "anonymous";
    const startTime     = Date.now();

    // SSRF Protection
    const ssrfCheck = validateUrlSafety(url);
    if (!ssrfCheck.allowed) {
      await httpAudit({ operation: "request", actor, correlationId, durationMs: 0, success: false, method, url, error: ssrfCheck.reason });
      const err = Errors.authorization(`SSRF protection: ${ssrfCheck.reason}`);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // HTTP Method Governance
    const methodCheck = isMethodAllowedByConfig(method);
    if (!methodCheck.allowed) {
      await httpAudit({ operation: "request", actor, correlationId, durationMs: 0, success: false, method, url, error: methodCheck.reason });
      const err = Errors.authorization(methodCheck.message || `Method ${method} not allowed`);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // Allowlist check
    if (!isDomainAllowed(url)) {
      await httpAudit({ operation: "request", actor, correlationId, durationMs: 0, success: false, method, url, error: "domain_not_allowed" });
      const err = Errors.authorization("Domain not in allowlist");
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // Rate limit check
    const rateCheck = checkRateLimit(url);
    if (!rateCheck.allowed) {
      await httpAudit({ operation: "request", actor, correlationId, durationMs: 0, success: false, method, url, error: rateCheck.reason });
      const err = Errors.rateLimit(rateCheck.reason, rateCheck.resetInSeconds);
      return res.status(429).json(standardizeError(err).serialize(req.requestId));
    }

    // Resolve {{secret:NAME}} refs in headers and body
    const resolvedHeaders = resolveDeep(headers ?? {});
    const resolvedBody    = resolveDeep(reqBody);

    // Check cache
    if (useCache && method.toUpperCase() === "GET") {
      const cached = getFromCache(method, url, null);
      if (cached) {
        await httpAudit({ operation: "request", actor, correlationId, durationMs: Date.now() - startTime, success: true, method, url, statusCode: cached.status });
        return res.json({ ok: true, cached: true, ageSeconds: cached.ageSeconds, correlationId, ...cached });
      }
    }

    // Make the request
    let result;
    try {
      result = await httpRequest({ method, url, headers: resolvedHeaders, body: resolvedBody });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      await httpAudit({ operation: "request", actor, correlationId, durationMs, success: false, method, url, error: err.message });
      const standardized = standardizeError(err, "http_request");
      return res.status(standardized.statusCode || 502).json(standardized.serialize(req.requestId));
    }

    const durationMs = Date.now() - startTime;

    if (!result.ok && result.error) {
      await httpAudit({ operation: "request", actor, correlationId, durationMs, success: false, method, url, statusCode: result.status, error: result.error });
      const err = Errors.externalError("http", result.error);
      return res.status(result.status ?? 502).json({
        ...standardizeError(err).serialize(req.requestId),
        durationMs: result.durationMs,
      });
    }

    // Store in cache
    if (useCache && method.toUpperCase() === "GET" && result.status < 400) {
      const ttl = cacheTtl ?? config.http?.cacheTtlSeconds ?? 300;
      setInCache(method, url, null, { status: result.status, headers: result.headers, body: result.body, size: result.size }, ttl);
    }

    await httpAudit({ operation: "request", actor, correlationId, durationMs, success: true, method, url, statusCode: result.status });

    res.json({
      ok:         true,
      cached:     false,
      status:     result.status,
      statusText: result.statusText,
      headers:    result.headers,
      body:       result.body,
      size:       result.size,
      truncated:  result.truncated,
      durationMs: result.durationMs,
      correlationId,
    });
  });

  /**
   * GET /http/audit
   * Returns HTTP request audit log from core audit manager.
   */
  router.get("/audit", requireScope("read"), async (req, res) => {
    try {
      const limit   = Math.min(parseInt(req.query.limit) || 50, 100);
      const entries = await getAuditLogEntries(limit);
      res.json({ ok: true, data: { audit: entries, total: entries.length } });
    } catch (err) {
      res.status(500).json(handleError(err, "audit"));
    }
  });

  app.use("/http", router);
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  // ── http_request ─────────────────────────────────────────────────────────
  {
    name: "http_request",
    description: "Make a controlled outbound HTTP request. Enforces SSRF protection, domain allowlist, rate limits. Supports {{secret:NAME}} refs in headers/body so secrets are never exposed.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        method:   { type: "string", enum: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
        url:      { type: "string", description: "Full URL including protocol (e.g. https://api.example.com/data)" },
        headers:  { type: "object", description: "Request headers. Use {{secret:NAME}} to inject secrets.", additionalProperties: { type: "string" } },
        body:     { description: "Request body (object or string). Use {{secret:NAME}} for secret values." },
        cache:    { type: "boolean", default: false, description: "Cache GET responses" },
        cacheTtl: { type: "number", description: "Cache TTL in seconds (default 300)" },
      },
      required: ["url"],
    },
    handler: async (args, context = {}) => {
      try {
        const correlationId = generateCorrelationId();
        const actor         = context.actor || "anonymous";
        const method        = (args.method || "GET").toUpperCase();
        const url           = args.url;
        const startTime     = Date.now();

        const ssrfCheck = validateUrlSafety(url);
        if (!ssrfCheck.allowed) {
          await httpAudit({ operation: "mcp_request", actor, correlationId, durationMs: 0, success: false, method, url, error: ssrfCheck.reason });
          return { ok: false, error: { code: "ssrf_blocked", message: `SSRF protection: ${ssrfCheck.reason}` } };
        }

        const methodCheck = isMethodAllowedByConfig(method);
        if (!methodCheck.allowed) {
          return { ok: false, error: { code: "method_not_allowed", message: methodCheck.message || `Method ${method} not allowed` } };
        }

        if (!isDomainAllowed(url)) {
          await httpAudit({ operation: "mcp_request", actor, correlationId, durationMs: 0, success: false, method, url, error: "domain_not_allowed" });
          return { ok: false, error: { code: "domain_not_allowed", message: "Domain not in allowlist" } };
        }

        const rateCheck = checkRateLimit(url);
        if (!rateCheck.allowed) {
          return { ok: false, error: { code: "rate_limited", message: rateCheck.reason, resetInSeconds: rateCheck.resetInSeconds } };
        }

        const resolvedHeaders = resolveDeep(args.headers ?? {});
        const resolvedBody    = resolveDeep(args.body);

        if (args.cache && method === "GET") {
          const cached = getFromCache(method, url, null);
          if (cached) {
            return { ok: true, cached: true, status: cached.status, headers: cached.headers, body: cached.body };
          }
        }

        const result = await httpRequest({ method, url, headers: resolvedHeaders, body: resolvedBody });
        const durationMs = Date.now() - startTime;

        await httpAudit({ operation: "mcp_request", actor, correlationId, durationMs, success: result.ok, method, url, statusCode: result.status });

        if (!result.ok) {
          return { ok: false, error: { code: "request_failed", message: result.error, status: result.status } };
        }

        if (args.cache && method === "GET" && result.status < 400) {
          const ttl = args.cacheTtl ?? config.http?.cacheTtlSeconds ?? 300;
          setInCache(method, url, null, { status: result.status, headers: result.headers, body: result.body, size: result.size }, ttl);
        }

        return { ok: true, cached: false, status: result.status, headers: result.headers, body: result.body, durationMs: result.durationMs, truncated: result.truncated };
      } catch (err) {
        return { ok: false, error: { code: "http_request_failed", message: err.message } };
      }
    },
  },

  // ── http_cache_clear ──────────────────────────────────────────────────────
  {
    name: "http_cache_clear",
    description: "Clear the HTTP response cache. Optionally clear only entries for a specific domain.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Clear cache only for this domain (optional). If omitted, clears entire cache." },
      },
    },
    handler: async (args) => {
      try {
        const cleared = clearCache(args.domain || null);
        return { ok: true, data: { cleared, domain: args.domain || "all" } };
      } catch (err) {
        return { ok: false, error: { code: "cache_clear_failed", message: err.message } };
      }
    },
  },

  // ── http_policy_info ─────────────────────────────────────────────────────
  {
    name: "http_policy_info",
    description: "Get the current HTTP policy: allowed domains, blocked domains, rate limit settings, and enabled HTTP methods.",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        return {
          ok: true,
          data: {
            policy:         getPolicyInfo(),
            rateLimitState: getRateLimitState(),
            cacheStats:     getCacheStats(),
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "policy_info_failed", message: err.message } };
      }
    },
  },
];
