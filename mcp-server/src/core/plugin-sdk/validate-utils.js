/**
 * Plugin SDK - Validation Utilities
 *
 * Request validation with consistent error responses.
 */

import { z } from "zod";
import { createPluginErrorHandler } from "../error-standard.js";

/**
 * Validate request body and return parsed data or send error response.
 * Use when you need to validate inline (e.g. in route handler).
 * For middleware-style validation, use validateBody(schema) from core/validate.
 * @param {z.ZodSchema} schema - Zod schema
 * @param {Object} body - Request body
 * @param {import("express").Response} res - Express response
 * @param {string} [pluginName] - Plugin name for error messages
 * @returns {Object|null} Parsed data or null if validation failed
 */
export function validateBodySync(schema, body, res, pluginName = "plugin") {
  const result = schema.safeParse(body);
  if (!result.success) {
    const err = createPluginErrorHandler(pluginName).validation(
      "Invalid request",
      result.error.flatten()
    );
    res.status(400).json({
      ok: false,
      error: err.code || "validation_error",
      message: err.message,
      details: result.error.flatten(),
    });
    return null;
  }
  return result.data;
}

/**
 * Re-export Express validation middlewares from core.
 * Use validateBody(schema) for req.body, validateQuery(schema) for req.query.
 */
export { validateBody, validateQuery, validateParams } from "../validate.js";
