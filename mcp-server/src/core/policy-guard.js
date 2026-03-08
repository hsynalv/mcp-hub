/**
 * Policy Guardrail Middleware
 *
 * PR-5: Policy enforce + approval queue
 * - Startup presets load (policy/presets.json)
 * - Write actions guardrail (POST/PUT/PATCH/DELETE)
 *
 * Actions: allow | block | require_approval | dry_run_first
 */

import { getPolicyEvaluator, getApprovalStore } from "./policy-hooks.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRESETS_PATH = join(__dirname, "..", "plugins", "policy", "presets.json");

let presetsLoaded = false;

/**
 * Load presets from policy/presets.json at startup.
 * Idempotent: only loads if no rules exist yet.
 */
export function loadPresetsAtStartup() {
  if (presetsLoaded) return;

  const approvalStore = getApprovalStore();
  if (!approvalStore?.listRules || !approvalStore?.addRule) {
    console.log("[policy] Policy system not yet registered, skipping preset load");
    return;
  }

  const existingRules = approvalStore.listRules();
  if (existingRules.length > 0) {
    console.log("[policy] Rules already exist, skipping preset load");
    presetsLoaded = true;
    return;
  }

  try {
    const raw = readFileSync(PRESETS_PATH, "utf8");
    const { presets } = JSON.parse(raw);

    for (const preset of presets) {
      if (preset.enabled !== false) {
        approvalStore.addRule({
          pattern: preset.pattern,
          action: preset.action,
          description: preset.description ?? `Preset: ${preset.id}`,
          scope: preset.scope ?? "write",
          limit: preset.limit,
          window: preset.window,
          enabled: true,
        });
        console.log(`[policy] Loaded preset: ${preset.id} (${preset.pattern} → ${preset.action})`);
      }
    }

    presetsLoaded = true;
    console.log(`[policy] Loaded ${presets.length} preset(s) at startup`);
  } catch (err) {
    console.log("[policy] No presets.json found or empty, starting with empty rules");
    presetsLoaded = true;
  }
}

/**
 * Check if request method is a write operation.
 */
function isWriteOperation(method) {
  const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];
  return writeMethods.includes(method.toUpperCase());
}

/**
 * Policy guardrail middleware.
 * Evaluates write requests against policy rules.
 *
 * Returns:
 *   - allow: continue to next middleware
 *   - block: 403 with error envelope
 *   - require_approval: 202 with approval queue info
 *   - dry_run_first: 200 with preview, requires ?confirmed=true to proceed
 */
export function policyGuardrailMiddleware(req, res, next) {
  // Skip policy check for read operations
  if (!isWriteOperation(req.method)) {
    return next();
  }

  // Skip policy endpoints themselves (to avoid recursion)
  if (req.path.startsWith("/policy")) {
    return next();
  }

  // Skip if confirmed=true (dry-run bypass)
  if (req.query?.confirmed === "true") {
    return next();
  }

  // Get policy evaluator (may not be available if policy plugin not loaded)
  const evaluate = getPolicyEvaluator();
  if (!evaluate) {
    return next();
  }

  const requestedBy = req.actor?.type === "api_key"
    ? `key:${req.authScopes?.join(",") || "read"}`
    : "anonymous";

  const result = evaluate(req.method, req.path, req.body, requestedBy);

  if (result.allowed) {
    return next();
  }

  // Policy denied - handle based on action type
  const requestId = req.requestId ?? null;

  switch (result.action) {
    case "block": {
      return res.status(403).json({
        ok: false,
        error: {
          code: "policy_blocked",
          message: result.reason || "Blocked by policy",
          details: { rule: result.rule },
        },
        meta: { requestId },
      });
    }

    case "require_approval": {
      return res.status(202).json({
        ok: true,
        data: {
          status: "pending_approval",
          approval: result.approval,
          message: result.message,
        },
        meta: { requestId },
      });
    }

    case "dry_run": {
      return res.status(200).json({
        ok: true,
        data: {
          status: "dry_run_required",
          preview: result.preview,
          message: result.message,
          proceedUrl: `${req.path}?confirmed=true`,
        },
        meta: { requestId },
      });
    }

    case "policy_rate_limit": {
      return res.status(429).json({
        ok: false,
        error: {
          code: "policy_rate_limit",
          message: result.reason || "Rate limit exceeded",
          details: { rule: result.rule, limit: result.limit, window: result.window },
        },
        meta: { requestId },
      });
    }

    default: {
      return res.status(403).json({
        ok: false,
        error: {
          code: "policy_denied",
          message: result.explanation || "Request denied by policy",
        },
        meta: { requestId },
      });
    }
  }
}
