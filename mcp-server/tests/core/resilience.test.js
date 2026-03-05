/**
 * Resilience Module Tests
 * Retry logic and circuit breaker
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCircuitBreaker,
  CircuitBreakerError,
  withRetry,
  withResilience,
  getAllCircuitStates,
  resetCircuit,
  resetAllCircuits,
} from "../../src/core/resilience.js";

describe("Resilience Module", () => {
  beforeEach(() => {
    resetAllCircuits();
    vi.clearAllTimers();
  });

  describe("Circuit Breaker", () => {
    it("should create a circuit breaker", () => {
      const circuit = getCircuitBreaker("test-circuit", {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
      expect(circuit).toBeDefined();
      expect(circuit.name).toBe("test-circuit");
    });

    it("should return the same circuit for the same name", () => {
      const circuit1 = getCircuitBreaker("shared");
      const circuit2 = getCircuitBreaker("shared");
      expect(circuit1).toBe(circuit2);
    });

    it("should execute successfully when circuit is closed", async () => {
      const circuit = getCircuitBreaker("closed-circuit");
      const fn = vi.fn().mockResolvedValue("success");

      const result = await circuit.execute(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should track success and failure counts", async () => {
      const circuit = getCircuitBreaker("tracking");
      
      // Success
      await circuit.execute(() => Promise.resolve("ok"));
      let state = circuit.getState();
      expect(state.failureCount).toBe(0);

      // Failure
      await expect(circuit.execute(() => Promise.reject(new Error("fail"))))
        .rejects.toThrow("fail");
      
      state = circuit.getState();
      expect(state.failureCount).toBe(1);
    });

    it("should open circuit after threshold failures", async () => {
      const circuit = getCircuitBreaker("threshold", { failureThreshold: 2 });
      const error = new Error("service down");

      // First failure
      await expect(circuit.execute(() => Promise.reject(error)))
        .rejects.toThrow("service down");

      // Second failure - circuit should open
      await expect(circuit.execute(() => Promise.reject(error)))
        .rejects.toThrow();

      const state = circuit.getState();
      expect(state.state).toBe("OPEN");
    });

    it("should throw CircuitBreakerError when circuit is open", async () => {
      const circuit = getCircuitBreaker("open-test", { failureThreshold: 1 });
      
      // Open the circuit
      try {
        await circuit.execute(() => Promise.reject(new Error("fail")));
      } catch (e) {
        // expected
      }

      // Next call should throw CircuitBreakerError
      await expect(circuit.execute(() => Promise.resolve("should not run")))
        .rejects.toBeInstanceOf(CircuitBreakerError);
    });

    it("should get all circuit states", async () => {
      getCircuitBreaker("circuit-a");
      getCircuitBreaker("circuit-b");

      const states = getAllCircuitStates();
      expect(states).toHaveProperty("circuit-a");
      expect(states).toHaveProperty("circuit-b");
    });

    it("should reset a specific circuit", () => {
      const circuit = getCircuitBreaker("reset-test", { failureThreshold: 1 });
      
      // Open circuit
      circuit.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
      
      // Reset
      resetCircuit("reset-test");
      
      // Should create new circuit
      const newCircuit = getCircuitBreaker("reset-test");
      expect(newCircuit.getState().failureCount).toBe(0);
    });
  });

  describe("Retry Logic", () => {
    it("should succeed on first attempt", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      
      const result = await withRetry(fn, { maxAttempts: 3 });
      
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure", async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10 });
      
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should throw after max attempts exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("always fails"));

      await expect(withRetry(fn, { maxAttempts: 2, backoffMs: 10 }))
        .rejects.toThrow("All 2 attempts failed");
      
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should not retry non-retryable errors", async () => {
      const error = new Error("non-retryable");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, {
        maxAttempts: 3,
        backoffMs: 10,
        retryableError: () => false,
      })).rejects.toThrow("non-retryable");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      await withRetry(fn, { maxAttempts: 2, backoffMs: 10, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        delay: expect.any(Number),
      }));
    });
  });

  describe("Combined Resilience (Circuit + Retry)", () => {
    it("should retry within circuit", async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockResolvedValue("success");

      const result = await withResilience("combined-test", fn, {
        circuit: { failureThreshold: 5 },
        retry: { maxAttempts: 2, backoffMs: 10 },
      });

      expect(result).toBe("success");
    });

    it("should open circuit after retries exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("always fails"));

      // Should retry 2 times, fail, count as 1 failure toward circuit
      await expect(withResilience("resilient-circuit", fn, {
        circuit: { failureThreshold: 1 },
        retry: { maxAttempts: 2, backoffMs: 10 },
      })).rejects.toThrow();

      // Circuit should be open
      const states = getAllCircuitStates();
      expect(states["resilient-circuit"].state).toBe("OPEN");
    });
  });
});
