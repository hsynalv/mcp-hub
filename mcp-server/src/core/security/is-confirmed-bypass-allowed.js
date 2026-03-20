import { getSecurityRuntime } from "./resolve-runtime-security.js";

/**
 * Narrow policy dry-run confirmation: shared secret header, optional explicit dev query bypass.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isConfirmedBypassAllowed(req) {
  if (!req) return false;

  const secret = process.env.HUB_POLICY_CONFIRM_SECRET?.trim();
  if (secret) {
    const h =
      req.headers?.["x-hub-policy-confirm"] ??
      req.headers?.["X-Hub-Policy-Confirm"];
    if (h === secret) return true;
  }

  const rt = getSecurityRuntime();
  if (rt.policyConfirmQueryBypass && req.query?.confirmed === "true") return true;

  return false;
}
