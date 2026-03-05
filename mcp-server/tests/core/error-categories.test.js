/**
 * Error Categories Tests
 * Error classification and retry logic
 */

import { describe, it, expect } from "vitest";
import {
  ErrorCategory,
  categorizeError,
  isRetryableError,
  getUserMessage,
  createRetryPredicate,
} from "../../src/core/error-categories.js";

describe("Error Categories", () => {
  describe("categorizeError", () => {
    it("should categorize circuit breaker errors", () => {
      const error = new Error("Circuit is OPEN");
      error.name = "CircuitBreakerError";
      error.code = "CIRCUIT_OPEN";

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.CIRCUIT_OPEN);
      expect(result.retryable).toBe(false);
      expect(result.userMessage).toContain("temporarily unavailable");
    });

    it("should categorize retry exhausted errors", () => {
      const error = new Error("All attempts failed");
      error.name = "RetryExhaustedError";
      error.code = "RETRY_EXHAUSTED";

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(result.retryable).toBe(false);
    });

    it("should categorize network errors", () => {
      const error = new Error("Connection refused");
      error.code = "ECONNREFUSED";

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.NETWORK);
      expect(result.retryable).toBe(true);
    });

    it("should categorize timeout errors", () => {
      const error = new Error("Request timeout");
      error.code = "ETIMEDOUT";

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.TIMEOUT);
      expect(result.retryable).toBe(true);
    });

    it("should categorize rate limit errors (429)", () => {
      const error = new Error("Too many requests");
      error.status = 429;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(result.retryable).toBe(true);
    });

    it("should categorize auth errors (401)", () => {
      const error = new Error("Unauthorized");
      error.status = 401;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.AUTH);
      expect(result.retryable).toBe(false);
      expect(result.userMessage).toContain("Authentication failed");
    });

    it("should categorize 403 forbidden errors", () => {
      const error = new Error("Forbidden");
      error.status = 403;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.AUTH);
      expect(result.retryable).toBe(false);
    });

    it("should categorize 404 not found errors", () => {
      const error = new Error("Not Found");
      error.status = 404;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.NOT_FOUND);
      expect(result.retryable).toBe(false);
    });

    it("should categorize 400 validation errors", () => {
      const error = new Error("Bad Request");
      error.status = 400;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.retryable).toBe(false);
    });

    it("should categorize 5xx server errors", () => {
      const error = new Error("Internal Server Error");
      error.status = 500;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });

    it("should categorize 502 bad gateway errors", () => {
      const error = new Error("Bad Gateway");
      error.status = 502;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });

    it("should categorize 503 service unavailable errors", () => {
      const error = new Error("Service Unavailable");
      error.status = 503;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });

    it("should categorize 504 gateway timeout errors", () => {
      const error = new Error("Gateway Timeout");
      error.status = 504;

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });

    it("should categorize OpenAI rate limit errors", () => {
      const error = new Error("Rate limit exceeded for OpenAI API");

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(result.retryable).toBe(true);
    });

    it("should categorize OpenAI timeout errors", () => {
      const error = new Error("Request timeout from OpenAI");

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.TIMEOUT);
      expect(result.retryable).toBe(true);
    });

    it("should categorize unknown errors", () => {
      const error = new Error("Something weird happened");

      const result = categorizeError(error);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.retryable).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("should return true for retryable errors", () => {
      const error = new Error("Network error");
      error.code = "ECONNRESET";
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      const error = new Error("Auth failed");
      error.status = 401;
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("getUserMessage", () => {
    it("should return user-friendly messages", () => {
      const error = new Error("Rate limit");
      error.status = 429;

      const message = getUserMessage(error);
      expect(message).toContain("Rate limit");
    });
  });

  describe("createRetryPredicate", () => {
    it("should create a predicate function", () => {
      const predicate = createRetryPredicate();
      expect(typeof predicate).toBe("function");
    });

    it("should return true for retryable errors", () => {
      const predicate = createRetryPredicate();
      const error = new Error("Timeout");
      error.status = 408;
      expect(predicate(error)).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      const predicate = createRetryPredicate();
      const error = new Error("Not found");
      error.status = 404;
      expect(predicate(error)).toBe(false);
    });
  });
});
