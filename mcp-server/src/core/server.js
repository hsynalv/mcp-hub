import express from "express";
import "express-async-errors";
import cors from "cors";
import morgan from "morgan";
import { AppError, NotFoundError } from "./errors.js";
import { config } from "./config.js";
import { loadPlugins, getPlugins } from "./plugins.js";
import { initializeToolHooks } from "./tool-registry.js";
import { auditMiddleware, getLogs, getStats } from "./audit.js";
import { requireScope, isAuthEnabled } from "./auth.js";
import { submitJob, getJob, listJobs, getJobStats } from "./jobs.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { loadPresetsAtStartup, policyGuardrailMiddleware } from "./policy-guard.js";
import { getApprovalStore } from "./policy-hooks.js";
import { callTool } from "./tool-registry.js";
import { createMcpHttpMiddleware } from "../mcp/http-transport.js";

import { workspaceContextMiddleware } from "./workspace.js";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extract path parameters from Express-style route paths
 * e.g., "/workspace/:id/file/:name" → [{name: "id", in: "path", required: true, schema: {type: "string"}}, ...]
 * @param {string} path - Express route path
 * @returns {Object[]} OpenAPI parameter definitions
 */
function extractPathParams(path) {
  const params = [];
  const paramRegex = /:(\w+)/g;
  let match;
  while ((match = paramRegex.exec(path)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }
  return params;
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

/**
 * Correlation ID Middleware
 * Generates or extracts correlation ID for request tracing
 */
function correlationIdMiddleware(req, res, next) {
  // Use provided correlation ID or generate new one
  req.correlationId = req.headers["x-correlation-id"] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = req.correlationId; // Compatibility with existing code
  
  // Expose correlation ID in response
  res.setHeader("x-correlation-id", req.correlationId);
  
  next();
}

/**
 * Project Context Middleware
 *
 * Behavior:
 * - In development/local (default): Missing headers resolve to configurable defaults
 * - In production (REQUIRE_PROJECT_HEADERS=true): Missing headers return 400 error
 *
 * Resolution order:
 * 1. x-project-id header → req.projectId
 * 2. x-env header → req.projectEnv
 * 3. If headers missing and requireHeaders=false: use defaults
 * 4. If headers missing and requireHeaders=true: return 400 error
 *
 * Environment variables:
 * - REQUIRE_PROJECT_HEADERS: Set to "true" to enforce header requirements
 * - DEFAULT_PROJECT_ID: Override default project (default: "default-project")
 * - DEFAULT_ENV: Override default environment (default: "default-env")
 */
function projectContextMiddleware(req, res, next) {
  const headerProjectId = req.headers["x-project-id"]?.trim();
  const headerEnv = req.headers["x-env"]?.trim();

  // Check if headers are required (production multi-tenant mode)
  if (config.projectContext.requireHeaders) {
    if (!headerProjectId || !headerEnv) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "missing_project_context",
          message: "x-project-id and x-env headers are required",
        },
      });
    }
    req.projectId = headerProjectId;
    req.projectEnv = headerEnv;
    return next();
  }

  // Development/local mode: use defaults if headers missing
  const defaultProjectId = config.projectContext.defaults.projectId;
  const defaultEnv = config.projectContext.defaults.env;

  req.projectId = headerProjectId || defaultProjectId;
  req.projectEnv = headerEnv || defaultEnv;

  // Log when using defaults (helpful for debugging)
  if (!headerProjectId || !headerEnv) {
    console.warn(
      `[server] Using default project context (${req.projectId}/${req.projectEnv}). ` +
      `Set x-project-id and x-env headers to override, or set REQUIRE_PROJECT_HEADERS=true to enforce headers.`
    );
  }

  next();
}

