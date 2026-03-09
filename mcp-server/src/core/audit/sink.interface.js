/**
 * Audit Sink Interface
 *
 * All audit sinks must implement this interface.
 * Sinks are responsible for persisting audit events.
 */

/**
 * @typedef {import("../audit.standard.js").AuditEvent} AuditEvent
 */

/**
 * Base class for all audit sinks
 */
export class AuditSink {
  /**
   * Write an audit event to the sink
   * @param {AuditEvent} entry - The audit event to write
   * @returns {Promise<void>}
   */
  async write(_entry) {
    throw new Error("write() must be implemented by subclass");
  }

  /**
   * Read audit events from the sink
   * @param {number} limit - Maximum number of entries to read
   * @param {number} offset - Offset for pagination
   * @param {Object} filters - Optional filters (plugin, operation, etc.)
   * @returns {Promise<AuditEvent[]>}
   */
  async read(_limit = 100, _offset = 0, _filters = {}) {
    throw new Error("read() must be implemented by subclass");
  }

  /**
   * Get statistics about stored audit events
   * @returns {Promise<Object>}
   */
  async stats() {
    return { count: 0 };
  }

  /**
   * Close the sink and release resources
   * @returns {Promise<void>}
   */
  async close() {
    // Optional cleanup
  }
}
