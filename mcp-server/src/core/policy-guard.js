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
import { getSecurityRuntime } from "./security/resolve-runtime-security.js";
import { resolveRequestedBy } from "./auth/resolve-principal.js";
import { isConfirmedBypassAllowed } from "./security/is-confirmed-bypass-allowed.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { emitHttpDenyHubEvent } from "./audit/emit-http-events.js";

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
    console.log("[policy] Rule store not registered yet, skipping preset load");
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

  if (isConfirmedBypassAllowed(req)) {
    return next();
  }

  const evaluate = getPolicyEvaluator();
  const runtime = getSecurityRuntime();
  if (!evaluate) {
    if (runtime.policyAllowMissingEvaluator) {
      return next();
    }
    void emitHttpDenyHubEvent(req, {
      source: "policy_guard",
      statusCode: 503,
      errorCode: "policy_unavailable",
    }).catch(() => {});
    const requestId = req.requestId ?? null;
    return res.status(503).json({
      ok: false,
      error: {
        code: "policy_unavailable",
        message:
          "Policy engine is required for write operations. Load the policy plugin or set POLICY_ALLOW_MISSING_EVALUATOR=true for local development only.",
      },
      meta: { requestId },
    });
  }

  const requestedBy = resolveRequestedBy({
    user: req.user,
    actor: req.actor,
  });

  const result = evaluate(req.method, req.path, req.body, requestedBy);

  if (result.allowed) {
    return next();
  }

  // Policy denied - handle based on action type
  const requestId = req.requestId ?? null;

  switch (result.action) {
    case "block": {
      void emitHttpDenyHubEvent(req, {
        source: "policy_guard",
        statusCode: 403,
        errorCode: "policy_blocked",
        policyRule: result.rule,
      }).catch(() => {});
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
      void emitHttpDenyHubEvent(req, {
        source: "policy_guard",
        statusCode: 429,
        errorCode: "policy_rate_limit",
        policyRule: result.rule,
        policyLimit: result.limit,
        policyWindow: result.window,
      }).catch(() => {});
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
      void emitHttpDenyHubEvent(req, {
        source: "policy_guard",
        statusCode: 403,
        errorCode: "policy_denied",
        policyRule: result.rule,
      }).catch(() => {});
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
