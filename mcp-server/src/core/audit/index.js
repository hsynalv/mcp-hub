/**
 * Core Audit Module
 *
 * Centralized audit logging infrastructure for all plugins.
 *
 * Usage:
 *   import { auditLog, auditEmit, getAuditManager } from "../core/audit/index.js";
 *
 *   await auditLog({
 *     plugin: "shell",
 *     operation: "execute",
 *     actor: "user@example.com",
 *     workspaceId: "ws-1",
 *     allowed: true,
 *     success: true,
 *     durationMs: 150,
 *   });
 */

// Audit standard
export {
  SENSITIVE_PATTERNS,
  METADATA_ALLOWLIST,
  isSensitiveKey,
  sanitizeAuditEvent,
  validateAuditEvent,
  generateCorrelationId,
} from "./audit.standard.js";

// Sink interface
export { AuditSink } from "./sink.interface.js";

// Sink implementations
export { MemoryAuditSink } from "./sinks/memory.audit.js";
export { FileAuditSink } from "./sinks/file.audit.js";
export { MultiAuditSink } from "./sinks/multi.audit.js";

// Audit manager
export {
  AuditManager,
  getAuditManager,
  initAuditManager,
  auditEmit,
  auditLog,
} from "./audit.manager.js";

// Hub telemetry (contract v1)
export {
  emitHubAuditEvent,
  emitDiscoveryFilteredEvent,
  emitDiscoveryRequestedEvent,
} from "./emit-hub-event.js";
export { DiscoverySurfaces } from "./discovery-surfaces.js";
export {
  emitRestDiscoveryRequested,
  emitRestDiscoveryFiltered,
  emitRestDiscoveryDenied,
} from "./emit-discovery-http-event.js";
export { normalizeDiscoveryDeny } from "./normalize-discovery-deny.js";
export { HubEventTypes, HubOutcomes, HUB_EVENT_SCHEMA_VERSION } from "./event-types.js";
export {
  emitJobLifecycleHubEvent,
  pluginFromJobType,
  resolveJobInvokeSource,
  normalizeSubmitJobInvokeSource,
  getHubJobLifecycleEmitFailureCount,
  resetHubJobLifecycleEmitFailuresForTesting,
} from "./emit-job-event.js";
export { hubEventTypeFromAuthzPhase, hubEventTypeFromPermissionOperation } from "./normalize-deny-event.js";
export { normalizeHttpDenyEvent, sanitizePolicyRuleRef } from "./normalize-http-deny.js";
export {
  buildHttpHubMetadata,
  emitHttpRequestReceived,
  emitHttpRequestCompleted,
  emitHttpDenyHubEvent,
  httpHubAuditLifecycleMiddleware,
} from "./emit-http-events.js";
export { resolveActorString, hubMetadataFromToolContext, mergeHubMetadata } from "./base-envelope.js";
export { emitStdioBootstrapAuthDenied } from "./emit-stdio-auth.js";
