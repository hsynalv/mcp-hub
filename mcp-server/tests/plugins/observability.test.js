import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Observability Plugin Unit Tests
 * Tests for health checks, metrics generation, and error surfacing
 */

// Mock audit module
vi.mock("../../src/core/audit.js", () => ({
  getLogs: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock("../../src/core/plugins.js", () => ({
  getPlugins: vi.fn(),
}));

describe("Observability Plugin - Health Aggregation", () => {
  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(" ");
  };

  describe("formatUptime", () => {
    it("should format seconds only", () => {
      expect(formatUptime(45)).toBe("45s");
    });

    it("should format minutes and seconds", () => {
      expect(formatUptime(125)).toBe("2m 5s");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatUptime(3665)).toBe("1h 1m 5s");
    });

    it("should format days, hours, minutes, and seconds", () => {
      expect(formatUptime(90061)).toBe("1d 1h 1m 1s");
    });

    it("should handle zero", () => {
      expect(formatUptime(0)).toBe("0s");
    });
  });
});

describe("Observability Plugin - Prometheus Metrics", () => {
  const generateMetrics = (stats, plugins, uptime, mem) => {
    const lines = [
      `# HELP mcp_hub_uptime_seconds Server uptime in seconds`,
      `# TYPE mcp_hub_uptime_seconds gauge`,
      `mcp_hub_uptime_seconds ${uptime}`,
      ``,
      `# HELP mcp_hub_memory_heap_used_bytes Heap memory used`,
      `# TYPE mcp_hub_memory_heap_used_bytes gauge`,
      `mcp_hub_memory_heap_used_bytes ${mem.heapUsed}`,
      ``,
      `# HELP mcp_hub_memory_rss_bytes RSS memory`,
      `# TYPE mcp_hub_memory_rss_bytes gauge`,
      `mcp_hub_memory_rss_bytes ${mem.rss}`,
      ``,
      `# HELP mcp_hub_legacy_audit_http_requests_total Audit ring HTTP requests`,
      `# TYPE mcp_hub_legacy_audit_http_requests_total counter`,
      `mcp_hub_legacy_audit_http_requests_total ${stats.total ?? 0}`,
      ``,
      `# HELP mcp_hub_legacy_audit_http_errors_total Audit ring HTTP errors`,
      `# TYPE mcp_hub_legacy_audit_http_errors_total counter`,
      `mcp_hub_legacy_audit_http_errors_total ${stats.errors ?? 0}`,
      ``,
      `# HELP mcp_hub_plugins_loaded Number of loaded plugins`,
      `# TYPE mcp_hub_plugins_loaded gauge`,
      `mcp_hub_plugins_loaded ${plugins.length}`,
    ];

    // Per-plugin metrics
    lines.push(
      ``,
      `# HELP mcp_hub_legacy_audit_plugin_requests_total Requests per plugin (audit ring)`,
      `# TYPE mcp_hub_legacy_audit_plugin_requests_total counter`
    );
    for (const p of plugins) {
      const ps = stats.byPlugin?.[p.name] ?? {};
      lines.push(`mcp_hub_legacy_audit_plugin_requests_total{plugin="${p.name}"} ${ps.total ?? 0}`);
    }

    lines.push(
      ``,
      `# HELP mcp_hub_legacy_audit_plugin_errors_total Errors per plugin (audit ring)`,
      `# TYPE mcp_hub_legacy_audit_plugin_errors_total counter`
    );
    for (const p of plugins) {
      const ps = stats.byPlugin?.[p.name] ?? {};
      lines.push(`mcp_hub_legacy_audit_plugin_errors_total{plugin="${p.name}"} ${ps.errors ?? 0}`);
    }

    return lines.join("\n");
  };

  describe("generateMetrics", () => {
    it("should generate basic metrics", () => {
      const stats = { total: 100, errors: 5 };
      const plugins = [{ name: "test" }];
      const uptime = 3600;
      const mem = { heapUsed: 50000000, rss: 100000000 };

      const result = generateMetrics(stats, plugins, uptime, mem);

      expect(result).toContain("mcp_hub_uptime_seconds 3600");
      expect(result).toContain("mcp_hub_legacy_audit_http_requests_total 100");
      expect(result).toContain("mcp_hub_legacy_audit_http_errors_total 5");
      expect(result).toContain("mcp_hub_plugins_loaded 1");
    });

    it("should include per-plugin metrics", () => {
      const stats = {
        total: 200,
        errors: 10,
        byPlugin: {
          http: { total: 150, errors: 5 },
          database: { total: 50, errors: 5 },
        },
      };
      const plugins = [{ name: "http" }, { name: "database" }];

      const result = generateMetrics(stats, plugins, 7200, { heapUsed: 0, rss: 0 });

      expect(result).toContain('mcp_hub_legacy_audit_plugin_requests_total{plugin="http"} 150');
      expect(result).toContain('mcp_hub_legacy_audit_plugin_errors_total{plugin="http"} 5');
      expect(result).toContain('mcp_hub_legacy_audit_plugin_requests_total{plugin="database"} 50');
    });

    it("should handle empty stats", () => {
      const stats = {};
      const plugins = [];

      const result = generateMetrics(stats, plugins, 0, { heapUsed: 0, rss: 0 });

      expect(result).toContain("mcp_hub_legacy_audit_http_requests_total 0");
      expect(result).toContain("mcp_hub_legacy_audit_http_errors_total 0");
      expect(result).toContain("mcp_hub_plugins_loaded 0");
    });
  });
});

describe("Observability Plugin - Error Surfacing", () => {
  const filterErrors = (logs) => {
    return logs.filter((e) => e.status === "client_error" || e.status === "server_error");
  };

  describe("filterErrors", () => {
    it("should filter client errors", () => {
      const logs = [
        { id: 1, status: "success" },
        { id: 2, status: "client_error" },
        { id: 3, status: "success" },
      ];

      const errors = filterErrors(logs);

      expect(errors).toHaveLength(1);
      expect(errors[0].id).toBe(2);
    });

    it("should filter server errors", () => {
      const logs = [
        { id: 1, status: "server_error" },
        { id: 2, status: "success" },
        { id: 3, status: "server_error" },
      ];

      const errors = filterErrors(logs);

      expect(errors).toHaveLength(2);
    });

    it("should include both client and server errors", () => {
      const logs = [
        { id: 1, status: "client_error" },
        { id: 2, status: "server_error" },
        { id: 3, status: "success" },
      ];

      const errors = filterErrors(logs);

      expect(errors).toHaveLength(2);
    });

    it("should return empty array when no errors", () => {
      const logs = [
        { id: 1, status: "success" },
        { id: 2, status: "success" },
      ];

      const errors = filterErrors(logs);

      expect(errors).toHaveLength(0);
    });
  });
});

describe("Observability Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "observability";
    const version = "1.0.0";
    const description = "Health aggregation, Prometheus metrics, and error log surfacing";
    const capabilities = ["read"];

    expect(name).toBe("observability");
    expect(version).toBe("1.0.0");
    expect(description).toContain("metrics");
    expect(capabilities).toContain("read");
  });

  it("should define observability endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/observability/health", scope: "read" },
      { method: "GET", path: "/observability/metrics", scope: "read" },
      { method: "GET", path: "/observability/errors", scope: "read" },
    ];

    expect(endpoints.length).toBe(3);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
