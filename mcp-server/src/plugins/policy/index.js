import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { toolContextFromRequest } from "../../core/authorization/http-tool-context.js";
import { ToolTags } from "../../core/tool-registry.js";
import { registerPolicyHooks } from "../../core/policy-hooks.js";
import { registerBeforeExecutionHook } from "../../core/tool-hooks.js";
import { getApprovalStore } from "../../core/policy-hooks.js";
import {
  listRules,
  addRule,
  removeRule,
  listApprovals,
  updateApprovalStatus,
  createApproval,
  getApproval,
} from "./policy.store.js";
import { evaluate } from "./policy.engine.js";
import { loadPolicyConfig } from "./policy.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const name = "policy";
export const version = "1.0.0";
export const description = "Policy engine with rule-based access control, approval queue, dry-run, and rate limits";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET",    path: "/policy/rules",                 description: "List all policy rules",        scope: "read"   },
  { method: "GET",    path: "/policy/presets",               description: "List preset rules",            scope: "read"   },
  { method: "POST",   path: "/policy/rules/load-preset",      description: "Load a preset rule",          scope: "danger" },
  { method: "POST",   path: "/policy/rules",                  description: "Add a policy rule",            scope: "danger" },
  { method: "DELETE", path: "/policy/rules/:id",              description: "Remove a policy rule",         scope: "danger" },
  { method: "GET",    path: "/policy/approvals",              description: "List approval requests",       scope: "read"   },
  { method: "GET",    path: "/approvals/pending",             description: "List pending approvals",       scope: "read"   },
  { method: "POST",   path: "/policy/approvals/:id/approve", description: "Approve a request",            scope: "danger" },
  { method: "POST",   path: "/policy/approvals/:id/reject",   description: "Reject a request",             scope: "danger" },
  { method: "POST",   path: "/approve",                       description: "Approve tool execution",       scope: "danger" },
  { method: "POST",   path: "/policy/evaluate",              description: "Test a request against policy", scope: "read"   },
  { method: "POST",   path: "/policy/simulate",              description: "Simulate with explanation",     scope: "read"   },
  { method: "GET",    path: "/policy/health",                 description: "Plugin health",                scope: "read"   },
];
export const examples = [
  'POST /policy/rules  body: {"pattern":"POST /notion/rows/archive","action":"require_approval","description":"Bulk delete needs approval"}',
  "GET  /policy/approvals?status=pending",
  'POST /policy/evaluate  body: {"method":"POST","path":"/notion/rows/archive"}',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "policy_list_rules",
    description: "List all policy rules",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const rules = listRules();
      return { ok: true, data: { count: rules.length, rules } };
    },
  },
  {
    name: "policy_evaluate",
    description: "Test a request against all policy rules",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "HTTP method" },
        path: { type: "string", description: "Request path" },
        body: { type: "object", description: "Request body" },
      },
      required: ["method", "path"],
    },
    handler: async (args) => {
      const result = evaluate(args.method, args.path, args.body, "agent");
      return { ok: true, data: result };
    },
  },
  {
    name: "policy_list_approvals",
    description: "List pending or all approval requests",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "approved", "rejected"], description: "Filter by status" },
      },
    },
    handler: async (args) => {
      const approvals = listApprovals({ status: args.status });
      return { ok: true, data: { count: approvals.length, approvals } };
    },
  },
  {
    name: "policy_approve",
    description: "Approve a pending request (requires danger scope)",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Approval ID" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const approval = updateApprovalStatus(args.id, "approved", "agent");
      if (!approval) return { ok: false, error: { code: "not_found", message: "Approval not found" } };
      return { ok: true, data: approval };
    },
  },
  {
    name: "policy_reject",
    description: "Reject a pending request (requires danger scope)",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Approval ID" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const approval = updateApprovalStatus(args.id, "rejected", "agent");
      if (!approval) return { ok: false, error: { code: "not_found", message: "Approval not found" } };
      return { ok: true, data: approval };
    },
  },
];

