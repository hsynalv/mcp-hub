/**
 * Multi Audit Sink
 *
 * Dispatches audit events to multiple sinks simultaneously.
 * One sink failure doesn't block others.
 */

import { AuditSink } from "../sink.interface.js";

/**
 * @typedef {import("../../audit.standard.js").AuditEvent} AuditEvent
 */

export class MultiAuditSink extends AuditSink {
  constructor(sinks = []) {
    super();
    this.sinks = sinks;
    this.failedSinkIndices = new Set();
  }

  /**
   * Add a sink to the multi-sink
   * @param {AuditSink} sink
   */
  addSink(sink) {
    this.sinks.push(sink);
  }

  /**
   * Write to all sinks
   * @param {AuditEvent} entry
   */
  async write(entry) {
    const results = await Promise.allSettled(
      this.sinks.map((sink, index) =>
        sink.write(entry).catch(err => {
          console.error(`[audit-multi] Sink ${index} failed:`, err.message);
          this.failedSinkIndices.add(index);
          throw err;
        })
      )
    );

    // Log failures but don't throw
    let failures = 0;
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        failures++;
        if (!this.failedSinkIndices.has(i)) {
          console.error(`[audit-multi] Sink ${i} failed:`, result.reason?.message || result.reason);
        }
      }
    });

    if (failures > 0 && failures === this.sinks.length) {
      console.error("[audit-multi] All sinks failed - audit event lost");
    }
  }

  /**
   * Read from first available sink (primary)
   * @param {number} limit
   * @param {number} offset
   * @param {Object} filters
   */
  async read(limit = 100, offset = 0, filters = {}) {
    for (let i = 0; i < this.sinks.length; i++) {
      try {
        return await this.sinks[i].read(limit, offset, filters);
      } catch (err) {
        console.error(`[audit-multi] Sink ${i} read failed:`, err.message);
        continue;
      }
    }
    return [];
  }

  /**
   * Aggregate stats from all sinks
   */
  async stats() {
    const stats = {
      sinkCount: this.sinks.length,
      failedSinks: this.failedSinkIndices.size,
      bySink: [],
    };

    for (let i = 0; i < this.sinks.length; i++) {
      try {
        const sinkStats = await this.sinks[i].stats();
        stats.bySink.push({ index: i, ...sinkStats });
      } catch (err) {
        stats.bySink.push({ index: i, error: err.message });
      }
    }

    return stats;
  }

  /**
   * Close all sinks
   */
  async close() {
    await Promise.allSettled(this.sinks.map(s => s.close()));
  }
}
