/**
 * Git Plugin
 *
 * Git operations: status, diff, branch, commit, log, push
 */

import { Router } from "express";
import {
  gitStatus,
  gitDiff,
  gitBranchCreate,
  gitCheckout,
  gitLog,
  gitAdd,
  gitCommit,
  gitPush,
} from "./git.core.js";
import { ToolTags } from "../../core/tool-registry.js";

export const name = "git";
export const version = "1.0.0";
export const description = "Git operations for repository management";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "GET", path: "/git/status", description: "Get repository status", scope: "read" },
  { method: "GET", path: "/git/diff", description: "Get diff of changes", scope: "read" },
  { method: "POST", path: "/git/branch", description: "Create new branch", scope: "write" },
  { method: "POST", path: "/git/checkout", description: "Checkout branch", scope: "write" },
  { method: "GET", path: "/git/log", description: "Get commit log", scope: "read" },
  { method: "POST", path: "/git/commit", description: "Commit changes", scope: "write" },
  { method: "POST", path: "/git/push", description: "Push commits", scope: "write" },
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "git_status",
    description: "Get git repository status (branch, staged, unstaged, untracked)",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path (default: current)", default: "." },
      },
    },
    handler: async (args) => gitStatus(args.path || "."),
  },
  {
    name: "git_diff",
    description: "Get diff of unstaged or staged changes",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        staged: { type: "boolean", description: "Show staged changes", default: false },
      },
    },
    handler: async (args) => gitDiff(args.path || ".", { staged: args.staged }),
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
      },
      required: ["name"],
    },
    handler: async (args) => gitBranchCreate(args.path || ".", args.name, args.base),
  },
  {
    name: "git_checkout",
    description: "Checkout an existing branch",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        branch: { type: "string", description: "Branch name to checkout" },
      },
      required: ["branch"],
    },
    handler: async (args) => gitCheckout(args.path || ".", args.branch),
  },
  {
    name: "git_log",
    description: "Get recent commit history",
    tags: [ToolTags.READ, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        limit: { type: "number", description: "Number of commits", default: 10 },
      },
    },
    handler: async (args) => gitLog(args.path || ".", { limit: args.limit }),
  },
  {
    name: "git_commit",
    description: "Commit staged changes (requires approval for WRITE)",
    tags: [ToolTags.WRITE, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        message: { type: "string", description: "Commit message" },
        files: { type: "array", items: { type: "string" }, description: "Specific files to stage and commit" },
      },
      required: ["message"],
    },
    handler: async (args) => gitCommit(args.path || ".", args.message, { files: args.files }),
  },
  {
    name: "git_push",
    description: "Push commits to remote (requires approval for WRITE)",
    tags: [ToolTags.WRITE, ToolTags.GIT, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path", default: "." },
        remote: { type: "string", description: "Remote name", default: "origin" },
        branch: { type: "string", description: "Branch to push (default: current)" },
      },
    },
    handler: async (args) => gitPush(args.path || ".", { remote: args.remote, branch: args.branch }),
  },
];

// ── REST Routes ───────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // GET /git/status?path=...
  router.get("/status", async (req, res) => {
    const result = await gitStatus(req.query.path || ".");
    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /git/diff?path=...&staged=true
  router.get("/diff", async (req, res) => {
    const result = await gitDiff(req.query.path || ".", { staged: req.query.staged === "true" });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /git/branch { path, name, base }
  router.post("/branch", async (req, res) => {
    const { path, name, base } = req.body;
    if (!name) {
      return res.status(400).json({ ok: false, error: { code: "missing_name", message: "Branch name required" } });
    }
    const result = await gitBranchCreate(path || ".", name, base);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /git/checkout { path, branch }
  router.post("/checkout", async (req, res) => {
    const { path, branch } = req.body;
    if (!branch) {
      return res.status(400).json({ ok: false, error: { code: "missing_branch", message: "Branch name required" } });
    }
    const result = await gitCheckout(path || ".", branch);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /git/log?path=...&limit=10
  router.get("/log", async (req, res) => {
    const result = await gitLog(req.query.path || ".", { limit: parseInt(req.query.limit, 10) || 10 });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /git/commit { path, message, files }
  router.post("/commit", async (req, res) => {
    const { path, message, files } = req.body;
    if (!message) {
      return res.status(400).json({ ok: false, error: { code: "missing_message", message: "Commit message required" } });
    }
    const result = await gitCommit(path || ".", message, { files });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /git/push { path, remote, branch }
  router.post("/push", async (req, res) => {
    const result = await gitPush(req.body.path || ".", { remote: req.body.remote, branch: req.body.branch });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.use("/git", router);
}
