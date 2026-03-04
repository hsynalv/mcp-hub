import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import {
  listSecrets,
  registerSecret,
  unregisterSecret,
  resolveTemplate,
} from "./secrets.store.js";

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
    res.status(400).json({ ok: false, error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /secrets
   * Returns registered secret names with hasValue flag (no values).
   */
  router.get("/", requireScope("read"), (_req, res) => {
    const secrets = listSecrets();
    res.json({ ok: true, count: secrets.length, secrets });
  });

  /**
   * POST /secrets
   * Register a secret name so it can be referenced as {{secret:NAME}}.
   * Does NOT store the value — it must exist in process.env.
   */
  router.post("/", requireScope("danger"), (req, res) => {
    const data = validate(registerSchema, req.body, res);
    if (!data) return;

    try {
      const entry = registerSecret(data.name, data.description);
      res.status(201).json({ ok: true, secret: entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: "invalid_name", message: err.message });
    }
  });

  /**
   * DELETE /secrets/:name
   * Remove a secret from the registry. Does not affect process.env.
   */
  router.delete("/:name", requireScope("danger"), (req, res) => {
    const { name: secretName } = req.params;
    const existed = unregisterSecret(secretName);
    if (!existed) {
      return res.status(404).json({ ok: false, error: "not_found", message: `Secret "${secretName}" is not registered` });
    }
    res.json({ ok: true, unregistered: secretName });
  });

  /**
   * POST /secrets/resolve
   * Resolves {{secret:NAME}} refs in a template string.
   * Returns only a confirmation — the resolved value is used server-side.
   * This endpoint is for verification: did all refs resolve?
   */
  router.post("/resolve", requireScope("write"), (req, res) => {
    const data = validate(resolveSchema, req.body, res);
    if (!data) return;

    const { template } = data;

    // Find all refs in the template
    const refs = [...template.matchAll(/\{\{secret:([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    const resolved = [];
    const missing  = [];

    for (const ref of refs) {
      const val = process.env[ref];
      if (val != null) resolved.push(ref);
      else missing.push(ref);
    }

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

  app.use("/secrets", router);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
