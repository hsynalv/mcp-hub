/**
 * Audit Manager
 *
 * Central audit logging manager for all plugins.
 * Provides a unified interface for audit event emission,
 * sanitization, and routing to configured sinks.
 *
 * Best-effort logging: Sink failures don't block operations.
 */

import {
  sanitizeAuditEvent,
  validateAuditEvent,
  generateCorrelationId,
} from "./audit.standard.js";
import { MemoryAuditSink } from "./sinks/memory.audit.js";
import { FileAuditSink } from "./sinks/file.audit.js";
import { MultiAuditSink } from "./sinks/multi.audit.js";

/**
 * @typedef {import("./audit.standard.js").AuditEvent} AuditEvent
 * @typedef {import("./sink.interface.js").AuditSink} AuditSink
 */

/**
 * AuditManager configuration
 * @typedef {Object} AuditConfig
 * @property {boolean} enabled - Whether audit logging is enabled
 * @property {string[]} sinks - Sink types to use (memory, file)
 * @property {number} memoryMaxEntries - Max entries for memory sink
 * @property {string} filePath - Path for file sink
 * @property {number} fileMaxSizeMB - Max file size before rotation
 * @property {boolean} sanitizeStrict - Strict metadata sanitization
 * @property {string[]} sensitivePatterns - Additional sensitive key patterns
 */

const DEFAULT_CONFIG = {
  enabled: true,
  sinks: ["memory"],
  memoryMaxEntries: 1000,
  filePath: "./data/audit.log",
  fileMaxSizeMB: 50,
  sanitizeStrict: true,
  sensitivePatterns: [],
};

