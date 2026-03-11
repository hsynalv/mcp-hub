/**
 * Git Plugin
 *
 * Git operations: status, diff, branch, add, commit, push, pull, stash.
 * All paths validated against WORKSPACE_BASE.
 */

import { Router } from "express";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog, generateCorrelationId } from "../../core/audit/index.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import {
  gitStatus,
  gitDiff,
  gitBranchCreate,
  gitBranchList,
  gitCheckout,
  gitLog,
  gitAdd,
  gitCommit,
  gitPush,
  gitPull,
  gitStash,
  safeRepoPath,
} from "./git.core.js";

const handleError = createPluginErrorHandler("git");

export const metadata = createMetadata({
  name:        "git",
  version:     "1.0.0",
  description: "Git repository operations: status, diff, branch, commit, push, pull, stash.",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.HIGH,
  capabilities: ["read", "write"],
  requires:    [],
  tags:        ["git", "version-control", "repository"],
  endpoints: [
    { method: "GET",  path: "/git/health",   description: "Plugin health",          scope: "read"  },
    { method: "GET",  path: "/git/status",   description: "Repository status",      scope: "read"  },
    { method: "GET",  path: "/git/diff",     description: "Diff of changes",        scope: "read"  },
    { method: "GET",  path: "/git/log",      description: "Commit history",         scope: "read"  },
    { method: "GET",  path: "/git/branches", description: "List branches",          scope: "read"  },
    { method: "POST", path: "/git/branch",   description: "Create branch",          scope: "write" },
    { method: "POST", path: "/git/checkout", description: "Checkout branch",        scope: "write" },
    { method: "POST", path: "/git/add",      description: "Stage files",            scope: "write" },
    { method: "POST", path: "/git/commit",   description: "Commit staged changes",  scope: "write" },
    { method: "POST", path: "/git/push",     description: "Push to remote",         scope: "write" },
    { method: "POST", path: "/git/pull",     description: "Pull from remote",       scope: "write" },
    { method: "POST", path: "/git/stash",    description: "Stash or pop changes",   scope: "write" },
  ],
  notes: "WORKSPACE_BASE env var controls which repositories are accessible.",
});

// ── Audit helper ──────────────────────────────────────────────────────────────

async function gitAudit({ operation, actor, repoPath, success, error, reason }) {
  try {
    await auditLog({
      plugin: "git",
      operation,
      actor: actor || "anonymous",
      correlationId: generateCorrelationId(),
      success,
      error: error ? String(error) : undefined,
      repoPath,
      ...(reason && { reason }),
    });
  } catch { /* never crash on audit failure */ }
}

// ── Path validation helper ────────────────────────────────────────────────────

