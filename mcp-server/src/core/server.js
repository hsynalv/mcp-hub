import express from "express";
import "express-async-errors";
import cors from "cors";
import morgan from "morgan";
import { performance } from "perf_hooks";
import { AppError, NotFoundError } from "./errors.js";
import { loadPlugins, getPlugins } from "./plugins.js";
import { auditMiddleware, getLogs, getStats } from "./audit.js";
import { requireScope, isAuthEnabled } from "./auth.js";
import { createJob, getJob, listJobs } from "./jobs.js";
import { loadPresetsAtStartup, policyGuardrailMiddleware } from "./policy-guard.js";
import { createMcpHttpMiddleware } from "../mcp/http-transport.js";
import { getAllCircuitStates } from "./resilience.js";
import { getAllMetrics, httpRequestsTotal, httpRequestDuration, httpActiveConnections } from "./metrics.js";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize all JSON responses to a single envelope:
 *  - success: { ok: true, data, meta: { requestId } }
 *  - error:   { ok: false, error: { code, message, details? }, meta: { requestId } }
 */
function responseEnvelopeMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const requestId = req.requestId ?? null;

    // If already in the new envelope, pass through.
    if (isPlainObject(payload) && (payload.ok === true || payload.ok === false) && payload.meta && "requestId" in payload.meta) {
      return originalJson(payload);
    }

    // If it's an AppError-like serialized payload from older shape, normalize it.
    if (isPlainObject(payload) && payload.ok === false) {
      // legacy: { ok:false, error:"code", message, details?, requestId? }
      if (typeof payload.error === "string") {
        const out = {
          ok: false,
          error: {
            code: payload.error,
            message: payload.message ?? "Request failed",
            ...(payload.details != null ? { details: payload.details } : {}),
          },
          meta: { requestId: payload.requestId ?? requestId },
        };
        return originalJson(out);
      }
      // new-ish: { ok:false, error:{code,message,details?}, meta? }
      if (isPlainObject(payload.error) && typeof payload.error.code === "string") {
        const out = {
          ok: false,
          error: payload.error,
          meta: { requestId: payload?.meta?.requestId ?? requestId },
        };
        return originalJson(out);
      }
    }

    // Success normalization.
    const out = {
      ok: true,
      data: payload,
      meta: { requestId },
    };
    return originalJson(out);
  };
  next();
}

/** Reads x-project-id and x-env headers for projects-first config. */
function projectContextMiddleware(req, _res, next) {
  req.projectId = req.headers["x-project-id"]?.trim() || null;
  req.projectEnv = req.headers["x-env"]?.trim() || null;
  next();
}

function requiresProjectContext(req) {
  const method = (req.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;
  return false;
}

function enforceProjectContextMiddleware(req, res, next) {
  if (!requiresProjectContext(req)) return next();

  if (!req.projectId) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "missing_project_id",
        message: "x-project-id header is required for write operations",
      },
    });
  }

  if (!req.projectEnv) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "missing_env",
        message: "x-env header is required for write operations (dev|staging|prod)",
      },
    });
  }

  next();
}