export async function createServer() {
  const app = express();

  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(correlationIdMiddleware);
  app.use(projectContextMiddleware);
  app.use(workspaceContextMiddleware);
  app.use(auditMiddleware);
  app.use(responseEnvelopeMiddleware);
  app.use(policyGuardrailMiddleware);

  // ── Core routes ────────────────────────────────────────────────────────────

  app.get("/health", (req, res) => {
    res.json({ status: "ok", auth: isAuthEnabled() ? "enabled" : "disabled" });
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
        const pathParams = extractPathParams(ep.path);

        paths[pathKey][method] = {
          summary: ep.description ?? `${ep.method} ${ep.path}`,
          operationId: `${plugin.name}_${method}_${ep.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
          tags: ep.tags ?? [plugin.name],
          security: ep.scope ? [{ bearerAuth: [] }] : [],
          parameters: [
            ...pathParams,
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

  app.post("/jobs", requireScope("write"), async (req, res) => {
    const { type, payload } = req.body ?? {};
    if (!type) return res.status(400).json({ ok: false, error: { code: "missing_type", message: "Provide job type" } });

    try {
      // Submit job to the real jobs system - requires a registered runner
      const job = submitJob(type, payload ?? {}, {
        projectId: req.projectId,
        projectEnv: req.projectEnv,
        user: req.user || req.actor?.id,
      });

      res.status(202).json({
        ok: true,
        data: {
          job: {
            id: job.id,
            type: job.type,
            state: job.state,
            context: job.context,
            progress: job.progress,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
          },
        },
        meta: { requestId: req.requestId },
      });
    } catch (err) {
      // No runner registered for this job type
      if (err.message?.includes("No runner registered")) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "job_type_not_supported",
            message: `No job handler registered for type: "${type}". Available job types must be registered by plugins.`,
          },
          meta: { requestId: req.requestId },
        });
      }

      // Other errors
      return res.status(500).json({
        ok: false,
        error: {
          code: "job_submission_failed",
          message: err.message || "Failed to submit job",
        },
        meta: { requestId: req.requestId },
      });
    }
  });

  app.get("/jobs/stats", requireScope("read"), async (req, res) => {
    const stats = await getJobStats();
    res.json({ ok: true, stats });
  });

  app.get("/jobs", requireScope("read"), async (req, res) => {
    const { state, type, limit } = req.query;
    const jobs = await listJobs({ state, type, limit: Number(limit) || 50 });
    res.json({ count: jobs.length, jobs });
  });

  app.get("/jobs/:id", requireScope("read"), async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: { code: "job_not_found", message: "Job not found" } });
    res.json({ job });
  });

  // ── Approval routes ──────────────────────────────────────────────────────

  /**
   * GET /approvals/pending
   * Return all pending approval requests
   */
  app.get("/approvals/pending", requireScope("read"), (req, res) => {
    const approvalStore = getApprovalStore();
    if (!approvalStore?.listApprovals) {
      return res.status(503).json({
        ok: false,
        error: { code: "policy_unavailable", message: "Policy system not available" }
      });
    }
    const approvals = approvalStore.listApprovals({ status: "pending" });
    res.json({
      ok: true,
      data: {
        count: approvals.length,
        approvals,
      },
    });
  });

  /**
   * POST /approve
   * Approve a pending tool execution and execute it
   */
  app.post("/approve", requireScope("write"), async (req, res) => {
    const { approval_id } = req.body ?? {};

    if (!approval_id) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "missing_approval_id",
          message: "approval_id is required",
        },
      });
    }

    const approvalStore = getApprovalStore();
    if (!approvalStore?.getApproval || !approvalStore?.updateApprovalStatus) {
      return res.status(503).json({
        ok: false,
        error: { code: "policy_unavailable", message: "Policy system not available" }
      });
    }

    // Retrieve the approval request
    const approval = approvalStore.getApproval(approval_id);
    if (!approval) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "approval_not_found",
          message: `Approval request not found: ${approval_id}`,
        },
      });
    }

    if (approval.status !== "pending") {
      return res.status(400).json({
        ok: false,
        error: {
          code: "approval_already_processed",
          message: `Approval already ${approval.status}`,
          approval: {
            id: approval.id,
            status: approval.status,
          },
        },
      });
    }

    // Update approval status
    approvalStore.updateApprovalStatus(approval_id, "approved", req.user || "manual");

    // Execute the tool call
    const toolName = approval.toolName || approval.path?.replace("/tools/", "");
    if (!toolName) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "invalid_approval",
          message: "Approval request missing tool name",
        },
      });
    }

    try {
      const result = await callTool(toolName, approval.body || {}, {
        user: req.user || "manual",
        approvalId: approval_id,
        method: approval.method || "POST",
      });

      // Log the approval execution
      console.log(`[APPROVAL] Executed tool ${toolName} for approval ${approval_id}`);

      res.json({
        ok: true,
        data: {
          approval: {
            id: approval_id,
            status: "approved",
            executedAt: new Date().toISOString(),
          },
          result,
        },
      });
    } catch (error) {
      console.error(`[APPROVAL] Error executing tool ${toolName}:`, error);
      res.status(500).json({
        ok: false,
        error: {
          code: "execution_failed",
          message: error.message || "Tool execution failed after approval",
        },
      });
    }
  });

  // ── MCP Gateway ──────────────────────────────────────────────────────────────

  app.all("/mcp", createMcpHttpMiddleware());

  // ── Landing Page (Public) ─────────────────────────────────────────────────

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Serve landing page static files
  app.get("/landing/styles.css", (req, res) => {
    const cssPath = join(__dirname, "..", "public", "landing", "styles.css");
    if (!existsSync(cssPath)) {
      return res.status(404).json({ ok: false, error: "CSS not found" });
    }
    res.setHeader("Content-Type", "text/css");
    res.sendFile(cssPath);
  });

  app.get("/landing/app.js", (req, res) => {
    const jsPath = join(__dirname, "..", "public", "landing", "app.js");
    if (!existsSync(jsPath)) {
      return res.status(404).json({ ok: false, error: "JS not found" });
    }
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(jsPath);
  });

  // Root path - serve landing page
  app.get("/", (req, res) => {
    const indexPath = join(__dirname, "..", "public", "landing", "index.html");
    if (!existsSync(indexPath)) {
      return res.json({
        ok: true,
        message: "mcp-hub is running",
        version: "1.0.0",
        docs: "/api-docs",
        dashboard: "/observability/dashboard",
      });
    }
    res.sendFile(indexPath);
  });

  // ── Plugin loader ──────────────────────────────────────────────────────────

  // Load policy presets at startup
  loadPresetsAtStartup();

  // Initialize tool registry hooks (policy, auditing, etc.)
  initializeToolHooks();

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