function validatedPath(reqPath) {
  const repoPath = reqPath || ".";
  return safeRepoPath(repoPath);
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "git_status",
    description: "Get git repository status (branch, staged, unstaged, untracked files)",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path (default: current)", default: "." },
      },
    },
    handler: async (args) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      return gitStatus(v.path);
    },
  },
  {
    name: "git_diff",
    description: "Get diff of unstaged or staged changes",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string",  description: "Repository path", default: "." },
        staged: { type: "boolean", description: "Show staged changes", default: false },
      },
    },
    handler: async (args) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      return gitDiff(v.path, { staged: args.staged });
    },
  },
  {
    name: "git_log",
    description: "Get recent commit history",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:  { type: "string", description: "Repository path", default: "." },
        limit: { type: "number", description: "Number of commits", default: 10 },
      },
    },
    handler: async (args) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      return gitLog(v.path, { limit: args.limit });
    },
  },
  {
    name: "git_branch_list",
    description: "List branches in the repository",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string",  description: "Repository path", default: "." },
        remote: { type: "boolean", description: "List remote branches", default: false },
        all:    { type: "boolean", description: "List all branches (local + remote)", default: false },
      },
    },
    handler: async (args) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      return gitBranchList(v.path, { remote: args.remote, all: args.all });
    },
  },
  {
    name: "git_branch_create",
    description: "Create and checkout a new branch",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        name: { type: "string", description: "New branch name" },
        base: { type: "string", description: "Base branch (default: current)" },
        explanation: { type: "string", description: "Optional: why you're creating this branch (audit reason)" },
      },
      required: ["name"],
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitBranchCreate(v.path, args.name, args.base);
      await gitAudit({ operation: "branch_create", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_checkout",
    description: "Checkout an existing branch",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string", description: "Repository path", default: "." },
        branch: { type: "string", description: "Branch name to checkout" },
        explanation: { type: "string", description: "Optional: why you're checking out (audit reason)" },
      },
      required: ["branch"],
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitCheckout(v.path, args.branch);
      await gitAudit({ operation: "checkout", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_add",
    description: "Stage files for commit. Pass specific files or '.' to stage everything.",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:  { type: "string", description: "Repository path", default: "." },
        files: { type: "array", items: { type: "string" }, description: "Files to stage (default: all)", default: ["."] },
        explanation: { type: "string", description: "Optional: why you're staging (audit reason)" },
      },
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitAdd(v.path, args.files || ["."]);
      await gitAudit({ operation: "add", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_commit",
    description: "Commit staged changes",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:    { type: "string", description: "Repository path", default: "." },
        message: { type: "string", description: "Commit message" },
        files:   { type: "array", items: { type: "string" }, description: "Specific files to stage and commit" },
        explanation: { type: "string", description: "Optional: why you're committing (audit reason)" },
      },
      required: ["message"],
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitCommit(v.path, args.message, { files: args.files });
      await gitAudit({ operation: "commit", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_push",
    description: "Push commits to remote repository",
    tags: [ToolTags.WRITE, ToolTags.GIT, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string", description: "Repository path", default: "." },
        remote: { type: "string", description: "Remote name", default: "origin" },
        branch: { type: "string", description: "Branch to push (default: current)" },
        explanation: { type: "string", description: "Optional: why you're pushing (audit reason)" },
      },
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitPush(v.path, { remote: args.remote, branch: args.branch });
      await gitAudit({ operation: "push", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_pull",
    description: "Pull changes from remote repository",
    tags: [ToolTags.WRITE, ToolTags.GIT, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string", description: "Repository path", default: "." },
        remote: { type: "string", description: "Remote name", default: "origin" },
        branch: { type: "string", description: "Branch to pull (default: current)" },
        explanation: { type: "string", description: "Optional: why you're pulling (audit reason)" },
      },
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitPull(v.path, { remote: args.remote, branch: args.branch });
      await gitAudit({ operation: "pull", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
  {
    name: "git_stash",
    description: "Stash current changes or pop the last stash",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:    { type: "string",  description: "Repository path", default: "." },
        pop:     { type: "boolean", description: "Pop the most recent stash instead of pushing", default: false },
        message: { type: "string",  description: "Stash message (only for push)" },
        explanation: { type: "string", description: "Optional: why you're stashing (audit reason)" },
      },
    },
    handler: async (args, context = {}) => {
      const v = validatedPath(args.path);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      const result = await gitStash(v.path, { pop: args.pop, message: args.message });
      await gitAudit({ operation: args.pop ? "stash_pop" : "stash_push", actor: context.actor, repoPath: v.path, success: result.ok, reason: args.explanation });
      return result;
    },
  },
];

// ── REST Routes ───────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      const { execSync } = await import("child_process");
      let gitVersion = "unknown";
      try { gitVersion = execSync("git --version", { encoding: "utf-8" }).trim(); } catch { /* noop */ }
      res.json({ ok: true, plugin: "git", version: "1.0.0", git: gitVersion });
    } catch (err) {
      res.status(500).json(handleError(err, "health"));
    }
  });

  router.get("/status", requireScope("read"), async (req, res) => {
    const v = validatedPath(req.query.path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitStatus(v.path);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/diff", requireScope("read"), async (req, res) => {
    const v = validatedPath(req.query.path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitDiff(v.path, { staged: req.query.staged === "true" });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/log", requireScope("read"), async (req, res) => {
    const v = validatedPath(req.query.path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitLog(v.path, { limit: parseInt(req.query.limit, 10) || 10 });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/branches", requireScope("read"), async (req, res) => {
    const v = validatedPath(req.query.path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitBranchList(v.path, { remote: req.query.remote === "true", all: req.query.all === "true" });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/branch", requireScope("write"), async (req, res) => {
    const { path, name, base } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: { code: "missing_name", message: "Branch name required" } });
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitBranchCreate(v.path, name, base);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/checkout", requireScope("write"), async (req, res) => {
    const { path, branch } = req.body;
    if (!branch) return res.status(400).json({ ok: false, error: { code: "missing_branch", message: "Branch name required" } });
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitCheckout(v.path, branch);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/add", requireScope("write"), async (req, res) => {
    const { path, files } = req.body;
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitAdd(v.path, files || ["."]);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/commit", requireScope("write"), async (req, res) => {
    const { path, message, files } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: { code: "missing_message", message: "Commit message required" } });
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitCommit(v.path, message, { files });
    await gitAudit({ operation: "commit", actor: req.user?.sub, repoPath: v.path, success: result.ok });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/push", requireScope("write"), async (req, res) => {
    const { path, remote, branch } = req.body;
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitPush(v.path, { remote, branch });
    await gitAudit({ operation: "push", actor: req.user?.sub, repoPath: v.path, success: result.ok });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/pull", requireScope("write"), async (req, res) => {
    const { path, remote, branch } = req.body;
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitPull(v.path, { remote, branch });
    await gitAudit({ operation: "pull", actor: req.user?.sub, repoPath: v.path, success: result.ok });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/stash", requireScope("write"), async (req, res) => {
    const { path, pop, message } = req.body;
    const v = validatedPath(path);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    const result = await gitStash(v.path, { pop, message });
    await gitAudit({ operation: pop ? "stash_pop" : "stash_push", actor: req.user?.sub, repoPath: v.path, success: result.ok });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.use("/git", router);
}