export class AuditManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sink = null;
    this.enabled = this.config.enabled;
    this.emittedCount = 0;
    this.failedCount = 0;
    this.initialized = false;
  }

  /**
   * Initialize the audit manager with configured sinks
   */
  async init() {
    if (!this.enabled) {
      this.initialized = true;
      return;
    }

    const sinks = [];

    for (const sinkType of this.config.sinks) {
      switch (sinkType) {
        case "memory": {
          sinks.push(new MemoryAuditSink({
            maxEntries: this.config.memoryMaxEntries,
          }));
          break;
        }
        case "file": {
          sinks.push(new FileAuditSink(this.config.filePath, {
            maxFileSize: this.config.fileMaxSizeMB * 1024 * 1024,
          }));
          break;
        }
        // Redis and other sinks can be added here
        default: {
          console.warn(`[audit-manager] Unknown sink type: ${sinkType}`);
        }
      }
    }

    if (sinks.length === 0) {
      // Fallback to memory sink if no valid sinks configured
      console.warn("[audit-manager] No valid sinks configured, using memory fallback");
      sinks.push(new MemoryAuditSink({ maxEntries: this.config.memoryMaxEntries }));
    }

    if (sinks.length === 1) {
      this.sink = sinks[0];
    } else {
      this.sink = new MultiAuditSink(sinks);
    }

    this.initialized = true;
    console.log(`[audit-manager] Initialized with ${sinks.length} sink(s): ${this.config.sinks.join(", ")}`);
  }

  /**
   * Emit an audit event
   * Best-effort: Sink failures are logged but don't throw
   *
   * @param {AuditEvent} event - The audit event
   * @returns {Promise<void>}
   */
  async emit(event) {
    if (!this.enabled || !this.initialized) {
      return;
    }

    // Generate correlation ID if not provided
    if (!event.correlationId) {
      event.correlationId = generateCorrelationId();
    }

    // Validate event
    const validationError = validateAuditEvent(event);
    if (validationError) {
      console.error(`[audit-manager] Invalid audit event: ${validationError}`);
      this.failedCount++;
      return;
    }

    // Sanitize event
    const sanitized = sanitizeAuditEvent(event, {
      strict: this.config.sanitizeStrict,
    });

    try {
      await this.sink.write(sanitized);
      this.emittedCount++;
    } catch (err) {
      console.error("[audit-manager] Failed to write audit event:", err.message);
      this.failedCount++;
      // Don't throw - audit logging is best-effort
    }
  }

  /**
   * Convenience method: Create and emit an audit event
   *
   * @param {Object} params - Event parameters
   * @param {string} params.plugin - Plugin name
   * @param {string} params.operation - Operation type
   * @param {string} params.actor - Actor identifier
   * @param {string} params.workspaceId - Workspace ID
   * @param {boolean} params.allowed - Whether operation was allowed
   * @param {boolean} params.success - Whether operation succeeded
   * @param {number} params.durationMs - Duration in milliseconds
   * @param {Object} [params.metadata] - Optional metadata
   * @param {string} [params.correlationId] - Optional correlation ID
   * @param {string} [params.projectId] - Optional project ID
   * @param {string} [params.reason] - Optional denial reason
   * @param {string} [params.error] - Optional error message
   */
  async log(params) {
    const event = {
      timestamp: new Date().toISOString(),
      plugin: params.plugin,
      operation: params.operation,
      actor: params.actor || "anonymous",
      workspaceId: params.workspaceId || "global",
      projectId: params.projectId || null,
      correlationId: params.correlationId || generateCorrelationId(),
      allowed: params.allowed,
      durationMs: params.durationMs || 0,
      success: params.success,
      ...(params.reason && { reason: params.reason }),
      ...(params.error && { error: params.error }),
      ...(params.metadata && { metadata: params.metadata }),
    };

    await this.emit(event);
  }

  /**
   * Get recent audit entries
   *
   * @param {Object} options - Query options
   * @param {number} [options.limit=100] - Max entries to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.plugin] - Filter by plugin
   * @param {string} [options.operation] - Filter by operation
   * @param {string} [options.workspaceId] - Filter by workspace
   * @param {boolean} [options.allowed] - Filter by allowed status
   * @param {boolean} [options.success] - Filter by success status
   * @returns {Promise<AuditEvent[]>}
   */
  async getRecentEntries(options = {}) {
    if (!this.initialized || !this.sink) {
      return [];
    }

    const {
      limit = 100,
      offset = 0,
      plugin,
      operation,
      workspaceId,
      allowed,
      success,
    } = options;

    const filters = {
      ...(plugin && { plugin }),
      ...(operation && { operation }),
      ...(workspaceId && { workspaceId }),
      ...(allowed !== undefined && { allowed }),
      ...(success !== undefined && { success }),
    };

    return await this.sink.read(limit, offset, filters);
  }

  /**
   * Get audit statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    const stats = {
      enabled: this.enabled,
      initialized: this.initialized,
      emittedCount: this.emittedCount,
      failedCount: this.failedCount,
    };

    if (this.sink) {
      try {
        const sinkStats = await this.sink.stats();
        stats.sink = sinkStats;
      } catch (err) {
        stats.sinkError = err.message;
      }
    }

    return stats;
  }

  /**
   * Close the audit manager and all sinks
   */
  async close() {
    if (this.sink) {
      await this.sink.close();
    }
    this.initialized = false;
  }
}

// Global singleton instance
let globalAuditManager = null;

/**
 * Get or create the global audit manager
 * @param {AuditConfig} [config] - Configuration (only used on first call)
 * @returns {AuditManager}
 */
export function getAuditManager(config) {
  if (!globalAuditManager) {
    globalAuditManager = new AuditManager(config);
  }
  return globalAuditManager;
}

/**
 * Initialize the global audit manager
 * @param {AuditConfig} [config]
 * @returns {Promise<AuditManager>}
 */
export async function initAuditManager(config) {
  const manager = getAuditManager(config);
  await manager.init();
  return manager;
}

/**
 * Emit an audit event using the global manager
 * @param {AuditEvent} event
 */
export async function auditEmit(event) {
  const manager = getAuditManager();
  if (!manager.initialized) {
    await manager.init();
  }
  await manager.emit(event);
}

/**
 * Log an audit event using the global manager
 * @param {Object} params
 */
export async function auditLog(params) {
  const manager = getAuditManager();
  if (!manager.initialized) {
    await manager.init();
  }
  await manager.log(params);
}
