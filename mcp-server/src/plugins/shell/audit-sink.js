/**
 * Audit Log Sink Interface
 *
 * Provides pluggable audit log persistence with multiple backend options:
 * - Memory (default, in-process)
 * - File (JSONL append-only)
 * - Redis (optional, if available)
 */

import { promises as fs } from "fs";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

/**
 * Audit entry structure
 * @typedef {Object} AuditEntry
 * @property {string} timestamp - ISO timestamp
 * @property {string} command - Executed command
 * @property {string} cwd - Working directory
 * @property {boolean} allowed - Whether command was allowed
 * @property {string} [reason] - Denial reason if not allowed
 * @property {number} [duration] - Execution duration in ms
 * @property {number} [exitCode] - Process exit code
 * @property {string} [error] - Error message if failed
 * @property {string} correlationId - Unique execution ID
 * @property {string} actor - Who executed the command
 */

/**
 * Audit sink interface
 * All sinks must implement these methods
 */
export class AuditSink {
  async write(_entry) {
    throw new Error("write() must be implemented by subclass");
  }

  async read(_limit = 100, _offset = 0) {
    throw new Error("read() must be implemented by subclass");
  }

  async close() {
    // Optional cleanup
  }
}

/**
 * In-memory audit sink (default)
 * Fast, but limited to process lifetime
 */
export class MemoryAuditSink extends AuditSink {
  constructor(maxEntries = 1000) {
    super();
    this.entries = [];
    this.maxEntries = maxEntries;
  }

  async write(entry) {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
  }

  async read(limit = 100, offset = 0) {
    return this.entries.slice(offset, offset + limit);
  }

  async close() {
    this.entries = [];
  }

  // For testing: get current size
  size() {
    return this.entries.length;
  }
}

/**
 * File-based audit sink (append-only JSONL)
 * Persistent, simple, good for single-instance deployments
 */
export class FileAuditSink extends AuditSink {
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB default
    this.rotateOnSize = options.rotateOnSize !== false; // Rotate by default
    this.maxFiles = options.maxFiles || 5;
    this.buffer = [];
    this.bufferSize = options.bufferSize || 10;
    this.flushInterval = options.flushInterval || 1000;
    
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Start flush interval
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  async write(entry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const lines = this.buffer.map(e => JSON.stringify(e)).join("\n") + "\n";
    this.buffer = [];

    try {
      // Check if rotation needed
      if (this.rotateOnSize && existsSync(this.filePath)) {
        const stats = await fs.stat(this.filePath);
        if (stats.size > this.maxFileSize) {
          await this.rotate();
        }
      }

      appendFileSync(this.filePath, lines);
    } catch (err) {
      console.error("[audit-file] Failed to write:", err.message);
      // Re-add to buffer for retry
      this.buffer.unshift(...lines.split("\n").filter(l => l).map(l => JSON.parse(l)));
    }
  }

  async rotate() {
    // Simple rotation: move current file to .1, .2, etc.
    for (let i = this.maxFiles - 1; i > 0; i--) {
      const oldPath = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const newPath = `${this.filePath}.${i}`;
      if (existsSync(oldPath)) {
        try {
          if (existsSync(newPath)) {
            await fs.unlink(newPath);
          }
          await fs.rename(oldPath, newPath);
        } catch (err) {
          console.error(`[audit-file] Rotation failed: ${err.message}`);
        }
      }
    }
  }

  async read(limit = 100, offset = 0) {
    await this.flush(); // Ensure all writes are on disk

    const entries = [];
    if (!existsSync(this.filePath)) {
      return entries;
    }

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      
      // Read in reverse order (newest first)
      const start = lines.length - offset - limit;
      const end = lines.length - offset;
      const selectedLines = lines.slice(Math.max(0, start), end).reverse();

      for (const line of selectedLines) {
        try {
          entries.push(JSON.parse(line));
        } catch (e) {
          // Skip corrupted lines
        }
      }
    } catch (err) {
      console.error("[audit-file] Failed to read:", err.message);
    }

    return entries;
  }

  async close() {
    clearInterval(this.flushTimer);
    await this.flush();
  }
}

/**
 * Redis audit sink (optional)
 * Requires redis client to be installed separately
 */
export class RedisAuditSink extends AuditSink {
  constructor(redisClient, key = "shell:audit", maxEntries = 1000) {
    super();
    this.redis = redisClient;
    this.key = key;
    this.maxEntries = maxEntries;
  }

  async write(entry) {
    try {
      // Use LPUSH to add to list, LTRIM to keep max size
      const pipeline = this.redis.pipeline();
      pipeline.lpush(this.key, JSON.stringify(entry));
      pipeline.ltrim(this.key, 0, this.maxEntries - 1);
      await pipeline.exec();
    } catch (err) {
      console.error("[audit-redis] Failed to write:", err.message);
      throw err;
    }
  }
  async read(limit = 100, offset = 0) {
    try {
      // LRANGE returns from start to end (0 is newest with LPUSH)
      const entries = await this.redis.lrange(this.key, offset, offset + limit - 1);
      return entries.map(e => JSON.parse(e));
    } catch (err) {
      console.error("[audit-redis] Failed to read:", err.message);
      throw err;
    }
  }

  async close() {
    // Redis connection managed externally
  }
}

/**
 * Multi-sink audit logger (combines multiple sinks)
 */
export class MultiAuditSink extends AuditSink {
  constructor(sinks) {
    super();
    this.sinks = sinks;
  }

  async write(entry) {
    const results = await Promise.allSettled(
      this.sinks.map(sink => sink.write(entry))
    );

    // Log failures but don't throw
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(`[audit-multi] Sink ${i} failed:`, result.reason);
      }
    });
  }

  async read(limit = 100, offset = 0) {
    // Read from first sink (assumed to be primary)
    if (this.sinks.length === 0) return [];
    return this.sinks[0].read(limit, offset);
  }

  async close() {
    await Promise.all(this.sinks.map(s => s.close()));
  }
}

/**
 * Factory function to create appropriate sink based on config
 */
export function createAuditSink(config = {}) {
  const { type = "memory", ...options } = config;

  switch (type) {
    case "file":
      return new FileAuditSink(
        options.filePath || "./logs/shell-audit.jsonl",
        options
      );

    case "redis":
      if (!options.redisClient) {
        throw new Error("Redis audit sink requires redisClient option");
      }
      return new RedisAuditSink(options.redisClient, options.key, options.maxEntries);

    case "multi":
      if (!options.sinks || !Array.isArray(options.sinks)) {
        throw new Error("Multi audit sink requires sinks array");
      }
      return new MultiAuditSink(options.sinks);

    case "memory":
    default:
      return new MemoryAuditSink(options.maxEntries);
  }
}
