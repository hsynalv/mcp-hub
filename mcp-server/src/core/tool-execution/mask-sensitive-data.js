/**
 * Redact sensitive fields for tool audit logs (aligns with HTTP audit masking).
 */

import { maskBody } from "../audit.js";

/**
 * Deep-mask a value: objects use maskBody rules; primitives unchanged.
 * @param {*} value
 * @returns {*}
 */
export function maskSensitiveDeep(value) {
  if (value == null) return value;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map((v) => maskSensitiveDeep(v));
    }
    return maskBody(value);
  }
  return value;
}

/**
 * Build a safe audit payload for stderr / sinks.
 * @param {{ parameters?: object, result?: object, [k: string]: * }} entry
 * @returns {object}
 */
export function maskToolAuditPayload(entry) {
  const out = { ...entry };
  if (entry.parameters !== undefined) {
    out.parameters = maskSensitiveDeep(entry.parameters);
  }
  if (entry.result !== undefined) {
    out.result = maskSensitiveDeep(entry.result);
  }
  return out;
}
