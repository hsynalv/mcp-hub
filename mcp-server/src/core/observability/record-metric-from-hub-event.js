/**
 * Derive MetricsRegistry counters/histograms from hub audit event types.
 */

import { Metrics, getMetricsRegistry } from "./metrics.js";
import { SECURITY_DENY_EVENT_TYPES, HubEventTypes } from "../audit/event-types.js";

/**
 * @param {string} eventType
 * @param {object} meta
 * @param {string} [meta.outcome]
 * @param {number} [meta.durationMs]
 * @param {string} [meta.toolName]
 * @param {string} [meta.plugin]
 * @param {string} [meta.phase]
 * @param {string} [meta.httpMethod]
 * @param {string} [meta.statusClass]
 * @param {number} [meta.statusCode]
 * @param {string} [meta.discoverySurface]
 * @param {string} [meta.jobType]
 * @param {string} [meta.jobQueue]
 * @param {string} [meta.jobFailureReason]
 * @param {string} [meta.jobCancelSource]
 */
export function recordMetricFromHubEvent(eventType, meta = {}) {
  const registry = getMetricsRegistry();
  const toolName = meta.toolName || "unknown";
  const plugin = meta.plugin || "unknown";
  const durationMs = typeof meta.durationMs === "number" ? meta.durationMs : 0;

  if (eventType === HubEventTypes.TOOL_EXECUTION_STARTED) {
    registry.increment("tool_executions_started_total", 1, {
      tool: toolName,
      plugin,
    });
    return;
  }

  if (eventType === HubEventTypes.TOOL_EXECUTION_COMPLETED) {
    registry.increment(Metrics.TOOL_CALLS_TOTAL, 1, {
      tool: toolName,
      plugin,
      status: "success",
    });
    if (durationMs > 0) {
      registry.observe(Metrics.PLUGIN_EXECUTION_DURATION_MS, durationMs, {
        tool: toolName,
        plugin,
      });
    }
    return;
  }

  if (
    eventType === HubEventTypes.TOOL_EXECUTION_FAILED ||
    eventType === HubEventTypes.TOOL_EXECUTION_TIMED_OUT
  ) {
    registry.increment(Metrics.TOOL_CALLS_TOTAL, 1, {
      tool: toolName,
      plugin,
      status: "error",
    });
    registry.increment(Metrics.ERRORS_TOTAL, 1, {
      type: "tool",
      tool: toolName,
      plugin,
      reason: eventType === HubEventTypes.TOOL_EXECUTION_TIMED_OUT ? "timeout" : "error",
    });
    if (durationMs > 0) {
      registry.observe(Metrics.PLUGIN_EXECUTION_DURATION_MS, durationMs, {
        tool: toolName,
        plugin,
      });
    }
    return;
  }

  if (eventType === HubEventTypes.TOOL_EXECUTION_APPROVAL_REQUIRED) {
    registry.increment(Metrics.TOOL_CALLS_TOTAL, 1, {
      tool: toolName,
      plugin,
      status: "pending",
    });
    return;
  }

  if (SECURITY_DENY_EVENT_TYPES.has(eventType)) {
    registry.increment("security_denials_total", 1, {
      event_type: eventType,
    });
    if (meta.toolName) {
      registry.increment(Metrics.TOOL_CALLS_TOTAL, 1, {
        tool: toolName,
        plugin: meta.plugin || "unknown",
        status: "error",
      });
      registry.increment(Metrics.ERRORS_TOTAL, 1, {
        type: "tool_authz",
        tool: toolName,
        plugin: meta.plugin || "unknown",
      });
    }
    return;
  }

  if (
    eventType === HubEventTypes.DISCOVERY_REQUESTED ||
    eventType === HubEventTypes.DISCOVERY_FILTERED
  ) {
    const surface = meta.discoverySurface || "unknown";
    registry.increment("discovery_events_total", 1, {
      event_type: eventType,
      transport: meta.transport || "unknown",
      surface,
    });
    return;
  }

  if (eventType === HubEventTypes.DISCOVERY_DENIED) {
    registry.increment("discovery_denials_total", 1, {
      surface: meta.discoverySurface || "unknown",
      transport: meta.transport || "unknown",
    });
    return;
  }

  if (
    eventType === HubEventTypes.STDIO_SESSION_STARTED ||
    eventType === HubEventTypes.STDIO_SESSION_ENDED
  ) {
    registry.increment("stdio_session_events_total", 1, {
      event_type: eventType,
    });
    return;
  }

  if (eventType === HubEventTypes.HTTP_REQUEST_RECEIVED) {
    registry.increment("http_request_events_total", 1, {
      event_type: "received",
      method: meta.httpMethod || "unknown",
    });
    return;
  }

  if (eventType === HubEventTypes.HTTP_REQUEST_COMPLETED) {
    registry.increment("http_request_events_total", 1, {
      event_type: "completed",
      method: meta.httpMethod || "unknown",
    });
    const method = meta.httpMethod || "unknown";
    const statusClass = meta.statusClass || "unknown";
    registry.increment("http_requests_total", 1, {
      method,
      status_class: statusClass,
    });
    if (durationMs > 0) {
      registry.observe("http_request_duration_ms", durationMs, {
        method,
        status_class: statusClass,
      });
    }
    return;
  }

  if (
    eventType === HubEventTypes.JOB_SUBMITTED ||
    eventType === HubEventTypes.JOB_STARTED ||
    eventType === HubEventTypes.JOB_COMPLETED ||
    eventType === HubEventTypes.JOB_FAILED ||
    eventType === HubEventTypes.JOB_CANCELLED
  ) {
    const jobType = meta.jobType || "unknown";
    const queue = meta.jobQueue || "unknown";
    const labels = {
      event_type: eventType,
      job_type: jobType,
      queue_backend: queue,
    };
    if (eventType === HubEventTypes.JOB_FAILED) {
      labels.failure_reason = meta.jobFailureReason || "unspecified";
    }
    if (eventType === HubEventTypes.JOB_CANCELLED) {
      labels.cancel_source = meta.jobCancelSource || "unspecified";
    }
    registry.increment("job_lifecycle_events_total", 1, labels);
    const terminalDurations =
      eventType === HubEventTypes.JOB_COMPLETED ||
      eventType === HubEventTypes.JOB_FAILED ||
      eventType === HubEventTypes.JOB_CANCELLED;
    if (terminalDurations && durationMs > 0) {
      const outcome =
        eventType === HubEventTypes.JOB_COMPLETED
          ? "success"
          : eventType === HubEventTypes.JOB_CANCELLED
            ? "cancelled"
            : "failure";
      const obsLabels = {
        job_type: jobType,
        queue_backend: queue,
        outcome,
      };
      if (eventType === HubEventTypes.JOB_FAILED && meta.jobFailureReason) {
        obsLabels.failure_reason = meta.jobFailureReason;
      }
      registry.observe("job_duration_ms", durationMs, obsLabels);
    }
  }
}
