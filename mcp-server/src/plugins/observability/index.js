import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { requireScope } from "../../core/auth.js";
import { getLogs, getStats } from "../../core/audit.js";
import { getPlugins } from "../../core/plugins.js";
import { getJobStats } from "../../core/jobs.js";
import { getHealthService, HealthStatus } from "../../core/health/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const name = "observability";
export const version = "1.0.0";
export const description = "Health aggregation, Prometheus metrics, and error log surfacing";
export const capabilities = ["read"];
export const requires = [];
export const endpoints = [
  { method: "GET", path: "/observability/health",  description: "Aggregate health of all plugins", scope: "read" },
  { method: "GET", path: "/observability/health/detailed", description: "Detailed health with dependencies", scope: "read" },
  { method: "GET", path: "/observability/metrics", description: "Prometheus-format metrics",        scope: "read" },
  { method: "GET", path: "/observability/errors",  description: "Recent errors from audit log",     scope: "read" },
  { method: "GET", path: "/observability/dashboard", description: "Web dashboard for monitoring",    scope: "read" },
  { method: "GET", path: "/observability/dashboard/app.js", description: "Dashboard JS (static)",       scope: "read" },
  { method: "GET", path: "/observability/dashboard/styles.css", description: "Dashboard CSS (static)",  scope: "read" },
];
export const examples = [
  "GET /observability/health",
  "GET /observability/health/detailed",
  "GET /observability/metrics",
  "GET /observability/errors?limit=20",
  "GET /observability/dashboard",
];

// Optional Sentry integration
let sentryInitialized = false;
async function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || sentryInitialized) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
    sentryInitialized = true;
    console.log("[observability] Sentry initialized");
  } catch {
    // @sentry/node not installed — skip silently
  }
}

