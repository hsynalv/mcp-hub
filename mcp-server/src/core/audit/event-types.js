/**
 * Hub telemetry / audit event type constants (contract v1).
 */

export const HUB_EVENT_SCHEMA_VERSION = "1";

/** Semantic outcomes for metrics / analytics */
export const HubOutcomes = {
  SUCCESS: "success",
  FAILURE: "failure",
  DENIED: "denied",
  PENDING: "pending",
  UNKNOWN: "unknown",
};

export const HubEventTypes = {
  TOOL_EXECUTION_STARTED: "tool.execution.started",
  TOOL_EXECUTION_COMPLETED: "tool.execution.completed",
  TOOL_EXECUTION_FAILED: "tool.execution.failed",
  TOOL_EXECUTION_TIMED_OUT: "tool.execution.timed_out",
  TOOL_EXECUTION_APPROVAL_REQUIRED: "tool.execution.approval_required",

  AUTH_DENIED: "auth.denied",
  POLICY_DENIED: "policy.denied",
  WORKSPACE_DENIED: "workspace.denied",
  TENANT_DENIED: "tenant.denied",

  DISCOVERY_REQUESTED: "discovery.requested",
  DISCOVERY_FILTERED: "discovery.filtered",
  DISCOVERY_DENIED: "discovery.denied",

  STDIO_SESSION_STARTED: "stdio.session.started",
  STDIO_SESSION_ENDED: "stdio.session.ended",

  HTTP_REQUEST_RECEIVED: "http.request.received",
  HTTP_REQUEST_COMPLETED: "http.request.completed",

  JOB_SUBMITTED: "job.submitted",
  JOB_STARTED: "job.started",
  JOB_COMPLETED: "job.completed",
  JOB_FAILED: "job.failed",
  JOB_CANCELLED: "job.cancelled",
};

/** @type {Set<string>} */
export const SECURITY_DENY_EVENT_TYPES = new Set([
  HubEventTypes.AUTH_DENIED,
  HubEventTypes.POLICY_DENIED,
  HubEventTypes.WORKSPACE_DENIED,
  HubEventTypes.TENANT_DENIED,
]);
