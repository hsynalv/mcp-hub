/**
 * Memory Audit Sink
 *
 * In-memory audit log storage with FIFO eviction.
 * Fast but limited to process lifetime.
 */

import { AuditSink } from "../sink.interface.js";

/**
 * @typedef {import("../../audit.standard.js").AuditEvent} AuditEvent
 */

export class MemoryAuditSink extends AuditSink {
  constructor(options = {}) {
    super();
    this.maxEntries = options.maxEntries || 1000;
    this.entries = [];
    this.plugin = options.plugin || "memory";
  }

  /**
   * Write an audit event
   * @param {AuditEvent} entry
   */
  async write(entry) {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
  }

  /**
   * Read audit events
   * @param {number} limit
   * @param {number} offset
   * @param {Object} filters
   */
  async read(limit = 100, offset = 0, filters = {}) {
    let entries = [...this.entries];

    // Apply filters
    if (filters.plugin) {
      entries = entries.filter(e => e.plugin === filters.plugin);
    }
    if (filters.operation) {
      entries = entries.filter(e => e.operation === filters.operation);
    }
    if (filters.workspaceId) {
      entries = entries.filter(e => e.workspaceId === filters.workspaceId);
    }
    if (filters.allowed !== undefined) {
      entries = entries.filter(e => e.allowed === filters.allowed);
    }
    if (filters.success !== undefined) {
      entries = entries.filter(e => e.success === filters.success);
    }
    if (filters.startTime) {
      entries = entries.filter(e => new Date(e.timestamp) >= new Date(filters.startTime));
    }
    if (filters.endTime) {
      entries = entries.filter(e => new Date(e.timestamp) <= new Date(filters.endTime));
    }

    return entries.slice(offset, offset + limit);
  }

  /**
   * Get statistics
   */
  async stats() {
    const byPlugin = {};
    const byOperation = {};
    let allowed = 0;
    let denied = 0;
    let success = 0;
    let failed = 0;

    for (const entry of this.entries) {
      byPlugin[entry.plugin] = (byPlugin[entry.plugin] || 0) + 1;
      byOperation[entry.operation] = (byOperation[entry.operation] || 0) + 1;
      if (entry.allowed) allowed++; else denied++;
      if (entry.success) success++; else failed++;
    }

    return {
      count: this.entries.length,
      maxEntries: this.maxEntries,
      byPlugin,
      byOperation,
      allowed,
      denied,
      success,
      failed,
    };
  }

  /**
   * Clear all entries
   */
  async clear() {
    this.entries = [];
  }

  /**
   * Close the sink
   */
  async close() {
    await this.clear();
  }

  /**
   * Get current entry count (for testing)
   */
  size() {
    return this.entries.length;
  }
}