export async function createServer() {
  const app = express();

  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(projectContextMiddleware);
  app.use(auditMiddleware);
  app.use(responseEnvelopeMiddleware);
  app.use(enforceProjectContextMiddleware);
  app.use(policyGuardrailMiddleware);

  // ── Metrics tracking middleware ────────────────────────────────────────────
  app.use((req, res, next) => {
    const start = performance.now();
    
    // Track active connections
    httpActiveConnections.inc({}, 1);
    
    // Override end to capture metrics
    const originalEnd = res.end.bind(res);
    res.end = function(chunk, encoding) {
      res.end = originalEnd;
      res.end(chunk, encoding);
      
      const duration = (performance.now() - start) / 1000;
      const route = req.route?.path || req.path || "unknown";
      
      // Record metrics
      httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
      httpRequestDuration.observe({ method: req.method, route }, duration);
      httpActiveConnections.dec({}, 1);
    };
    
    next();
  });

  // ── Core routes ────────────────────────────────────────────────────────────

  app.get("/health", (req, res) => {
    res.json({ status: "ok", auth: isAuthEnabled() ? "enabled" : "disabled" });
  });

  app.get("/health/detailed", async (req, res) => {
    const timestamp = new Date().toISOString();
    const circuitStates = getAllCircuitStates();

    // Check Redis if configured
    let redisStatus = { status: "not_configured", latency_ms: null };
    if (process.env.REDIS_URL) {
      try {
        const { redis } = await import("./redis.js");
        const start = Date.now();
        await redis.ping();
        redisStatus = { status: "up", latency_ms: Date.now() - start };
      } catch (err) {
        redisStatus = { status: "down", error: err.message };
      }
    }

    // Determine overall status
    const servicesDown = Object.values(circuitStates).filter(
      (c) => c.state === "OPEN"
    ).length;
    const redisDown = redisStatus.status === "down";
    let overallStatus = "healthy";
    if (redisDown || servicesDown > 2) {
      overallStatus = "unhealthy";
    } else if (servicesDown > 0) {
      overallStatus = "degraded";
    }

    res.json({
      status: overallStatus,
      timestamp,
      version: process.env.npm_package_version || "1.0.0",
      services: {
        redis: redisStatus,
        ...Object.fromEntries(
          Object.entries(circuitStates).map(([name, state]) => [
            name,
            {
              status: state.state === "CLOSED" ? "up" : "down",
              circuit_state: state.state,
              failure_count: state.failureCount,
              ...(state.nextAttempt
                ? { next_attempt: new Date(state.nextAttempt).toISOString() }
                : {}),
            },
          ])
        ),
      },
      config: {
        auth_enabled: isAuthEnabled(),
        redis_enabled: !!process.env.REDIS_URL,
      },
    });
  });

  // ── Prometheus Metrics endpoint ────────────────────────────────────────────
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(getAllMetrics());
  });

  app.get("/whoami", requireScope("read"), (req, res) => {
    res.json({
      auth: {
        enabled: isAuthEnabled(),
        scopes: req.authScopes ?? [],
      },
      actor: req.actor ?? null,
      project: {
        id: req.projectId,
        env: req.projectEnv,
      },
    });
  });

  app.get("/plugins", requireScope("read"), (req, res) => {
    res.json(getPlugins());
  });

  app.get("/plugins/:name/manifest", requireScope("read"), (req, res) => {
    const plugins = getPlugins();
    const plugin  = plugins.find((p) => p.name === req.params.name);
    if (!plugin) return res.status(404).json({ ok: false, error: { code: "plugin_not_found", message: "Plugin not found" } });
    res.json(plugin);
  });

  /**
   * GET /openapi.json
   * Auto-generated OpenAPI spec from all plugin manifests.
   */
  app.get("/openapi.json", requireScope("read"), (_req, res) => {
    const plugins = getPlugins();
    const paths = {};

    for (const plugin of plugins) {
      for (const ep of plugin.endpoints ?? []) {
        const pathKey = ep.path.replace(/:(\w+)/g, "{$1}");
        if (!paths[pathKey]) paths[pathKey] = {};

        const method = ep.method.toLowerCase();
        paths[pathKey][method] = {
          summary: ep.description ?? `${ep.method} ${ep.path}`,
          operationId: `${plugin.name}_${method}_${ep.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
          tags: ep.tags ?? [plugin.name],
          security: ep.scope ? [{ bearerAuth: [] }] : [],
          parameters: [
            ...(ep.path.includes(":") ? [] : []), // Path params extracted from :pattern
            ...(ep.scope ? [{ name: "Authorization", in: "header", required: true, schema: { type: "string" } }] : []),
          ].filter(Boolean),
          requestBody: ep.requestSchema ? {
            content: { "application/json": { schema: ep.requestSchema } },
          } : undefined,
          responses: {
            "200": {
              description: "Success",
              content: {
                "application/json": {
                  schema: ep.responseSchema ?? {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      data: { type: "object" },
                      meta: { type: "object", properties: { requestId: { type: "string" } } },
                    },
                  },
                },
              },
            },
            "400": { description: "Bad Request" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "429": { description: "Rate Limited" },
          },
        };
      }
    }

    const openApiSpec = {
      openapi: "3.0.3",
      info: {
        title: "AI-Hub API",
        version: "1.0.0",
        description: "Universal tool and service bridge for AI agents",
      },
      servers: [{ url: "http://localhost:8787" }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API key",
          },
        },
      },
      paths,
    };

    res.json(openApiSpec);
  });

  // ── Audit routes ───────────────────────────────────────────────────────────

  app.get("/audit/logs", requireScope("read"), (req, res) => {
    const { plugin, status, limit } = req.query;
    const logs = getLogs({ plugin, status, limit: Number(limit) || 100 });
    res.json({ count: logs.length, logs });
  });

  app.get("/audit/stats", requireScope("read"), (req, res) => {
    res.json({ stats: getStats() });
  });

  // ── Job queue routes ───────────────────────────────────────────────────────

  app.post("/jobs", requireScope("write"), (req, res) => {
    const { type, payload } = req.body ?? {};
    if (!type) return res.status(400).json({ ok: false, error: { code: "missing_type", message: "Provide job type" } });

    // Built-in job types can be added here; external callers use type="custom"
    const job = createJob(type, payload ?? {}, async (j) => {
      // Placeholder — real runners are registered by plugins
      await new Promise((r) => setTimeout(r, 100));
      j.succeed({ message: "Job runner not implemented for type: " + j.type });
    });

    res.status(202).json({ job });
  });

  app.get("/jobs", requireScope("read"), (req, res) => {
    const { state, type, limit } = req.query;
    const jobs = listJobs({ state, type, limit: Number(limit) || 50 });
    res.json({ count: jobs.length, jobs });
  });

  app.get("/jobs/:id", requireScope("read"), (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: { code: "job_not_found", message: "Job not found" } });
    res.json({ job });
  });

  // ── MCP Gateway ──────────────────────────────────────────────────────────────

  app.all("/mcp", createMcpHttpMiddleware());

  // ── Plugin loader ──────────────────────────────────────────────────────────

  // Load policy presets at startup
  loadPresetsAtStartup();

  await loadPlugins(app);

  // ── 404 handler ────────────────────────────────────────────────────────────

  app.use((req, res, next) => next(new NotFoundError(`Route not found: ${req.method} ${req.path}`)));

  // ── Error handler ──────────────────────────────────────────────────────────

  app.use((err, req, res, next) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    const requestId = req?.requestId ?? null;
    const payload = err.serialize
      ? err.serialize(requestId)
      : {
          ok: false,
          error: {
            code: "internal_error",
            message: err.message ?? "Internal server error",
          },
          meta: {
            requestId,
          },
        };

    if (req?.requestId) res.setHeader("x-request-id", req.requestId);

    if (process.env.NODE_ENV === "development") {
      console.error("[ERROR]", err.stack ?? err);
    } else {
      console.error("[ERROR]", err.message ?? err);
    }

    if (process.env.SENTRY_DSN) {
      import("@sentry/node").then((m) => m.default).then((Sentry) => Sentry.captureException(err)).catch(() => {});
    }

    res.status(status).json(payload);
  });

  return app;
}
