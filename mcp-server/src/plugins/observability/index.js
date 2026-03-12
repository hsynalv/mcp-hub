import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { requireScope } from "../../core/auth.js";
import { getLogs, getStats } from "../../core/audit.js";
import { getPlugins } from "../../core/plugins.js";
import { getHealthService, HealthStatus } from "../../core/health/index.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const metadata = createMetadata({
  name:        "observability",
  version:     "1.0.0",
  description: "Aggregate health, Prometheus metrics, error surfacing, and runtime dashboard for all plugins.",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.LOW,
  capabilities: ["read"],
  requires:    [],
  tags:        ["observability", "health", "metrics", "monitoring"],
  endpoints: [
    { method: "GET", path: "/observability/health",              description: "Aggregate health of all plugins",  scope: "read" },
    { method: "GET", path: "/observability/health/detailed",     description: "Detailed health with dependencies", scope: "read" },
    { method: "GET", path: "/observability/metrics",             description: "Prometheus-format metrics",         scope: "read" },
    { method: "GET", path: "/observability/errors",              description: "Recent errors from audit log",      scope: "read" },
    { method: "GET", path: "/observability/dashboard",           description: "Web dashboard",                     scope: "read" },
    { method: "GET", path: "/observability/dashboard/app.js",    description: "Dashboard JS",                      scope: "read" },
    { method: "GET", path: "/observability/dashboard/styles.css",description: "Dashboard CSS",                     scope: "read" },
  ],
  notes: "Prometheus metrics available at /observability/metrics. Sentry optional via SENTRY_DSN env.",
});

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
   * GET /observability/dashboard — static HTML (no auth so page loads; API calls from page use Bearer)
   */
  router.get("/dashboard", (_req, res) => {
    const dashboardPath = join(__dirname, "dashboard", "index.html");
    if (!existsSync(dashboardPath)) {
      return res.status(404).json({ ok: false, error: "Dashboard not found" });
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(dashboardPath);
  });

  router.get("/dashboard/styles.css", (_req, res) => {
    const cssPath = join(__dirname, "dashboard", "styles.css");
    if (!existsSync(cssPath)) {
      return res.status(404).json({ ok: false, error: "CSS not found" });
    }
    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(cssPath);
  });

  router.get("/dashboard/app.js", (_req, res) => {
    const jsPath = join(__dirname, "dashboard", "app.js");
    if (!existsSync(jsPath)) {
      return res.status(404).json({ ok: false, error: "JS not found" });
    }
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-store");
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

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "observability_health",
    description: "Get aggregate health status of all loaded plugins including uptime, memory, and per-plugin error stats.",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const plugins = getPlugins();
        const stats   = getStats();
        const uptime  = Math.floor(process.uptime());
        const mem     = process.memoryUsage();

        const pluginHealth = plugins.map((p) => {
          const ps = stats.byPlugin?.[p.name] ?? {};
          return { name: p.name, version: p.version, calls: ps.total ?? 0, errors: ps.errors ?? 0 };
        });

        return {
          ok: true,
          data: {
            status:  pluginHealth.some((p) => p.errors > 0) ? "degraded" : "healthy",
            uptime:  { seconds: uptime, human: formatUptime(uptime) },
            memory:  {
              heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024 * 10) / 10,
              heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
              rssMb:       Math.round(mem.rss       / 1024 / 1024 * 10) / 10,
            },
            plugins: pluginHealth,
            audit: {
              totalCalls:  stats.total  ?? 0,
              totalErrors: stats.errors ?? 0,
              errorRate:   stats.total ? Math.round((stats.errors / stats.total) * 100) : 0,
            },
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "health_failed", message: err.message } };
      }
    },
  },

  {
    name: "observability_metrics",
    description: "Get current runtime metrics: request counts, error counts, memory usage, uptime — per plugin.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        plugin: { type: "string", description: "Filter metrics to a specific plugin (optional)" },
      },
    },
    handler: async (args) => {
      try {
        const stats   = getStats();
        const plugins = getPlugins();
        const uptime  = Math.floor(process.uptime());
        const mem     = process.memoryUsage();

        const filtered = args.plugin
          ? plugins.filter((p) => p.name === args.plugin)
          : plugins;

        return {
          ok: true,
          data: {
            uptime:      { seconds: uptime, human: formatUptime(uptime) },
            memory:      { heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10, rssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10 },
            totalCalls:  stats.total  ?? 0,
            totalErrors: stats.errors ?? 0,
            plugins:     filtered.map((p) => {
              const ps = stats.byPlugin?.[p.name] ?? {};
              return { name: p.name, calls: ps.total ?? 0, errors: ps.errors ?? 0 };
            }),
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "metrics_failed", message: err.message } };
      }
    },
  },

  {
    name: "observability_errors",
    description: "Get recent errors from the audit log. Useful for diagnosing what went wrong across plugins.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        limit:  { type: "number", description: "Max errors to return (default 20, max 100)", default: 20 },
        plugin: { type: "string", description: "Filter errors to a specific plugin (optional)" },
      },
    },
    handler: async (args) => {
      try {
        const limit   = Math.min(args.limit || 20, 100);
        const allLogs = getLogs({ limit: limit * 2, plugin: args.plugin });
        const errors  = allLogs
          .filter((e) => e.status === "client_error" || e.status === "server_error")
          .slice(0, limit);
        return { ok: true, data: { count: errors.length, errors } };
      } catch (err) {
        return { ok: false, error: { code: "errors_failed", message: err.message } };
      }
    },
  },
];
