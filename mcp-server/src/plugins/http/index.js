import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { validateBody } from "../../core/validate.js";
import { Errors, standardizeError } from "../../core/error-standard.js";
import { resolveDeep } from "../secrets/secrets.store.js";
import { isDomainAllowed, checkRateLimit, getPolicyInfo, getRateLimitState } from "./policy.js";
import { getFromCache, setInCache, clearCache, getCacheStats } from "./http.cache.js";
import { httpRequest } from "./http.client.js";
import { validateUrlSafety } from "./security.js";
import { config } from "../../core/config.js";
import { randomBytes } from "crypto";
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

// ── Audit Log ────────────────────────────────────────────────────────────────
const httpAuditLog = [];
const MAX_AUDIT_LOG = 1000;

function generateCorrelationId() {
  return randomBytes(8).toString("hex");
}

function auditEntry({ method, url, allowed, reason, statusCode, durationMs, error, correlationId, actor }) {
  const entry = {
    timestamp: new Date().toISOString(),
    method,
    url,
    allowed,
    reason,
    statusCode,
    durationMs,
    error: error ? String(error) : undefined,
    correlationId,
    actor: actor || "unknown",
  };
  httpAuditLog.unshift(entry);
  if (httpAuditLog.length > MAX_AUDIT_LOG) httpAuditLog.pop();
  return entry;
}

function getAuditLogEntries(limit = 100) {
  return httpAuditLog.slice(0, Math.min(limit, MAX_AUDIT_LOG));
}

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
    const actor = req.actor || null;
    const startTime = Date.now();

    // SSRF Protection - Check for private/internal hosts
    const ssrfCheck = validateUrlSafety(url);
    if (!ssrfCheck.allowed) {
      auditEntry({ method, url, allowed: false, reason: ssrfCheck.reason, correlationId, actor });
      const err = Errors.authorization(`SSRF protection: ${ssrfCheck.reason}`);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // HTTP Method Governance - Check destructive methods
    const methodCheck = isMethodAllowedByConfig(method);
    if (!methodCheck.allowed) {
      auditEntry({ method, url, allowed: false, reason: methodCheck.reason, correlationId, actor });
      const err = Errors.authorization(methodCheck.message || `Method ${method} not allowed`);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // Allowlist check
    if (!isDomainAllowed(url)) {
      auditEntry({ method, url, allowed: false, reason: "domain_not_allowed", correlationId, actor });
      const err = Errors.authorization("Domain not in allowlist");
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    // Rate limit check
    const rateCheck = checkRateLimit(url);
    if (!rateCheck.allowed) {
      auditEntry({ method, url, allowed: false, reason: rateCheck.reason, correlationId, actor });
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
        auditEntry({ method, url, allowed: true, statusCode: cached.status, durationMs: Date.now() - startTime, correlationId, actor });
        return res.json({ ok: true, cached: true, ageSeconds: cached.ageSeconds, correlationId, ...cached });
      }
    }

    // Make the request
    let result;
    try {
      result = await httpRequest({
        method,
        url,
        headers: resolvedHeaders,
        body:    resolvedBody,
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      auditEntry({ method, url, allowed: true, durationMs, error: err.message, correlationId, actor });
      const standardized = standardizeError(err, "http_request");
      return res.status(standardized.statusCode || 502).json(standardized.serialize(req.requestId));
    }

    const durationMs = Date.now() - startTime;

    if (!result.ok && result.error) {
      auditEntry({ method, url, allowed: true, statusCode: result.status, durationMs, error: result.error, correlationId, actor });
      const err = Errors.externalError("http", result.error);
      return res.status(result.status ?? 502).json({
        ...standardizeError(err).serialize(req.requestId),
        durationMs: result.durationMs,
      });
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

    auditEntry({ method, url, allowed: true, statusCode: result.status, durationMs, correlationId, actor });

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
   * Returns HTTP request audit log.
   */
  router.get("/audit", requireScope("read"), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/http", router);
}