const ruleSchema = z.object({
  id:          z.string().optional(),
  pattern:     z.string().min(1, "Pattern is required (e.g. 'POST /notion/rows/archive')"),
  action:      z.enum(["require_approval", "dry_run_first", "rate_limit", "block"]),
  scope:       z.enum(["read", "write", "danger"]).optional(),
  description: z.string().optional(),
  limit:       z.number().int().positive().optional(),
  window:      z.string().optional(),
  enabled:     z.boolean().optional(),
});

const evaluateSchema = z.object({
  method: z.string().min(1),
  path:   z.string().min(1),
  body:   z.any().optional(),
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
  // Register policy system hooks with core
  registerPolicyHooks({
    evaluate,
    createApproval,
    updateApprovalStatus,
    getApproval,
    listApprovals,
    loadPolicyConfig,
    listRules,
    addRule,
  });

  // Tool policy pattern matching runs in core authorization (execute-tool) before this hook.
  registerBeforeExecutionHook(async (toolName, args, context) => {
    // Tag-based approval workflow
    const approvalStore = getApprovalStore();
    const policyConfig = approvalStore?.loadPolicyConfig
      ? approvalStore.loadPolicyConfig()
      : {};

    // Get tool tags (we need to check the tool registry)
    // Note: This import is dynamic to avoid circular dependency
    const { listTools } = await import("../../core/tool-registry.js");
    const allTools = listTools();
    const tool = allTools.find(t => t.name === toolName);
    const toolTags = tool?.tags || [];

    const needsApproval =
      toolTags.includes(ToolTags.NEEDS_APPROVAL) ||
      (toolTags.includes(ToolTags.DESTRUCTIVE) &&
        policyConfig.destructive_requires_approval) ||
      (toolTags.includes(ToolTags.WRITE) &&
        policyConfig.write_requires_approval);

    if (needsApproval && !context.approvalId && approvalStore?.createApproval) {
      const approval = approvalStore.createApproval({
        ruleId: "tool_tag_policy",
        path: `/tools/${toolName}`,
        method: context.method || "POST",
        body: args,
        requestedBy: context.user || "agent",
        toolName: toolName,
        explanation: args.explanation || "No explanation provided",
      });

      return {
        ok: false,
        status: "approval_required",
        tool: toolName,
        explanation: args.explanation || "Tool requires manual approval",
        parameters: args,
        approval: {
          id: approval.id,
          status: "pending",
          createdAt: approval.createdAt,
        },
        message: `Tool '${toolName}' requires approval. Use POST /approve with id '${approval.id}' to confirm.`,
      };
    }

    // Verify pre-approved ID
    if (context.approvalId && approvalStore?.getApproval) {
      const approval = approvalStore.getApproval(context.approvalId);
      if (!approval) {
        return {
          ok: false,
          error: {
            code: "approval_not_found",
            message: `Approval ID not found: ${context.approvalId}`,
          },
        };
      }
      if (approval.status !== "approved") {
        return {
          ok: false,
          error: {
            code: "approval_pending",
            message: `Approval not granted for ID: ${context.approvalId}`,
            approval: {
              id: approval.id,
              status: approval.status,
            },
          },
        };
      }
    }

    return null; // Continue to tool execution
  });

  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /policy/rules
   */
  router.get("/rules", requireScope("read"), (_req, res) => {
    const rules = listRules();
    res.json({ ok: true, count: rules.length, rules });
  });

  /**
   * POST /policy/rules
   */
  router.post("/rules", requireScope("danger"), (req, res) => {
    const data = validate(ruleSchema, req.body, res);
    if (!data) return;

    if (data.action === "rate_limit" && (!data.limit || !data.window)) {
      return res.status(400).json({
        ok:      false,
        error:   "invalid_request",
        message: "rate_limit action requires both 'limit' (number) and 'window' (e.g. '1h', '1d') fields",
      });
    }

    const rule = addRule(data);
    res.status(201).json({ ok: true, rule });
  });

  /**
   * DELETE /policy/rules/:id
   */
  router.delete("/rules/:id", requireScope("danger"), (req, res) => {
    const existed = removeRule(req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.id });
  });

  /**
   * GET /policy/approvals
   * Optional filter: ?status=pending|approved|rejected
   */
  router.get("/approvals", requireScope("read"), (req, res) => {
    const { status } = req.query;
    const approvals = listApprovals({ status });
    res.json({ ok: true, count: approvals.length, approvals });
  });

  /**
   * GET /approvals/pending
   * Convenience endpoint for listing only pending approvals
   */
  router.get("/approvals/pending", requireScope("read"), (req, res) => {
    const approvals = listApprovals({ status: "pending" });
    res.json({ ok: true, count: approvals.length, approvals });
  });

  /**
   * POST /policy/approvals/:id/approve
   */
  router.post("/approvals/:id/approve", requireScope("danger"), (req, res) => {
    const approval = updateApprovalStatus(req.params.id, "approved");
    if (!approval) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, approval });
  });

  /**
   * POST /policy/approvals/:id/reject
   */
  router.post("/approvals/:id/reject", requireScope("danger"), (req, res) => {
    const approval = updateApprovalStatus(req.params.id, "rejected");
    if (!approval) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, approval });
  });

  /**
   * POST /approve (alias for /policy/approvals/:id/approve)
   * Simple endpoint for tool approval
   */
  router.post("/approve", requireScope("danger"), async (req, res) => {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ ok: false, error: "invalid_request", message: "id is required" });
    }
    
    // Import approveTool from tool-registry dynamically to avoid circular deps
    const { approveTool } = await import("../../core/tool-registry.js");
    const result = await approveTool(id, {
      ...toolContextFromRequest(req),
      user: req.user || "manual",
    });
    
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  });

  /**
   * GET /policy/presets
   * Returns built-in preset rules (not yet loaded).
   */
  router.get("/presets", requireScope("read"), (_req, res) => {
    try {
      const raw = readFileSync(join(__dirname, "presets.json"), "utf8");
      const { presets } = JSON.parse(raw);
      res.json({ ok: true, count: presets.length, presets });
    } catch {
      res.json({ ok: true, count: 0, presets: [] });
    }
  });

  /**
   * POST /policy/rules/load-preset
   * Load a preset rule by id into active rules.
   */
  router.post("/rules/load-preset", requireScope("danger"), (req, res) => {
    const presetId = req.body?.presetId ?? req.body?.id;
    if (!presetId) {
      return res.status(400).json({ ok: false, error: "invalid_request", message: "presetId required" });
    }
    try {
      const raw = readFileSync(join(__dirname, "presets.json"), "utf8");
      const { presets } = JSON.parse(raw);
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) {
        return res.status(404).json({ ok: false, error: "not_found", message: `Preset "${presetId}" not found` });
      }
      const rule = addRule({
        pattern:     preset.pattern,
        action:      preset.action,
        description: preset.description ?? "",
      });
      res.status(201).json({ ok: true, rule, loadedFrom: presetId });
    } catch (err) {
      res.status(500).json({ ok: false, error: "internal_error", message: err.message });
    }
  });

  /**
   * POST /policy/evaluate
   * Test a hypothetical request against all policies without executing.
   */
  router.post("/evaluate", requireScope("read"), (req, res) => {
    const data = validate(evaluateSchema, req.body, res);
    if (!data) return;

    const result = evaluate(data.method, data.path, data.body, "manual-test");
    res.json({ ok: true, result });
  });

  /**
   * POST /policy/simulate
   * Same as evaluate but with explicit explanation field (alias).
   */
  router.post("/simulate", requireScope("read"), (req, res) => {
    const data = validate(evaluateSchema.extend({ project: z.string().optional() }), req.body, res);
    if (!data) return;

    const result = evaluate(data.method, data.path, data.body, data.project ?? "manual-test");
    res.json({ ok: true, result, explanation: result.explanation });
  });

  app.use("/policy", router);
}
