/**
 * Audit System Tests
 *
 * Comprehensive tests for the core audit infrastructure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MemoryAuditSink,
  FileAuditSink,
  MultiAuditSink,
  AuditManager,
  sanitizeAuditEvent,
  validateAuditEvent,
  generateCorrelationId,
} from "../src/core/audit/index.js";
import { existsSync, unlinkSync, rmdirSync } from "fs";
import { dirname } from "path";

// Helper to clean up test files
function cleanupFile(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    // Clean up rotated files
    for (let i = 1; i <= 5; i++) {
      const rotatedPath = `${filePath}.${i}`;
      if (existsSync(rotatedPath)) {
        unlinkSync(rotatedPath);
      }
    }
    // Try to remove directory if empty
    const dir = dirname(filePath);
    if (existsSync(dir)) {
      try {
        rmdirSync(dir);
      } catch {
        // Directory not empty or other error, ignore
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

describe("Audit Standard", () => {
  describe("generateCorrelationId", () => {
    it("should generate unique correlation IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith("audit-")).toBe(true);
    });
  });

  describe("validateAuditEvent", () => {
    it("should validate correct audit events", () => {
      const event = {
        timestamp: new Date().toISOString(),
        plugin: "test",
        operation: "test-op",
        actor: "user@example.com",
        workspaceId: "ws-1",
        correlationId: generateCorrelationId(),
        allowed: true,
        durationMs: 100,
        success: true,
      };
      expect(validateAuditEvent(event)).toBeNull();
    });

    it("should reject events missing required fields", () => {
      const event = {
        timestamp: new Date().toISOString(),
        plugin: "test",
        // missing operation
        actor: "user@example.com",
        workspaceId: "ws-1",
        allowed: true,
        success: true,
      };
      expect(validateAuditEvent(event)).toBe("Missing required field: operation");
    });

    it("should reject events with invalid types", () => {
      const event = {
        timestamp: new Date().toISOString(),
        plugin: "test",
        operation: "test-op",
        actor: "user@example.com",
        workspaceId: "ws-1",
        allowed: "yes", // should be boolean
        durationMs: 100,
        success: true,
      };
      expect(validateAuditEvent(event)).toBe("Field 'allowed' must be a boolean");
    });
  });

  describe("sanitizeAuditEvent", () => {
    it("should sanitize sensitive data from metadata", () => {
      const event = {
        timestamp: new Date().toISOString(),
        plugin: "test",
        operation: "test-op",
        actor: "user@example.com",
        workspaceId: "ws-1",
        correlationId: generateCorrelationId(),
        allowed: true,
        durationMs: 100,
        success: true,
        metadata: {
          password: "secret123",
          apiKey: "key-123",
          token: "token-456",
          safeField: "visible",
        },
      };
      const sanitized = sanitizeAuditEvent(event);
      expect(sanitized.metadata.password).toBe("[REDACTED]");
      expect(sanitized.metadata.apiKey).toBe("[REDACTED]");
      expect(sanitized.metadata.token).toBe("[REDACTED]");
      expect(sanitized.metadata.safeField).toBe("visible");
    });

    it("should handle events without metadata", () => {
      const event = {
        timestamp: new Date().toISOString(),
        plugin: "test",
        operation: "test-op",
        actor: "user@example.com",
        workspaceId: "ws-1",
        allowed: true,
        durationMs: 100,
        success: true,
      };
      const sanitized = sanitizeAuditEvent(event);
      expect(sanitized).toEqual(event);
    });
  });
});

describe("MemoryAuditSink", () => {
  let sink;

  beforeEach(() => {
    sink = new MemoryAuditSink({ maxEntries: 100 });
  });

  afterEach(async () => {
    await sink.close();
  });

  it("should write and read audit events", async () => {
    const event = {
      timestamp: new Date().toISOString(),
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    };

    await sink.write(event);
    const entries = await sink.read(10);

    expect(entries).toHaveLength(1);
    expect(entries[0].plugin).toBe("test");
    expect(entries[0].operation).toBe("test-op");
  });

  it("should enforce max entries limit with FIFO eviction", async () => {
    const smallSink = new MemoryAuditSink({ maxEntries: 5 });

    // Write 10 events
    for (let i = 0; i < 10; i++) {
      await smallSink.write({
        timestamp: new Date().toISOString(),
        plugin: "test",
        operation: `op-${i}`,
        actor: "user@example.com",
        workspaceId: "ws-1",
        correlationId: generateCorrelationId(),
        allowed: true,
        durationMs: 100,
        success: true,
      });
    }

    const entries = await smallSink.read(10);
    expect(entries).toHaveLength(5);
    // Should have most recent entries (op-5 through op-9)
    expect(entries[4].operation).toBe("op-5");
    expect(entries[0].operation).toBe("op-9");

    await smallSink.close();
  });

  it("should filter entries by plugin", async () => {
    await sink.write({
      timestamp: new Date().toISOString(),
      plugin: "plugin-a",
      operation: "test",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    });

    await sink.write({
      timestamp: new Date().toISOString(),
      plugin: "plugin-b",
      operation: "test",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    });

    const entries = await sink.read(10, 0, { plugin: "plugin-a" });
    expect(entries).toHaveLength(1);
    expect(entries[0].plugin).toBe("plugin-a");
  });

  it("should provide statistics", async () => {
    await sink.write({
      timestamp: new Date().toISOString(),
      plugin: "test",
      operation: "test",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    });

    const stats = await sink.stats();
    expect(stats.count).toBe(1);
    expect(stats.byPlugin.test).toBe(1);
    expect(stats.allowed).toBe(1);
    expect(stats.denied).toBe(0);
  });
});

describe("FileAuditSink", () => {
  const testFilePath = "./test-data/audit-test.log";
  let sink;

  beforeEach(async () => {
    cleanupFile(testFilePath);
    sink = new FileAuditSink(testFilePath, {
      maxFileSize: 1024, // 1KB for testing
      bufferSize: 1, // Flush immediately for tests
    });
    await sink.init?.();
  });

  afterEach(async () => {
    await sink.close();
    cleanupFile(testFilePath);
  });

  it("should write audit events to file", async () => {
    const event = {
      timestamp: new Date().toISOString(),
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    };

    await sink.write(event);
    await sink.flush(); // Ensure write is flushed

    const entries = await sink.read(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].plugin).toBe("test");
  });

  it("should filter entries when reading", async () => {
    await sink.write({
      timestamp: new Date().toISOString(),
      plugin: "plugin-a",
      operation: "test",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    });

    await sink.write({
      timestamp: new Date().toISOString(),
      plugin: "plugin-b",
      operation: "test",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: false,
      durationMs: 100,
      success: false,
    });

    await sink.flush();

    const allowedEntries = await sink.read(10, 0, { allowed: true });
    expect(allowedEntries).toHaveLength(1);
    expect(allowedEntries[0].allowed).toBe(true);

    const deniedEntries = await sink.read(10, 0, { allowed: false });
    expect(deniedEntries).toHaveLength(1);
    expect(deniedEntries[0].allowed).toBe(false);
  });
});

describe("MultiAuditSink", () => {
  it("should write to multiple sinks", async () => {
    const sink1 = new MemoryAuditSink({ maxEntries: 100 });
    const sink2 = new MemoryAuditSink({ maxEntries: 100 });
    const multiSink = new MultiAuditSink([sink1, sink2]);

    const event = {
      timestamp: new Date().toISOString(),
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    };

    await multiSink.write(event);

    const entries1 = await sink1.read(10);
    const entries2 = await sink2.read(10);

    expect(entries1).toHaveLength(1);
    expect(entries2).toHaveLength(1);

    await multiSink.close();
  });

  it("should continue if one sink fails", async () => {
    const goodSink = new MemoryAuditSink({ maxEntries: 100 });
    const badSink = {
      write: async () => {
        throw new Error("Sink error");
      },
      read: async () => [],
      stats: async () => ({}),
      close: async () => {},
    };

    const multiSink = new MultiAuditSink([goodSink, badSink]);

    const event = {
      timestamp: new Date().toISOString(),
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      correlationId: generateCorrelationId(),
      allowed: true,
      durationMs: 100,
      success: true,
    };

    // Should not throw
    await multiSink.write(event);

    const entries = await goodSink.read(10);
    expect(entries).toHaveLength(1);

    await multiSink.close();
  });
});

describe("AuditManager", () => {
  let manager;

  afterEach(async () => {
    if (manager) {
      await manager.close();
    }
  });

  it("should initialize with memory sink by default", async () => {
    manager = new AuditManager({
      enabled: true,
      sinks: ["memory"],
      memoryMaxEntries: 100,
    });

    await manager.init();
    expect(manager.initialized).toBe(true);
    expect(manager.sink).toBeDefined();
  });

  it("should emit and retrieve audit events", async () => {
    manager = new AuditManager({
      enabled: true,
      sinks: ["memory"],
      memoryMaxEntries: 100,
    });

    await manager.init();

    await manager.log({
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      allowed: true,
      success: true,
      durationMs: 100,
    });

    const entries = await manager.getRecentEntries({ limit: 10, plugin: "test" });
    expect(entries).toHaveLength(1);
    expect(entries[0].plugin).toBe("test");
    expect(entries[0].operation).toBe("test-op");
  });

  it("should provide statistics", async () => {
    manager = new AuditManager({
      enabled: true,
      sinks: ["memory"],
      memoryMaxEntries: 100,
    });

    await manager.init();

    await manager.log({
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      allowed: true,
      success: true,
      durationMs: 100,
    });

    const stats = await manager.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.initialized).toBe(true);
    expect(stats.emittedCount).toBe(1);
    expect(stats.failedCount).toBe(0);
  });

  it("should sanitize events before writing", async () => {
    manager = new AuditManager({
      enabled: true,
      sinks: ["memory"],
      memoryMaxEntries: 100,
      sanitizeStrict: true,
    });

    await manager.init();

    await manager.log({
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      allowed: true,
      success: true,
      durationMs: 100,
      metadata: {
        password: "secret",
        safeField: "visible",
      },
    });

    const entries = await manager.getRecentEntries({ limit: 10 });
    expect(entries[0].metadata.password).toBe("[REDACTED]");
    expect(entries[0].metadata.safeField).toBe("visible");
  });

  it("should not emit when disabled", async () => {
    manager = new AuditManager({
      enabled: false,
    });

    await manager.init();

    await manager.log({
      plugin: "test",
      operation: "test-op",
      actor: "user@example.com",
      workspaceId: "ws-1",
      allowed: true,
      success: true,
      durationMs: 100,
    });

    const stats = await manager.getStats();
    expect(stats.emittedCount).toBe(0);
  });
});
