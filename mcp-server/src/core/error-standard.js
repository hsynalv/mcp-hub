/**
 * Standardized Error System
 * 
 * Enforces consistent error structure across all plugins:
 * - code: machine-readable error code
 * - category: error classification
 * - message: human-readable description
 * - userSafeMessage: safe to show to end users
 * - retryable: can client retry?
 * - details: additional context
 * - correlationId: request tracing
 */

import { AppError, NotFoundError, ValidationError } from "./errors.js";

export const ErrorCategories = {
  VALIDATION: "validation",
  AUTHENTICATION: "authentication",
  AUTHORIZATION: "authorization",
  NOT_FOUND: "not_found",
  RATE_LIMITED: "rate_limited",
  EXTERNAL_ERROR: "external_error",
  INTERNAL_ERROR: "internal_error",
  PLUGIN_ERROR: "plugin_error",
  TIMEOUT: "timeout",
};

/**
 * Standardized error wrapper
 * Ensures all errors follow the same envelope structure
 */
export class StandardizedError extends AppError {
  constructor({
    code,
    category = ErrorCategories.INTERNAL_ERROR,
    message,
    userSafeMessage,
    retryable = false,
    details = null,
    statusCode = 500,
  }) {
    super(message, statusCode, code, details);
    this.category = category;
    this.userSafeMessage = userSafeMessage || message;
    this.retryable = retryable;
  }

  serialize(requestId = null) {
    return {
      ok: false,
      error: {
        code: this.code,
        category: this.category,
        message: this.message,
        userSafeMessage: this.userSafeMessage,
        retryable: this.retryable,
        ...(this.details && { details: this.details }),
      },
      meta: {
        correlationId: requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Pre-defined error factories for common cases
 */
export const Errors = {
  validation: (message, details) => new StandardizedError({
    code: "VALIDATION_ERROR",
    category: ErrorCategories.VALIDATION,
    message,
    userSafeMessage: message,
    retryable: false,
    statusCode: 400,
    details,
  }),

  authentication: (message = "Authentication required") => new StandardizedError({
    code: "AUTHENTICATION_ERROR",
    category: ErrorCategories.AUTHENTICATION,
    message,
    userSafeMessage: "Please authenticate to continue",
    retryable: false,
    statusCode: 401,
  }),

  authorization: (message = "Access denied") => new StandardizedError({
    code: "AUTHORIZATION_ERROR",
    category: ErrorCategories.AUTHORIZATION,
    message,
    userSafeMessage: "You don't have permission to do this",
    retryable: false,
    statusCode: 403,
  }),

  notFound: (resource = "Resource") => new StandardizedError({
    code: "NOT_FOUND",
    category: ErrorCategories.NOT_FOUND,
    message: `${resource} not found`,
    userSafeMessage: `${resource} not found`,
    retryable: false,
    statusCode: 404,
  }),

  rateLimited: (retryAfter = null) => new StandardizedError({
    code: "RATE_LIMITED",
    category: ErrorCategories.RATE_LIMITED,
    message: "Too many requests",
    userSafeMessage: "Please slow down and try again later",
    retryable: true,
    statusCode: 429,
    details: retryAfter ? { retryAfter } : null,
  }),

  externalError: (service, message) => new StandardizedError({
    code: "EXTERNAL_ERROR",
    category: ErrorCategories.EXTERNAL_ERROR,
    message: `${service} error: ${message}`,
    userSafeMessage: `External service ${service} failed`,
    retryable: true,
    statusCode: 502,
    details: { service },
  }),

  pluginError: (plugin, message, userSafeMessage) => new StandardizedError({
    code: "PLUGIN_ERROR",
    category: ErrorCategories.PLUGIN_ERROR,
    message: `${plugin}: ${message}`,
    userSafeMessage: userSafeMessage || "Plugin operation failed",
    retryable: false,
    statusCode: 500,
    details: { plugin },
  }),

  timeout: (operation) => new StandardizedError({
    code: "TIMEOUT",
    category: ErrorCategories.TIMEOUT,
    message: `${operation} timed out`,
    userSafeMessage: "Operation took too long, please try again",
    retryable: true,
    statusCode: 504,
    details: { operation },
  }),

  internal: (message) => new StandardizedError({
    code: "INTERNAL_ERROR",
    category: ErrorCategories.INTERNAL_ERROR,
    message,
    userSafeMessage: "Something went wrong on our end",
    retryable: true,
    statusCode: 500,
  }),
};

/**
 * Wrap any error into standardized format
 * @param {Error} error - Original error
 * @param {string} context - Where the error occurred
 * @returns {StandardizedError}
 */
export function standardizeError(error, context = "unknown") {
  // Already standardized
  if (error instanceof StandardizedError) {
    return error;
  }

  // AppError but not standardized
  if (error instanceof AppError) {
    return new StandardizedError({
      code: error.code || "INTERNAL_ERROR",
      category: ErrorCategories.INTERNAL_ERROR,
      message: error.message,
      userSafeMessage: "Something went wrong",
      retryable: false,
      statusCode: error.statusCode || 500,
      details: { originalError: error.details, context },
    });
  }

  // Unknown error
  return new StandardizedError({
    code: "UNKNOWN_ERROR",
    category: ErrorCategories.INTERNAL_ERROR,
    message: error.message || "Unknown error",
    userSafeMessage: "An unexpected error occurred",
    retryable: false,
    statusCode: 500,
    details: { 
      context,
      originalName: error.name,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    },
  });
}

/**
 * Plugin error wrapper
 * Forces plugins to use standardized errors
 */
export function createPluginErrorHandler(pluginName) {
  return {
    wrap: (error, operation) => {
      if (error instanceof StandardizedError) {
        return error;
      }
      
      return Errors.pluginError(
        pluginName,
        `${operation} failed: ${error.message}`,
        "Plugin operation failed"
      );
    },

    validation: (message, details) => Errors.validation(
      `[${pluginName}] ${message}`,
      details
    ),

    external: (service, message) => Errors.externalError(
      `${pluginName} → ${service}`,
      message
    ),

    timeout: (operation) => Errors.timeout(
      `${pluginName}.${operation}`
    ),
  };
}

/**
 * Express error handler middleware
 * Catches all errors and standardizes responses
 */
export function standardizedErrorHandler(err, req, res, next) {
  const standardized = standardizeError(err, req.path);
  const correlationId = req.correlationId || req.requestId;
  
  // Log error
  console.error(`[ERROR] ${standardized.code} at ${req.path}:`, {
    message: standardized.message,
    category: standardized.category,
    correlationId,
  });

  // Send standardized response
  res.status(standardized.statusCode).json(
    standardized.serialize(correlationId)
  );
}

/**
 * Error category badge for logging/monitoring
 */
export function getErrorBadge(category) {
  const badges = {
    [ErrorCategories.VALIDATION]: "⚠️",
    [ErrorCategories.AUTHENTICATION]: "🔒",
    [ErrorCategories.AUTHORIZATION]: "🚫",
    [ErrorCategories.NOT_FOUND]: "🔍",
    [ErrorCategories.RATE_LIMITED]: "⏱️",
    [ErrorCategories.EXTERNAL_ERROR]: "🔌",
    [ErrorCategories.INTERNAL_ERROR]: "💥",
    [ErrorCategories.PLUGIN_ERROR]: "🔧",
    [ErrorCategories.TIMEOUT]: "⌛",
  };
  return badges[category] || "❓";
}
