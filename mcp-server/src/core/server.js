import express from "express";
import "express-async-errors";
import cors from "cors";
import morgan from "morgan";
import { AppError, NotFoundError } from "./errors.js";
import { loadPlugins, getPlugins } from "./plugins.js";
import { auditMiddleware, getLogs, getStats } from "./audit.js";
import { requireScope, isAuthEnabled } from "./auth.js";
import { createJob, getJob, listJobs } from "./jobs.js";

/** Reads x-project-id and x-env headers for projects-first config. */
function projectContextMiddleware(req, _res, next) {
  req.projectId = req.headers["x-project-id"]?.trim() || null;
  req.projectEnv = req.headers["x-env"]?.trim() || "dev";
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

  // ── Core routes ────────────────────────────────────────────────────────────

  app.get("/health", (req, res) => {
    res.json({ status: "ok", auth: isAuthEnabled() ? "enabled" : "disabled" });
  });

  app.get("/plugins", requireScope("read"), (req, res) => {
    res.json(getPlugins());
  });

  app.get("/plugins/:name/manifest", requireScope("read"), (req, res) => {
    const plugins = getPlugins();
    const plugin  = plugins.find((p) => p.name === req.params.name);
    if (!plugin) return res.status(404).json({ ok: false, error: "plugin_not_found" });
    res.json({ ok: true, plugin });
  });

  // ── Audit routes ───────────────────────────────────────────────────────────

  app.get("/audit/logs", requireScope("read"), (req, res) => {
    const { plugin, status, limit } = req.query;
    const logs = getLogs({ plugin, status, limit: Number(limit) || 100 });
    res.json({ ok: true, count: logs.length, logs });
  });

  app.get("/audit/stats", requireScope("read"), (req, res) => {
    res.json({ ok: true, stats: getStats() });
  });

  // ── Job queue routes ───────────────────────────────────────────────────────

  app.post("/jobs", requireScope("write"), (req, res) => {
    const { type, payload } = req.body ?? {};
    if (!type) return res.status(400).json({ ok: false, error: "missing_type", message: "Provide job type" });

    // Built-in job types can be added here; external callers use type="custom"
    const job = createJob(type, payload ?? {}, async (j) => {
      // Placeholder — real runners are registered by plugins
      await new Promise((r) => setTimeout(r, 100));
      j.succeed({ message: "Job runner not implemented for type: " + j.type });
    });

    res.status(202).json({ ok: true, job });
  });

  app.get("/jobs", requireScope("read"), (req, res) => {
    const { state, type, limit } = req.query;
    const jobs = listJobs({ state, type, limit: Number(limit) || 50 });
    res.json({ ok: true, count: jobs.length, jobs });
  });

  app.get("/jobs/:id", requireScope("read"), (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
    res.json({ ok: true, job });
  });

  // ── Plugin loader ──────────────────────────────────────────────────────────

  await loadPlugins(app);

  // ── 404 handler ────────────────────────────────────────────────────────────

  app.use((req, res, next) => next(new NotFoundError(`Route not found: ${req.method} ${req.path}`)));

  // ── Error handler ──────────────────────────────────────────────────────────

  app.use((err, req, res, next) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    const requestId = req?.requestId ?? null;
    const payload = err.serialize
      ? err.serialize(requestId)
      : { ok: false, error: "internal_error", message: err.message ?? "Internal server error", ...(requestId ? { requestId } : {}) };

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
