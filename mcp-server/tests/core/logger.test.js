/**
 * Logger Module Tests
 * Structured logging with levels and rotation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, LogLevel } from "../../src/core/logger.js";

describe("Logger Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Log Levels", () => {
    it("should log debug messages", () => {
      logger.debug("Debug message", { test: true });
      expect(console.log).toHaveBeenCalled();
    });

    it("should log info messages", () => {
      logger.info("Info message", { context: "test" });
      expect(console.log).toHaveBeenCalled();
    });

    it("should log warning messages", () => {
      logger.warn("Warning message");
      expect(console.warn).toHaveBeenCalled();
    });

    it("should log error messages", () => {
      logger.error("Error message", { error: "details" });
      expect(console.error).toHaveBeenCalled();
    });

    it("should log fatal messages", () => {
      logger.fatal("Fatal message");
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("Span Tracking", () => {
    it("should create a span with start/end", () => {
      const span = logger.start("test-operation", { userId: 123 });
      
      expect(span).toHaveProperty("spanId");
      expect(span).toHaveProperty("end");
      expect(typeof span.end).toBe("function");
    });

    it("should log span start", () => {
      logger.start("operation", { id: 1 });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("operation started"),
        expect.any(String)
      );
    });

    it("should log span end with result", () => {
      const span = logger.start("operation", {});
      span.end({ success: true });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("operation completed"),
        expect.any(String)
      );
    });

    it("should log span end with error", () => {
      const span = logger.start("failing-op", {});
      span.end({}, new Error("Failed"));
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("failing-op failed"),
        expect.any(String)
      );
    });

    it("should return duration from span end", () => {
      const span = logger.start("timed-op", {});
      const duration = span.end();
      
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("should track span IDs", () => {
      const span1 = logger.start("op1", {});
      const span2 = logger.start("op2", {});
      
      expect(span1.spanId).not.toBe(span2.spanId);
    });
  });

  describe("Context Support", () => {
    it("should include context in log output", () => {
      logger.info("Message", { key: "value", number: 42 });
      
      const callArgs = console.log.mock.calls[0];
      expect(callArgs[1]).toContain('"key":"value"');
      expect(callArgs[1]).toContain('"number":42');
    });

    it("should include process info in context", () => {
      logger.info("Message");
      
      const callArgs = console.log.mock.calls[0];
      expect(callArgs[1]).toContain('"pid"');
      expect(callArgs[1]).toContain('"node_version"');
    });
  });

  describe("Log Format", () => {
    it("should include timestamp in logs", () => {
      logger.info("Test");
      
      const callArgs = console.log.mock.calls[0];
      // Should contain ISO timestamp format
      expect(callArgs[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should include log level in output", () => {
      logger.warn("Warning");
      
      const callArgs = console.warn.mock.calls[0];
      expect(callArgs[0]).toContain("WARN");
    });

    it("should format error level correctly", () => {
      logger.error("Error");
      
      const callArgs = console.error.mock.calls[0];
      expect(callArgs[0]).toContain("ERROR");
    });
  });
});
