/**
 * File Audit Sink
 *
 * Append-only JSONL file storage with rotation support.
 * Persistent and suitable for production deployments.
 */

import { AuditSink } from "../sink.interface.js";
import { appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";

/**
 * @typedef {import("../../audit.standard.js").AuditEvent} AuditEvent
 */

export class FileAuditSink extends AuditSink {
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB default
    this.rotateOnSize = options.rotateOnSize !== false;
    this.maxFiles = options.maxFiles || 5;
    this.buffer = [];
    this.bufferSize = options.bufferSize || 10;
    this.flushInterval = options.flushInterval || 1000;
    this.flushTimer = null;
    this.failedWrites = 0;

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Start flush interval
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  /**
   * Write an audit event
   * @param {AuditEvent} entry
   */
  async write(entry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  /**
   * Flush buffer to file
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      // Check rotation
      if (this.rotateOnSize && existsSync(this.filePath)) {
        const stats = await this._getFileStats();
        if (stats.size > this.maxFileSize) {
          await this.rotate();
        }
      }

      // Write to file
      const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
      appendFileSync(this.filePath, lines);
    } catch (err) {
      console.error(`[audit-file] Failed to write to ${this.filePath}:`, err.message);
      this.failedWrites++;
      // Don't re-add to buffer - we don't want to block or lose more data
      // Just log the failure and continue
    }
  }

  /**
   * Rotate files
   */
  async rotate() {
    try {
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldPath = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
        const newPath = `${this.filePath}.${i}`;
        if (existsSync(oldPath)) {
          if (existsSync(newPath)) {
            unlinkSync(newPath);
          }
          renameSync(oldPath, newPath);
        }
      }
    } catch (err) {
      console.error(`[audit-file] Rotation failed:`, err.message);
    }
  }

  /**
   * Get file stats (async wrapper)
   */
  _getFileStats() {
    return import("fs/promises").then(fs => fs.stat(this.filePath));
  }

  /**
   * Read audit events (newest first)
   * @param {number} limit
   * @param {number} offset
   * @param {Object} filters
   */
  async read(limit = 100, offset = 0, filters = {}) {
    await this.flush();

    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(this.filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Parse all entries (newest last in file)
      const entries = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Apply filters
          if (filters.plugin && entry.plugin !== filters.plugin) continue;
          if (filters.operation && entry.operation !== filters.operation) continue;
          if (filters.workspaceId && entry.workspaceId !== filters.workspaceId) continue;
          if (filters.allowed !== undefined && entry.allowed !== filters.allowed) continue;
          if (filters.success !== undefined && entry.success !== filters.success) continue;
          entries.push(entry);
        } catch {
          // Skip corrupted lines
        }
      }

      // Reverse to get newest first, then apply offset/limit
      return entries.reverse().slice(offset, offset + limit);
    } catch (err) {
      console.error(`[audit-file] Failed to read from ${this.filePath}:`, err.message);
      return [];
    }
  }

  /**
   * Get statistics
   */
  async stats() {
    await this.flush();

    let count = 0;
    const byPlugin = {};
    let allowed = 0;
    let denied = 0;

    try {
      const entries = await this.read(10000, 0);
      count = entries.length;
      for (const entry of entries) {
        byPlugin[entry.plugin] = (byPlugin[entry.plugin] || 0) + 1;
        if (entry.allowed) allowed++; else denied++;
      }
    } catch (err) {
      // Ignore
    }

    return {
      count,
      byPlugin,
      allowed,
      denied,
      filePath: this.filePath,
      failedWrites: this.failedWrites,
    };
  }

  /**
   * Close the sink
   */
  async close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
