/**
 * Map HTTP-layer denies (security / scope / policy-guard) to hub event types + safe metadata.
 */

import { HubEventTypes } from "./event-types.js";

/** @typedef {"enforce_security_context"|"require_scope"|"policy_guard"} HttpDenySource */

/**
 * @param {unknown} rule
 * @returns {string|undefined}
 */
export function sanitizePolicyRuleRef(rule) {
  if (rule == null) return undefined;
  if (typeof rule === "string") {
    const s = rule.trim();
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  }
  if (typeof rule === "object") {
    if (typeof rule.id === "string") return rule.id;
    if (typeof rule.pattern === "string") {
      const p = rule.pattern.length > 80 ? `${rule.pattern.slice(0, 80)}…` : rule.pattern;
      return `pattern:${p}`;
    }
  }
  return "policy_rule";
}

/**
 * @param {object} detail
 * @param {HttpDenySource} detail.source
 * @param {number} detail.statusCode
 * @param {string} [detail.errorCode]
 * @param {string} [detail.requiredScope]
 * @param {unknown} [detail.policyRule]
 * @param {number} [detail.policyLimit]
 * @param {number|string} [detail.policyWindow]
 * @returns {{ eventType: string, reason: string, metadata: Record<string, string|number|undefined> }}
 */
export function normalizeHttpDenyEvent(detail) {
  const {
    source,
    statusCode,
    errorCode = "",
    requiredScope,
    policyRule,
    policyLimit,
    policyWindow,
  } = detail;

  const meta = {
    hubDenySource: source,
    hubPhase:
      source === "enforce_security_context"
        ? "authenticate"
        : source === "require_scope"
          ? "authorize"
          : "policy_guard",
  };

  /** @type {string} */
  let eventType = HubEventTypes.AUTH_DENIED;
  /** @type {string} */
  let reason = errorCode || "denied";

  if (source === "policy_guard") {
    eventType = HubEventTypes.POLICY_DENIED;
    if (statusCode === 503) {
      meta.hubDenyKind = "policy_unavailable";
      reason = "policy_unavailable";
      meta.hubErrorCode = "policy_unavailable";
    } else if (statusCode === 429) {
      meta.hubDenyKind = "policy_rate_limit";
      reason = errorCode || "policy_rate_limit";
      meta.hubErrorCode = "policy_rate_limit";
      if (typeof policyLimit === "number") meta.hubPolicyLimit = policyLimit;
      if (policyWindow != null) meta.hubPolicyWindow = policyWindow;
    } else {
      const ruleRef = sanitizePolicyRuleRef(policyRule);
      if (errorCode === "policy_blocked") {
        meta.hubDenyKind = "policy_blocked";
      } else {
        meta.hubDenyKind = "policy_denied";
      }
      meta.hubErrorCode = errorCode || "policy_denied";
      reason = errorCode || "policy_denied";
      if (ruleRef) meta.hubPolicyRule = ruleRef;
    }
  } else if (source === "require_scope") {
    eventType = HubEventTypes.AUTH_DENIED;
    meta.hubErrorCode = errorCode || (statusCode === 403 ? "forbidden" : "unauthorized");
    if (statusCode === 403) {
      meta.hubDenyKind = "insufficient_scope";
      reason = requiredScope ? `insufficient_scope:${requiredScope}` : "insufficient_scope";
    } else {
      meta.hubDenyKind = "security_context_missing";
      reason = "security_context_missing";
    }
    if (requiredScope) meta.hubRequiredScope = String(requiredScope);
  } else if (source === "enforce_security_context") {
    eventType = HubEventTypes.AUTH_DENIED;
    const code = errorCode || (statusCode === 401 ? "unauthorized" : "auth_error");
    meta.hubErrorCode = code;
    meta.hubDenyKind = code === "invalid_token" ? "invalid_token" : "unauthenticated";
    reason = code;
  }

  return { eventType, reason, metadata: meta };
}
