/**
 * Audit logging middleware.
 *
 * Logs every inbound API request with:
 *   - timestamp, plugin, endpoint, method, duration, status
 *   - masked request body (no secrets)
 *   - truncated response summary
 *
 * Storage: rotating in-memory ring buffer (last 1000 entries) + optional file.
 *
 * Access:
 *   GET /audit/logs   — query recent logs (admin scope required when auth enabled)
 *   GET /audit/stats  — aggregate counts per plugin/status
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_RING = 1000;
const ring = [];

const SECRET_KEYS = new Set([
  "password", "token", "secret", "key", "api_key", "apikey",
  "authorization", "access_token", "refresh_token", "credentials",
]);

function maskBody(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body)) {
    return body.map((item) =>
      item != null && typeof item === "object" ? maskBody(item) : item
    );
  }
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    const lower = k.toLowerCase();
    const isSensitive = [...SECRET_KEYS].some((s) => lower.includes(s));
    if (isSensitive) {
      out[k] = "[REDACTED]";
    } else if (v != null && typeof v === "object") {
      out[k] = maskBody(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export { maskBody };

function inferPlugin(path) {
  const match = path.match(/^\/(n8n|credentials|github|notion|jobs|audit|openapi|http|secrets|projects|policy|observability|file-storage|database)/);
  return match ? match[1] : "core";
}

function getLogFile() {
  const dir = process.env.CATALOG_CACHE_DIR || "./cache";
  return join(process.cwd(), dir, "audit.log");
}

function writeToFile(entry) {
  if (process.env.AUDIT_LOG_FILE !== "true") return;
  try {
    const dir = join(process.cwd(), process.env.CATALOG_CACHE_DIR || "./cache");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(getLogFile(), JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

function pushLog(entry) {
  if (ring.length >= MAX_RING) ring.shift();
  ring.push(entry);
  writeToFile(entry);
}

function makeRequestId() {
  return "req-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/**
 * Express middleware — attach to app before routes.
 * Sets req.requestId (from x-request-id header or generated).
 * Adds x-request-id to response headers.
 */
export function auditMiddleware(req, res, next) {
  const fromHeader = req.headers["x-request-id"]?.toString().trim();
  req.requestId =
    (fromHeader && fromHeader.length > 0 ? fromHeader : null) ||
    (req.correlationId != null ? String(req.correlationId) : null) ||
    makeRequestId();
  res.setHeader("x-request-id", req.requestId);

  const start = Date.now();
  const originalJson = res.json.bind(res);
  let responseSummary = null;

  res.json = (data) => {
    if (data && typeof data === "object") {
      const { ok, error, count } = data;
      let errorSummary = null;
      if (error) {
        if (typeof error === "string") errorSummary = error;
        else if (typeof error === "object" && typeof error.code === "string") errorSummary = error.code;
      }
      responseSummary = { ok, ...(errorSummary ? { error: errorSummary } : {}), ...(count != null ? { count } : {}) };
    }
    return originalJson(data);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const plugin   = inferPlugin(req.path);
    const status   = res.statusCode < 400 ? "success" : res.statusCode < 500 ? "client_error" : "server_error";

    const entry = {
      timestamp:  new Date().toISOString(),
      requestId:  req.requestId,
      method:     req.method,
      path:       req.path,
      plugin,
      duration,
      statusCode: res.statusCode,
      status,
      ...(responseSummary?.error ? { error: responseSummary.error } : {}),
    };

    if (req.method !== "GET" && req.body && Object.keys(req.body).length > 0) {
      entry.body = maskBody(req.body);
    }

    pushLog(entry);
  });

  next();
}

/** Return recent log entries with optional filters. */
export function getLogs({ plugin, status, limit = 100 } = {}) {
  let entries = [...ring].reverse(); // newest first
  if (plugin) entries = entries.filter((e) => e.plugin === plugin);
  if (status) entries = entries.filter((e) => e.status === status);
  return entries.slice(0, Math.min(limit, MAX_RING));
}

/** Return aggregate stats per plugin. */
export function getStats() {
  const byPlugin = {};
  let total = 0;
  let errors = 0;

  for (const e of ring) {
    total++;
    if (e.status !== "success") errors++;

    if (!byPlugin[e.plugin]) byPlugin[e.plugin] = { total: 0, success: 0, client_error: 0, server_error: 0, avgDuration: 0, _totalDuration: 0 };
    const s = byPlugin[e.plugin];
    s.total++;
    s[e.status] = (s[e.status] || 0) + 1;
    s._totalDuration += e.duration;
    s.avgDuration = Math.round(s._totalDuration / s.total);
  }
  for (const s of Object.values(byPlugin)) delete s._totalDuration;

  return { total, errors, byPlugin };
}
