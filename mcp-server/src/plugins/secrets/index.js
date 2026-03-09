import { Router } from "express";
import { canResolveSecret, getPolicyManager } from "../../core/policy/index.js";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import {
  listSecrets,
  registerSecret,
  unregisterSecret,
  resolveTemplate,
  auditEntry,
  generateCorrelationId,
  getAuditLogEntries,
} from "./secrets.store.js";

const pluginError = createPluginErrorHandler("secrets");

export const name = "secrets";
export const version = "1.0.0";
export const description = "Secret ref system — agents never see secret values";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET",    path: "/secrets",          description: "List registered secret names (no values)", scope: "read"   },
  { method: "POST",   path: "/secrets",          description: "Register a new secret name",               scope: "danger" },
  { method: "DELETE", path: "/secrets/:name",    description: "Unregister a secret name",                 scope: "danger" },
  { method: "POST",   path: "/secrets/resolve",  description: "Resolve template refs server-side",        scope: "write"  },
  { method: "GET",    path: "/secrets/audit",    description: "View audit log (values never included)",    scope: "read"   },
  { method: "GET",    path: "/secrets/health",   description: "Plugin health",                            scope: "read"   },
];
export const examples = [
  "GET  /secrets",
  'POST /secrets  body: {"name":"NOTION_API_KEY","description":"Notion integration secret"}',
  'POST /secrets/resolve  body: {"template":"Bearer {{secret:NOTION_API_KEY}}"}',
];

const registerSchema = z.object({
  name:        z.string().regex(/^[A-Z0-9_]+$/, "Must be UPPER_SNAKE_CASE"),
  description: z.string().optional().default(""),
});

const resolveSchema = z.object({
  template: z.string().min(1),
});

function validate(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const err = pluginError.validation("Invalid request", result.error.flatten());
    res.status(400).json({ ok: false, error: err.code, message: err.message, details: err.details });
    return null;
  }
  return result.data;
}

function extractContext(req) {
  return {
    actor: req.user?.id || req.user?.email || "anonymous",
    workspaceId: req.headers["x-workspace-id"] || null,
    projectId: req.headers["x-project-id"] || null,
  };
}

async function runWithAudit(operation, secretName, context, fn) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();

  try {
    const result = await fn();

    auditEntry({
      operation,
      secretName,
      allowed: true,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err) {
    auditEntry({
      operation,
      secretName,
      allowed: false,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      error: err.message,
      reason: err.code || "execution_error",
    });
    throw err;
  }
}

function _unused() { runWithAudit; } // Prevent lint error, function used for future extension

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /secrets
   * Returns registered secret names with hasValue flag (no values).
   */
  router.get("/", requireScope("read"), (req, res) => {
    const context = extractContext(req);
    try {
      const secrets = listSecrets(context);
      res.json({ ok: true, count: secrets.length, secrets });
    } catch (err) {
      const errCode = err.message.includes("workspaceId") ? "workspace_required" : "list_failed";
      const stdErr = pluginError.authorization(err.message, { code: errCode });
      res.status(403).json({ ok: false, error: stdErr.code, message: stdErr.message });
    }
  });

  /**
   * POST /secrets
   * Register a secret name so it can be referenced as {{secret:NAME}}.
   * Does NOT store the value — it must exist in process.env.
   */
  router.post("/", requireScope("danger"), (req, res) => {
    const data = validate(registerSchema, req.body, res);
    if (!data) return;

    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    try {
      const entry = registerSecret(data.name, data.description, context);

      auditEntry({
        operation: "register",
        secretName: data.name,
        allowed: true,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
      });

      res.status(201).json({ ok: true, secret: entry });
    } catch (err) {
      auditEntry({
        operation: "register",
        secretName: data.name,
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        error: err.message,
        reason: "invalid_name",
      });

      const stdErr = pluginError.validation(err.message, { code: "invalid_name" });
      res.status(400).json({ ok: false, error: stdErr.code, message: stdErr.message });
    }
  });

  /**
   * DELETE /secrets/:name
   * Remove a secret from the registry. Does not affect process.env.
   */
  router.delete("/:name", requireScope("danger"), (req, res) => {
    const { name: secretName } = req.params;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    try {
      const existed = unregisterSecret(secretName, context);

      auditEntry({
        operation: "unregister",
        secretName,
        allowed: true,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
      });

      if (!existed) {
        const stdErr = pluginError.notFound(`Secret "${secretName}" is not registered`, { resource: "secret", name: secretName });
        return res.status(404).json({ ok: false, error: stdErr.code, message: stdErr.message });
      }

      res.json({ ok: true, unregistered: secretName });
    } catch (err) {
      auditEntry({
        operation: "unregister",
        secretName,
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        error: err.message,
        reason: err.message.includes("workspaceId") ? "workspace_required" : "unregister_failed",
      });

      const statusCode = err.message.includes("workspaceId") ? 403 : 500;
      const stdErr = pluginError.internal(err.message);
      res.status(statusCode).json({ ok: false, error: stdErr.code, message: stdErr.message });
    }
  });

  /**
   * POST /secrets/resolve
   * Resolves {{secret:NAME}} refs in a template string.
   * Returns only a confirmation — the resolved value is used server-side.
   * This endpoint is for verification: did all refs resolve?
   */
  router.post("/resolve", requireScope("write"), async (req, res) => {
    const data = validate(resolveSchema, req.body, res);
    if (!data) return;

    const context = extractContext(req);
    const { template } = data;

    // Find all refs in the template
    const refs = [...template.matchAll(/\{\{secret:([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    const resolved = [];
    const missing  = [];

    // Policy check using core policy manager
    const policyManager = getPolicyManager();
    if (policyManager) {
      const policyResult = await canResolveSecret({
        actor: context.actor || "unknown",
        workspaceId: context.workspaceId || "global",
        secretName: refs.join(","),
      });
      if (!policyResult.allowed) {
        return res.status(403).json({
          ok: false,
          error: policyResult.code || "POLICY_DENIED",
          message: policyResult.reason || "Secret resolution not authorized",
        });
      }
    }

    for (const ref of refs) {
      const val = process.env[ref];
      if (val != null) resolved.push(ref);
      else missing.push(ref);
    }

    // Log resolution attempt (never log actual values)
    const startTime = Date.now();
    auditEntry({
      operation: "resolve",
      secretName: refs.join(","), // Multiple secrets can be resolved in one template
      allowed: missing.length === 0,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId: generateCorrelationId(),
      durationMs: Date.now() - startTime,
      reason: missing.length > 0 ? `missing: ${missing.join(",")}` : null,
    });

    // Return summary only — never return resolved values
    res.json({
      ok: missing.length === 0,
      refs: { found: resolved, missing },
      hasUnresolved: missing.length > 0,
      // Masked preview: replace found refs with *** for confirmation
      preview: resolveTemplate(template).replace(
        new RegExp(Object.keys(process.env)
          .filter((k) => refs.includes(k))
          .map((k) => escapeRegex(process.env[k]))
          .join("|") || "(?!)", "g"),
        "[RESOLVED]"
      ),
    });
  });

  /**
   * GET /secrets/audit
   * Returns secrets operation audit log (values never included).
   */
  router.get("/audit", requireScope("read"), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/secrets", router);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