export function register(app) {
  // Try to init Sentry at startup
  initSentry();

  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /observability/health
   * Aggregates health status across all loaded plugins.
   */
  router.get("/health", requireScope("read"), (req, res) => {
    const plugins = getPlugins();
    const stats   = getStats();
    const uptime  = Math.floor(process.uptime());
    const mem     = process.memoryUsage();

    const pluginHealth = plugins.map((p) => {
      const pluginStats = stats.byPlugin?.[p.name] ?? {};
      return {
        name:    p.name,
        version: p.version,
        status:  "loaded",
        calls:   pluginStats.total ?? 0,
        errors:  pluginStats.errors ?? 0,
      };
    });

    const anyErrors = pluginHealth.some((p) => p.errors > 0);

    res.json({
      ok:     true,
      status: anyErrors ? "degraded" : "healthy",
      uptime: { seconds: uptime, human: formatUptime(uptime) },
      memory: {
        heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024 * 10) / 10,
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        rssMb:       Math.round(mem.rss       / 1024 / 1024 * 10) / 10,
      },
      plugins: pluginHealth,
      audit: {
        totalCalls:    stats.total ?? 0,
        totalErrors:   stats.errors ?? 0,
        errorRate:     stats.total ? Math.round((stats.errors / stats.total) * 100) : 0,
      },
    });
  });

  /**
   * GET /observability/health/detailed
   * Detailed health check with dependencies using centralized health service.
   */
  router.get("/health/detailed", requireScope("read"), async (req, res) => {
    const healthService = getHealthService();
    const forceRefresh = req.query.refresh === "true";

    // If health service has no plugins registered, register them
    const plugins = getPlugins();
    if (healthService.getStatus().pluginsRegistered === 0) {
      for (const plugin of plugins) {
        // Check if plugin has a health check function
        const pluginModule = await import(
          `../../plugins/${plugin.name}/index.js`
        ).catch(() => null);

        if (pluginModule?.health) {
          healthService.registerPlugin(
            plugin.name,
            pluginModule.health,
            { version: plugin.version },
            plugin.requires || []
          );
        } else {
          // Register with default health check
          healthService.registerPlugin(
            plugin.name,
            async () => ({ status: HealthStatus.HEALTHY }),
            { version: plugin.version },
            plugin.requires || []
          );
        }
      }
    }

    // Run health checks if requested or if no recent data
    let health;
    if (forceRefresh || healthService.getStatus().historySize === 0) {
      health = await healthService.runChecks();
    } else {
      health = healthService.getCurrentHealth();
    }

    res.json({
      ok: true,
      status: health.status,
      timestamp: new Date(health.timestamp).toISOString(),
      summary: health.summary,
      plugins: health.plugins.map(p => ({
        name: p.name,
        version: p.version,
        status: p.status,
        lastCheck: p.lastCheck ? new Date(p.lastCheck).toISOString() : null,
        responseTime: p.responseTime,
        message: p.message,
        consecutiveFailures: p.consecutiveFailures,
        dependencies: p.dependencies,
        enabled: p.enabled,
      })),
      dependencies: healthService.getDependencyGraph().dependencies,
    });
  });

  /**
   * GET /observability/metrics
   * Prometheus-compatible text format metrics.
   */
  router.get("/metrics", requireScope("read"), (_req, res) => {
    const stats   = getStats();
    const plugins = getPlugins();
    const uptime  = Math.floor(process.uptime());
    const mem     = process.memoryUsage();

    const lines = [
      "# HELP mcp_hub_uptime_seconds Server uptime in seconds",
      "# TYPE mcp_hub_uptime_seconds gauge",
      `mcp_hub_uptime_seconds ${uptime}`,

      "# HELP mcp_hub_memory_heap_used_bytes Heap memory used",
      "# TYPE mcp_hub_memory_heap_used_bytes gauge",
      `mcp_hub_memory_heap_used_bytes ${mem.heapUsed}`,

      "# HELP mcp_hub_memory_rss_bytes RSS memory",
      "# TYPE mcp_hub_memory_rss_bytes gauge",
      `mcp_hub_memory_rss_bytes ${mem.rss}`,

      "# HELP mcp_hub_requests_total Total HTTP requests",
      "# TYPE mcp_hub_requests_total counter",
      `mcp_hub_requests_total ${stats.total ?? 0}`,

      "# HELP mcp_hub_errors_total Total errors",
      "# TYPE mcp_hub_errors_total counter",
      `mcp_hub_errors_total ${stats.errors ?? 0}`,

      "# HELP mcp_hub_plugins_loaded Number of loaded plugins",
      "# TYPE mcp_hub_plugins_loaded gauge",
      `mcp_hub_plugins_loaded ${plugins.length}`,
    ];

    // Per-plugin counters
    lines.push(
      "# HELP mcp_hub_plugin_requests_total Requests per plugin",
      "# TYPE mcp_hub_plugin_requests_total counter"
    );
    for (const p of plugins) {
      const ps = stats.byPlugin?.[p.name] ?? {};
      lines.push(`mcp_hub_plugin_requests_total{plugin="${p.name}"} ${ps.total ?? 0}`);
    }

    lines.push(
      "# HELP mcp_hub_plugin_errors_total Errors per plugin",
      "# TYPE mcp_hub_plugin_errors_total counter"
    );
    for (const p of plugins) {
      const ps = stats.byPlugin?.[p.name] ?? {};
      lines.push(`mcp_hub_plugin_errors_total{plugin="${p.name}"} ${ps.errors ?? 0}`);
    }

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  });

  /**
   * GET /observability/dashboard
   * Web-based monitoring dashboard
   */
  router.get("/dashboard", requireScope("read"), (_req, res) => {
    const dashboardPath = join(__dirname, "dashboard", "index.html");
    if (!existsSync(dashboardPath)) {
      return res.status(404).json({ ok: false, error: "Dashboard not found" });
    }
    res.sendFile(dashboardPath);
  });

  router.get("/dashboard/styles.css", requireScope("read"), (_req, res) => {
    const cssPath = join(__dirname, "dashboard", "styles.css");
    if (!existsSync(cssPath)) {
      return res.status(404).json({ ok: false, error: "CSS not found" });
    }
    res.setHeader("Content-Type", "text/css");
    res.sendFile(cssPath);
  });

  router.get("/dashboard/app.js", requireScope("read"), (_req, res) => {
    const jsPath = join(__dirname, "dashboard", "app.js");
    if (!existsSync(jsPath)) {
      return res.status(404).json({ ok: false, error: "JS not found" });
    }
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(jsPath);
  });

  /**
   * GET /observability/errors
   * Recent errors from the audit log (client_error + server_error).
   * Query: ?limit=N (default 20), ?plugin=name
   */
  router.get("/errors", requireScope("read"), (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
    const plugin = req.query.plugin;

    const allLogs = getLogs({ limit: limit * 2, plugin });
    const errors = allLogs.filter((e) => e.status === "client_error" || e.status === "server_error").slice(0, limit);

    res.json({
      ok:    true,
      count: errors.length,
      errors,
    });
  });

  app.use("/observability", router);
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}
