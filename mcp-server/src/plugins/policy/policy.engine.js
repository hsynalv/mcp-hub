/**
 * Policy engine — evaluates rules against incoming requests.
 *
 * Actions:
 *   - require_approval  → create an approval entry and return 202
 *   - dry_run_first     → return preview without executing (needs ?confirmed=true to proceed)
 *   - rate_limit        → enforce request count limits per window
 *   - block             → always reject matching requests
 */

import { listRules, createApproval, checkPolicyRateLimit } from "./policy.store.js";

/**
 * Match a rule pattern against a request path.
 * Supports:
 *   - Exact: "POST /notion/rows/archive"
 *   - Wildcard: "* /n8n/workflow/*"
 *   - Path only: "/n8n/workflow/apply" (matches any method)
 */
function matchesRule(rule, method, path) {
  const pattern = rule.pattern ?? "";

  // Check if pattern includes method
  const parts = pattern.split(" ");
  let ruleMethod, rulePath;

  if (parts.length === 2) {
    [ruleMethod, rulePath] = parts;
  } else {
    ruleMethod = "*";
    rulePath   = parts[0];
  }

  // Match method
  if (ruleMethod !== "*" && ruleMethod.toUpperCase() !== method.toUpperCase()) return false;

  // Match path (convert glob * to regex)
  const rulePathRegex = new RegExp(
    "^" + rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+") + "$"
  );

  return rulePathRegex.test(path);
}

function explain(result) {
  if (result.allowed) return "Request allowed — no matching policy rules.";
  switch (result.action) {
    case "block":
      return `Blocked by rule "${result.rule}": ${result.reason || "Policy blocks this action."}`;
    case "require_approval":
      return `Requires approval: ${result.message || "Manual approval needed."}`;
    case "dry_run":
      return `Dry-run required: ${result.message || "Add ?confirmed=true to proceed."}`;
    case "policy_rate_limit":
      return `Rate limit exceeded: ${result.reason || "Too many requests."}`;
    default:
      return result.message || result.reason || "Policy denied.";
  }
}

/**
 * Evaluate all enabled rules against a request.
 * Returns { allowed, action, rule, approval?, explanation? } or { allowed: true, explanation }.
 */
export function evaluate(method, path, body, requestedBy) {
  const rules = listRules().filter((r) => r.enabled !== false);

  for (const rule of rules) {
    if (!matchesRule(rule, method, path)) continue;

    switch (rule.action) {
      case "block": {
        const r = {
          allowed: false,
          action:  "block",
          rule:    rule.id,
          reason:  rule.description || "Blocked by policy",
        };
        r.explanation = explain(r);
        return r;
      }

      case "rate_limit": {
        const result = checkPolicyRateLimit(rule);
        if (!result.allowed) {
          result.explanation = explain(result);
          return result;
        }
        break;
      }

      case "require_approval": {
        const approval = createApproval({ ruleId: rule.id, path, method, body, requestedBy });
        const r = {
          allowed:  false,
          action:   "require_approval",
          rule:     rule.id,
          approval: { id: approval.id, status: "pending", createdAt: approval.createdAt },
          message:  `This action requires manual approval. Approval ID: ${approval.id}. Check GET /policy/approvals and POST /policy/approvals/${approval.id}/approve to proceed.`,
        };
        r.explanation = explain(r);
        return r;
      }

      case "dry_run_first": {
        const r = {
          allowed: false,
          action:  "dry_run",
          rule:    rule.id,
          message: `This action requires dry-run confirmation. Add ?confirmed=true to the original request to proceed.`,
          preview: {
            method,
            path,
            body: body ?? null,
          },
        };
        r.explanation = explain(r);
        return r;
      }

      default:
        break;
    }
  }

  return { allowed: true, explanation: explain({ allowed: true }) };
}
