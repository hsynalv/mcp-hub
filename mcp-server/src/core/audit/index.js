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
