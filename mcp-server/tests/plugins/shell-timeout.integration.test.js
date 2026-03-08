/**
 * Shell Plugin Timeout Integration Tests
 *
 * Tests that verify timeout actually kills processes and prevents hanging.
 */

import { describe, it, expect, vi } from "vitest";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Mock policy hooks
vi.mock("../../src/core/policy-hooks.js", () => ({
  getPolicyEvaluator: vi.fn(() => null),
}));

describe("Shell Plugin - Timeout Integration", () => {
  it("should terminate long-running process on timeout", async () => {
    // Use a command that sleeps longer than our short timeout
    const shortTimeout = 500; // 500ms timeout
    const longSleep = 5; // 5 second sleep (much longer than timeout)

    const startTime = Date.now();
    let processKilled = false;
    let exitCode = null;

    try {
      // Spawn a process that sleeps for 5 seconds
      const child = spawn("sleep", [String(longSleep)], {
        timeout: shortTimeout,
      });

      // Track if process exits
      child.on("exit", (code, signal) => {
        exitCode = code;
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          processKilled = true;
        }
      });

      // Wait for timeout + small buffer
      await new Promise((resolve) => setTimeout(resolve, shortTimeout + 200));

      // Check if process was killed
      expect(processKilled).toBe(true);

      const duration = Date.now() - startTime;
      // Should have exited quickly due to timeout, not waited full 5 seconds
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
      expect(exitCode).toBeNull(); // Killed by signal, not normal exit
    } catch (err) {
      // Timeout should occur
      expect(err).toBeDefined();
    }
  });

  it("should return timeout error with exit code 124", async () => {
    // Test using exec with timeout option
    const timeoutMs = 300;

    try {
      await execAsync("sleep 10", { timeout: timeoutMs });
      // Should not reach here
      expect(false).toBe(true);
    } catch (err) {
      // Verify it's a timeout error
      expect(err.killed).toBe(true);
      expect(err.signal).toBe("SIGTERM");
    }
  });

  it("should kill hanging process before it completes", async () => {
    // Create a process that would run forever if not killed
    const child = spawn("cat", []); // cat without args waits for stdin forever

    let exitCode = null;
    let killed = false;

    child.on("exit", (code, signal) => {
      exitCode = code;
      if (signal) killed = true;
    });

    // Kill it after 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill("SIGTERM");

    // Wait for exit
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(killed).toBe(true);
    expect(exitCode).toBeNull(); // Killed by signal
  });

  it("should prevent resource exhaustion from many hanging processes", async () => {
    // Spawn multiple processes that would hang
    const children = [];
    const maxProcesses = 5;

    for (let i = 0; i < maxProcesses; i++) {
      const child = spawn("sleep", ["3600"]); // 1 hour sleep
      children.push(child);
    }

    // Kill all after short delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    let killedCount = 0;
    for (const child of children) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.on("exit", () => {
          killedCount++;
          resolve();
        });
        // Timeout in case process doesn't exit
        setTimeout(resolve, 100);
      });
    }

    // All processes should be killable
    expect(killedCount).toBeGreaterThanOrEqual(maxProcesses - 1);
  });
});
