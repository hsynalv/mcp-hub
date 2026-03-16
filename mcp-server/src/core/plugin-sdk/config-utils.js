/**
 * Plugin SDK - Config Loading Utilities
 *
 * Load and validate plugin-specific configuration from env.
 */

import { z } from "zod";

/**
 * Load plugin config from env with optional validation.
 * @param {string} prefix - Env var prefix (e.g. "MY_PLUGIN")
 * @param {Object} defaults - Default values
 * @param {z.ZodSchema} [schema] - Optional Zod schema for validation
 * @returns {Object} Config object
 */
export function loadPluginConfig(prefix, defaults = {}, schema = null) {
  const config = { ...defaults };

  for (const [key, defaultVal] of Object.entries(defaults)) {
    const keyPart = key.replace(/([A-Z])/g, "_$1").toUpperCase().replace(/^_/, "");
    const envKey = `${prefix}_${keyPart}`.replace(/__/g, "_");
    const raw = process.env[envKey];
    if (raw !== undefined && raw !== "") {
      if (typeof defaultVal === "number") {
        config[key] = parseInt(raw, 10) || defaultVal;
      } else if (typeof defaultVal === "boolean") {
        config[key] = /^(1|true|yes|on)$/i.test(raw);
      } else {
        config[key] = raw;
      }
    }
  }

  if (schema) {
    const result = schema.safeParse(config);
    if (!result.success) {
      throw new Error(`Plugin config validation failed: ${result.error.message}`);
    }
    return result.data;
  }

  return config;
}

/**
 * Create a Zod schema for plugin config.
 * @param {Object} shape - Zod shape object
 * @returns {z.ZodObject}
 */
export function createConfigSchema(shape) {
  return z.object(shape);
}
