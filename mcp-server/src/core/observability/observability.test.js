/**
 * Observability Test Suite
 *
 * Tests for the observability infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MetricsRegistry,
  createMetricsRegistry,
  getMetricsRegistry,
  setMetricsRegistry,
  Metrics,
  MetricType,
} from "./metrics.js";
import {
  generateCorrelationId,
  generateSpanId,
  generateTraceId,
  extractTraceContext,
  createChildContext,
  contextToHeaders,
  withTraceContext,
  getCurrentTraceContext,
  isValidTraceContext,
  formatTraceContext,
} from "./tracing.js";
import {
  getRuntimeStats,
  getProcessStats,
  getMemoryStats,
  getCPUStats,
  formatBytes,
} from "./runtime.stats.js";
import {
  ObservabilityManager,
  createObservabilityManager,
  getObservabilityManager,
  setObservabilityManager,
} from "./observability.manager.js";

describe("Observability", () => {
  describe("Metrics", () => {
    let registry;

    beforeEach(() => {
      registry = createMetricsRegistry();
    });

    it("should create a counter", () => {
      const counter = registry.counter("test_counter", "Test counter");
      expect(counter.type).toBe(MetricType.COUNTER);
      expect(counter.name).toBe("test_counter");
    });

    it("should increment a counter", () => {
      registry.increment("requests_total", 1, { plugin: "test" });
      registry.increment("requests_total", 2, { plugin: "test" });

      expect(registry.get("requests_total", { plugin: "test" })).toBe(3);
    });

    it("should set a gauge", () => {
      registry.set("jobs_running", 5);
      expect(registry.get("jobs_running")).toBe(5);

      registry.set("jobs_running", 3);
      expect(registry.get("jobs_running")).toBe(3);
    });

    it("should observe histogram values", () => {
      registry.observe("request_duration_ms", 50);
      registry.observe("request_duration_ms", 150);
      registry.observe("request_duration_ms", 250);

      const metric = registry.metrics.get("request_duration_ms");
      expect(metric.count).toBe(3);
      expect(metric.sum).toBe(450);
    });

    it("should update histogram buckets", () => {
      registry.observe("request_duration_ms", 75);
      const metric = registry.metrics.get("request_duration_ms");

      expect(metric.buckets.get(100)).toBe(1);
      expect(metric.buckets.get(50)).toBe(0);
    });

    it("should get metric snapshot", () => {
      registry.increment("counter1");
      registry.set("gauge1", 42);
      registry.observe("hist1", 100);

      const snapshot = registry.snapshot();

      expect(snapshot.counters).toBeDefined();
      expect(snapshot.gauges).toBeDefined();
      expect(snapshot.histograms).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();
    });

    it("should get metric names", () => {
      registry.increment("metric1");
      registry.increment("metric2");

      const names = registry.getNames();
      expect(names).toContain("metric1");
      expect(names).toContain("metric2");
    });

    it("should clear all metrics", () => {
      registry.increment("test");
      expect(registry.get("test")).toBe(1);

      registry.clear();
      expect(registry.get("test")).toBeNull();
    });

    it("should throw on wrong metric type operations", () => {
      registry.set("gauge", 1);

      expect(() => registry.increment("gauge")).toThrow();
    });

    it("should use global registry", () => {
      setMetricsRegistry(null);

      const reg1 = getMetricsRegistry();
      const reg2 = getMetricsRegistry();

      expect(reg1).toBe(reg2);
    });

    it("should handle labels correctly", () => {
      registry.increment("requests", 1, { plugin: "a", status: "200" });
      registry.increment("requests", 1, { plugin: "b", status: "200" });

      expect(registry.get("requests", { plugin: "a", status: "200" })).toBe(1);
      expect(registry.get("requests", { plugin: "b", status: "200" })).toBe(1);
    });
  });

  describe("Tracing", () => {
    it("should generate correlation ID", () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^corr_[a-z0-9]+_[a-z0-9]+$/);
    });

    it("should generate span ID", () => {
      const id = generateSpanId();
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[a-f0-9]+$/);
    });

    it("should generate trace ID", () => {
      const id = generateTraceId();
      expect(id).toHaveLength(32);
      expect(id).toMatch(/^[a-f0-9]+$/);
    });

    it("should extract trace context from headers", () => {
      const req = {
        headers: {
          "x-correlation-id": "corr_test",
          "x-trace-id": "trace_test",
          "x-span-id": "span_test",
        },
      };

      const ctx = extractTraceContext(req);

      expect(ctx.correlationId).toBe("corr_test");
      expect(ctx.traceId).toBe("trace_test");
      expect(ctx.spanId).toBe("span_test");
    });

    it("should generate new correlation ID if not present", () => {
      const req = { headers: {} };
      const ctx = extractTraceContext(req);

      expect(ctx.correlationId).toMatch(/^corr_/);
    });

    it("should parse baggage from headers", () => {
      const req = {
        headers: {
          "x-correlation-id": "test",
          "x-baggage": JSON.stringify({ user: "admin" }),
        },
      };

      const ctx = extractTraceContext(req);

      expect(ctx.baggage.user).toBe("admin");
    });

    it("should create child context", () => {
      const parent = {
        correlationId: "corr_parent",
        traceId: "trace_parent",
        spanId: "span_parent",
        parentSpanId: null,
        baggage: { key: "value" },
      };

      const child = createChildContext(parent);

      expect(child.correlationId).toBe("corr_parent");
      expect(child.traceId).toBe("trace_parent");
      expect(child.parentSpanId).toBe("span_parent");
      expect(child.spanId).not.toBe("span_parent");
      expect(child.baggage.key).toBe("value");
    });

    it("should convert context to headers", () => {
      const ctx = {
        correlationId: "corr_test",
        traceId: "trace_test",
        spanId: "span_test",
        baggage: { user: "admin" },
      };

      const headers = contextToHeaders(ctx);

      expect(headers["x-correlation-id"]).toBe("corr_test");
      expect(headers["x-trace-id"]).toBe("trace_test");
      expect(headers["x-span-id"]).toBe("span_test");
    });

    it("should run function with trace context", () => {
      const ctx = { correlationId: "test", traceId: "test", spanId: "test", baggage: {} };

      const result = withTraceContext(ctx, () => {
        return getCurrentTraceContext();
      });

      expect(result.correlationId).toBe("test");
    });

    it("should validate trace context", () => {
      expect(isValidTraceContext({ correlationId: "test" })).toBe(true);
      expect(isValidTraceContext(null)).toBe(false);
      expect(isValidTraceContext({})).toBe(false);
    });

    it("should format trace context", () => {
      const ctx = {
        correlationId: "corr_12345678901234567890",
        traceId: "trace_12345678901234567890",
        spanId: "span1234",
      };

      const formatted = formatTraceContext(ctx);

      expect(formatted).toContain("corr=");
      expect(formatted).toContain("trace=");
      expect(formatted).toContain("span=");
    });
  });

  describe("Runtime Stats", () => {
    it("should get process stats", () => {
      const stats = getProcessStats();

      expect(stats.pid).toBeDefined();
      expect(stats.platform).toBeDefined();
      expect(stats.arch).toBeDefined();
      expect(stats.nodeVersion).toBeDefined();
    });

    it("should get memory stats", () => {
      const stats = getMemoryStats();

      expect(stats.rss).toBeDefined();
      expect(stats.heapTotal).toBeDefined();
      expect(stats.heapUsed).toBeDefined();
      expect(stats.rssBytes).toBeGreaterThan(0);
    });

    it("should get CPU stats if available", () => {
      const stats = getCPUStats();

      if (stats) {
        expect(stats.user).toBeDefined();
        expect(stats.system).toBeDefined();
      }
    });

    it("should get runtime stats", () => {
      const stats = getRuntimeStats();

      expect(stats.timestamp).toBeDefined();
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
      expect(stats.nodeVersion).toBeDefined();
      expect(stats.memory).toBeDefined();
    });

    it("should format bytes correctly", () => {
      // Helper function test via getMemoryStats
      const stats = getMemoryStats();
      expect(stats.rss).toMatch(/\d+\.?\d*\s(B|KB|MB|GB)/);
    });
  });

  describe("Observability Manager", () => {
    let manager;

    beforeEach(() => {
      manager = createObservabilityManager();
      manager.init();
    });

    it("should initialize", () => {
      expect(manager.initialized).toBe(true);
    });

    it("should increment counter", () => {
      manager.incrementCounter("test", 5);
      expect(manager.metrics.get("test")).toBe(5);
    });

    it("should set gauge", () => {
      manager.setGauge("gauge", 42);
      expect(manager.metrics.get("gauge")).toBe(42);
    });

    it("should observe duration", () => {
      manager.observeDuration("duration", 100);
      const metric = manager.metrics.metrics.get("duration");
      expect(metric.count).toBe(1);
      expect(metric.sum).toBe(100);
    });

    it("should get metrics snapshot", () => {
      manager.incrementCounter("c1");
      manager.setGauge("g1", 1);

      const snapshot = manager.getMetricsSnapshot();

      expect(snapshot.counters).toBeDefined();
      expect(snapshot.gauges).toBeDefined();
    });

    it("should generate correlation ID", () => {
      const id = manager.generateCorrelationId();
      expect(id).toMatch(/^corr_/);
    });

    it("should extract trace context", () => {
      const req = { headers: { "x-correlation-id": "test" } };
      const ctx = manager.extractTraceContext(req);
      expect(ctx.correlationId).toBe("test");
    });

    it("should get runtime snapshot", () => {
      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.uptime).toBeDefined();
    });

    it("should export metrics as JSON", () => {
      manager.incrementCounter("test");
      const json = manager.exportMetricsJSON();

      expect(json.counters).toBeDefined();
      expect(json.gauges).toBeDefined();
      expect(json.histograms).toBeDefined();
    });

    it("should export metrics as Prometheus format", () => {
      manager.incrementCounter("requests_total", 10);
      manager.setGauge("active_users", 5);

      const prom = manager.exportMetricsPrometheus();

      expect(prom).toContain("# TYPE mcp_hub_requests_total counter");
      expect(prom).toContain("mcp_hub_requests_total");
      expect(prom).toContain("# TYPE mcp_hub_active_users gauge");
    });

    it("should use global manager", () => {
      setObservabilityManager(null);

      const mgr1 = getObservabilityManager();
      const mgr2 = getObservabilityManager();

      expect(mgr1).toBe(mgr2);
    });
  });

  describe("Metrics Constants", () => {
    it("should have defined metric names", () => {
      expect(Metrics.REQUESTS_TOTAL).toBe("requests_total");
      expect(Metrics.PLUGIN_CALLS_TOTAL).toBe("plugin_calls_total");
      expect(Metrics.JOB_EVENTS_TOTAL).toBe("job_events_total");
      expect(Metrics.TOOL_CALLS_TOTAL).toBe("tool_calls_total");
      expect(Metrics.ERRORS_TOTAL).toBe("errors_total");
      expect(Metrics.JOBS_RUNNING).toBe("jobs_running");
      expect(Metrics.JOBS_QUEUED).toBe("jobs_queued");
      expect(Metrics.PLUGINS_ENABLED).toBe("plugins_enabled");
      expect(Metrics.TOOLS_TOTAL).toBe("tools_total");
    });
  });
});
