/**
 * MetricsRegistry → Prometheus text (hub scrape model).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  exportMetricsRegistryPrometheus,
  getMetricsRegistry,
  setMetricsRegistry,
  createMetricsRegistry,
} from "../../src/core/observability/metrics.js";
import { recordMetricFromHubEvent } from "../../src/core/observability/record-metric-from-hub-event.js";
import { HubEventTypes } from "../../src/core/audit/event-types.js";

describe("exportMetricsRegistryPrometheus", () => {
  beforeEach(() => {
    setMetricsRegistry(createMetricsRegistry());
    getMetricsRegistry().clear();
  });

  it("prefixes families with mcp_hub_", () => {
    const r = getMetricsRegistry();
    r.increment("http_requests_total", 1, { method: "GET", status_class: "2xx" });
    const text = exportMetricsRegistryPrometheus(r);
    expect(text).toContain("# TYPE mcp_hub_http_requests_total counter");
    expect(text).toContain('mcp_hub_http_requests_total{method="GET",status_class="2xx"} 1');
  });

  it("includes hub job lifecycle counter after recordMetricFromHubEvent", () => {
    recordMetricFromHubEvent(HubEventTypes.JOB_SUBMITTED, {
      jobType: "t.x",
      jobQueue: "memory",
    });
    const text = exportMetricsRegistryPrometheus();
    expect(text).toContain("mcp_hub_job_lifecycle_events_total");
    expect(text).toContain("event_type=");
    expect(text).toContain("job_type=");
  });

  it("exports histogram buckets and +Inf", () => {
    const r = getMetricsRegistry();
    r.observe("http_request_duration_ms", 12, { method: "POST", status_class: "2xx" });
    const text = exportMetricsRegistryPrometheus(r);
    expect(text).toContain("# TYPE mcp_hub_http_request_duration_ms histogram");
    expect(text).toContain('le="+Inf"');
    expect(text).toContain("mcp_hub_http_request_duration_ms_sum");
    expect(text).toContain("mcp_hub_http_request_duration_ms_count");
  });
});
