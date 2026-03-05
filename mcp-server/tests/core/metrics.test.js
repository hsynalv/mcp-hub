/**
 * Metrics Module Tests
 * Prometheus-style metrics
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Counter,
  Gauge,
  Histogram,
  createCounter,
  createGauge,
  createHistogram,
  getAllMetrics,
  resetMetrics,
  httpRequestsTotal,
} from "../../src/core/metrics.js";

describe("Metrics Module", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("Counter", () => {
    it("should create a counter", () => {
      const counter = new Counter("test_counter", "Test counter", ["method"]);
      expect(counter.name).toBe("test_counter");
      expect(counter.help).toBe("Test counter");
    });

    it("should increment counter", () => {
      const counter = new Counter("inc_test", "Test");
      counter.inc();
      expect(counter.get()).toBe(1);
    });

    it("should increment by custom value", () => {
      const counter = new Counter("inc_custom", "Test");
      counter.inc({}, 5);
      expect(counter.get()).toBe(5);
    });

    it("should increment with labels", () => {
      const counter = new Counter("labeled", "Test", ["method"]);
      counter.inc({ method: "GET" });
      counter.inc({ method: "POST" });
      counter.inc({ method: "GET" });

      expect(counter.get({ method: "GET" })).toBe(2);
      expect(counter.get({ method: "POST" })).toBe(1);
    });

    it("should export to Prometheus format", () => {
      const counter = new Counter("prom_counter", "Help text", ["status"]);
      counter.inc({ status: "200" });
      counter.inc({ status: "404" });

      const output = counter.toPrometheus();
      expect(output).toContain("# HELP prom_counter Help text");
      expect(output).toContain("# TYPE prom_counter counter");
      expect(output).toContain('prom_counter{status="200"} 1');
      expect(output).toContain('prom_counter{status="404"} 1');
    });
  });

  describe("Gauge", () => {
    it("should create a gauge", () => {
      const gauge = new Gauge("test_gauge", "Test gauge");
      expect(gauge.name).toBe("test_gauge");
    });

    it("should set gauge value", () => {
      const gauge = new Gauge("set_test", "Test");
      gauge.set({}, 42);
      expect(gauge.get()).toBe(42);
    });

    it("should increment gauge", () => {
      const gauge = new Gauge("inc_gauge", "Test");
      gauge.set({}, 10);
      gauge.inc({}, 5);
      expect(gauge.get()).toBe(15);
    });

    it("should decrement gauge", () => {
      const gauge = new Gauge("dec_gauge", "Test");
      gauge.set({}, 10);
      gauge.dec({}, 3);
      expect(gauge.get()).toBe(7);
    });
  });

  describe("Histogram", () => {
    it("should create a histogram", () => {
      const hist = new Histogram("test_hist", "Test histogram");
      expect(hist.name).toBe("test_hist");
      expect(hist.buckets).toBeDefined();
    });

    it("should observe values", () => {
      const hist = new Histogram("obs_hist", "Test", [0.1, 0.5, 1, 5]);
      hist.observe({}, 0.3);
      hist.observe({}, 0.8);
      hist.observe({}, 2);

      // Should be properly bucketed
      expect(hist.counts.get("_").count).toBe(3);
      expect(hist.counts.get("_").sum).toBeCloseTo(3.1);
    });

    it("should time synchronous functions", () => {
      const hist = new Histogram("time_hist", "Test");
      const result = hist.time({}, () => "done");

      expect(result).toBe("done");
      expect(hist.counts.get("_").count).toBe(1);
    });

    it("should time async functions", async () => {
      const hist = new Histogram("async_hist", "Test");
      const result = await hist.timeAsync({}, async () => "async done");

      expect(result).toBe("async done");
      expect(hist.counts.get("_").count).toBe(1);
    });

    it("should export histogram to Prometheus format", () => {
      const hist = new Histogram("prom_hist", "Help", [0.1, 1], ["route"]);
      hist.observe({ route: "/api" }, 0.5);

      const output = hist.toPrometheus();
      expect(output).toContain("# HELP prom_hist Help");
      expect(output).toContain("# TYPE prom_hist histogram");
      expect(output).toContain('prom_hist_bucket{route="/api",le="0.1"} 0');
      expect(output).toContain('prom_hist_bucket{route="/api",le="1"} 1');
      expect(output).toContain('prom_hist_bucket{route="/api",le="+Inf"} 1');
      expect(output).toContain('prom_hist_sum{route="/api"} 0.5');
      expect(output).toContain('prom_hist_count{route="/api"} 1');
    });
  });

  describe("Metric Registry", () => {
    it("should create or get counter", () => {
      const c1 = createCounter("reg_counter", "Test");
      const c2 = createCounter("reg_counter", "Test");
      expect(c1).toBe(c2);
    });

    it("should create or get gauge", () => {
      const g1 = createGauge("reg_gauge", "Test");
      const g2 = createGauge("reg_gauge", "Test");
      expect(g1).toBe(g2);
    });

    it("should create or get histogram", () => {
      const h1 = createHistogram("reg_hist", "Test");
      const h2 = createHistogram("reg_hist", "Test");
      expect(h1).toBe(h2);
    });

    it("should get all metrics", () => {
      createCounter("all_counter", "Test");
      createGauge("all_gauge", "Test");

      const output = getAllMetrics();
      expect(output).toContain("all_counter");
      expect(output).toContain("all_gauge");
    });

    it("should reset all metrics", () => {
      createCounter("reset_test", "Test");
      resetMetrics();

      // Creating new metric with same name should create fresh instance
      const c = createCounter("reset_test", "Test");
      expect(c.get()).toBe(0);
    });
  });

  describe("Predefined Metrics", () => {
    it("should have httpRequestsTotal counter", () => {
      expect(httpRequestsTotal).toBeDefined();
      expect(httpRequestsTotal.name).toBe("mcp_http_requests_total");
      
      httpRequestsTotal.inc({ method: "GET", route: "/test", status: 200 });
      expect(httpRequestsTotal.get({ method: "GET", route: "/test", status: 200 })).toBe(1);
    });
  });
});
