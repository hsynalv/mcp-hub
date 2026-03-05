/**
 * Error Categorization
 *
 * Classifies errors for appropriate handling (retry, circuit breaker, user message)
 */

export const ErrorCategory = {
  NETWORK: "NETWORK",         // Connection issues, timeouts
  RATE_LIMIT: "RATE_LIMIT",   // 429 Too Many Requests
  AUTH: "AUTH",               // 401/403 Unauthorized
  NOT_FOUND: "NOT_FOUND",     // 404
  VALIDATION: "VALIDATION",     // 400 Bad Request
  SERVER_ERROR: "SERVER_ERROR", // 5xx
  TIMEOUT: "TIMEOUT",         // Request timeout
  CIRCUIT_OPEN: "CIRCUIT_OPEN", // Circuit breaker open
  UNKNOWN: "UNKNOWN",         // Unclassified
};

/**
 * Categorize an error for appropriate handling
 * @param {Error} error - The error to categorize
 * @returns {Object} Categorization result
 */
export function categorizeError(error) {
  // Default
  let category = ErrorCategory.UNKNOWN;
  let retryable = false;
  let userMessage = error.message;
  let statusCode = null;

  // Check for specific error types
  if (error.name === "CircuitBreakerError" || error.code === "CIRCUIT_OPEN") {
    category = ErrorCategory.CIRCUIT_OPEN;
    retryable = false;
    userMessage = "Service temporarily unavailable. Please try again in a moment.";
  }
  else if (error.name === "RetryExhaustedError" || error.code === "RETRY_EXHAUSTED") {
    category = ErrorCategory.SERVER_ERROR;
    retryable = false;
    userMessage = "Service is currently unavailable. Please try again later.";
  }
  else if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
    category = ErrorCategory.NETWORK;
    retryable = true;
    userMessage = "Network connection issue. Retrying...";
  }
  else if (error.code === "ETIMEDOUT" || error.code === "TIMEOUT") {
    category = ErrorCategory.TIMEOUT;
    retryable = true;
    userMessage = "Request timed out. Retrying...";
  }
  // HTTP status codes
  else if (error.status || error.statusCode) {
    statusCode = error.status || error.statusCode;

    switch (statusCode) {
      case 400:
        category = ErrorCategory.VALIDATION;
        retryable = false;
        userMessage = error.message || "Invalid request. Please check your input.";
        break;
      case 401:
        category = ErrorCategory.AUTH;
        retryable = false;
        userMessage = "Authentication failed. Please check your API credentials.";
        break;
      case 403:
        category = ErrorCategory.AUTH;
        retryable = false;
        userMessage = "Access denied. Please check your permissions.";
        break;
      case 404:
        category = ErrorCategory.NOT_FOUND;
        retryable = false;
        userMessage = "Resource not found.";
        break;
      case 408:
        category = ErrorCategory.TIMEOUT;
        retryable = true;
        userMessage = "Request timeout. Retrying...";
        break;
      case 429:
        category = ErrorCategory.RATE_LIMIT;
        retryable = true;
        userMessage = "Rate limit exceeded. Waiting before retry...";
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        category = ErrorCategory.SERVER_ERROR;
        retryable = true;
        userMessage = "Server error. Retrying...";
        break;
      default:
        if (statusCode >= 500) {
          category = ErrorCategory.SERVER_ERROR;
          retryable = true;
        }
    }
  }
  // OpenAI specific errors
  else if (error.message?.includes("rate limit")) {
    category = ErrorCategory.RATE_LIMIT;
    retryable = true;
    userMessage = "AI service rate limit. Waiting before retry...";
  }
  else if (error.message?.includes("timeout")) {
    category = ErrorCategory.TIMEOUT;
    retryable = true;
  }

  return {
    category,
    retryable,
    userMessage,
    originalMessage: error.message,
    statusCode,
    error,
  };
}

/**
 * Check if an error is retryable
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  const { retryable } = categorizeError(error);
  return retryable;
}

/**
 * Get user-friendly message for an error
 * @param {Error} error
 * @returns {string}
 */
export function getUserMessage(error) {
  const { userMessage } = categorizeError(error);
  return userMessage;
}

/**
 * Create a retry predicate function for withRetry
 * @returns {Function}
 */
export function createRetryPredicate() {
  return (error) => isRetryableError(error);
}
