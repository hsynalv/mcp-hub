/**
 * Workspace Plugin
 *
 * File operations within configured workspace root with audit logging.
 */

import { Router } from "express";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import {
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  patchFile,
  validateWorkspacePath,
  extractContext,
  auditEntry,
  generateCorrelationId,
  getAuditLogEntries,
} from "./workspace.core.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginError = createPluginErrorHandler("workspace");

export const metadata = createMetadata({
  name: "workspace",
  version: "1.0.0",
  description: "File operations within configured workspace root with audit logging",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "delete", "file", "search", "audit"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  tags: ["workspace", "files", "filesystem", "local"],
  dependencies: [],
  since: "1.0.0",
  notes: "All file operations are constrained to workspace root directory.",
});

export const name = "workspace";
export const version = "1.0.0";
export const description = "File operations within workspace root";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "GET", path: "/workspace/read", description: "Read file contents", scope: "read" },
  { method: "POST", path: "/workspace/write", description: "Write file contents", scope: "write" },
  { method: "GET", path: "/workspace/list", description: "List directory contents", scope: "read" },
  { method: "GET", path: "/workspace/search", description: "Search files by pattern", scope: "read" },
  { method: "POST", path: "/workspace/patch", description: "Apply patch to file", scope: "write" },
  { method: "GET", path: "/workspace/audit", description: "View audit log", scope: "read" },
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "workspace_read_file",
    description: "Read contents of a file within the workspace",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to file" },
        maxSize: { type: "number", description: "Max bytes to read (default 1MB)" },
      },
      required: ["path"],
    },
    handler: async (args) => readFile(args.path, { maxSize: args.maxSize }),
  },
  {
    name: "workspace_write_file",
    description: "Write content to a file within the workspace",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to file" },
        content: { type: "string", description: "File content to write" },
        createDirs: { type: "boolean", description: "Create parent directories if missing", default: true },
      },
      required: ["path", "content"],
    },
    handler: async (args) => writeFile(args.path, args.content, { createDirs: args.createDirs }),
  },
  {
    name: "workspace_list",
    description: "List contents of a directory",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: workspace root)", default: "." },
      },
    },
    handler: async (args) => listDirectory(args.path),
  },
  {
    name: "workspace_search",
    description: "Search files by name pattern",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (substring match)" },
        root: { type: "string", description: "Search root directory", default: "." },
      },
      required: ["pattern"],
    },
    handler: async (args) => searchFiles(args.pattern, { root: args.root }),
  },
  {
    name: "workspace_patch",
    description: "Apply search/replace patch to file",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to file" },
        search: { type: "string", description: "Text to search for" },
        replace: { type: "string", description: "Replacement text" },
      },
      required: ["path", "search", "replace"],
    },
    handler: async (args) => {
      const patch = `${args.search}===REPLACE===${args.replace}`;
      return patchFile(args.path, patch, { mode: "search-replace" });
    },
  },
];

// ── REST Routes ───────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // GET /workspace/read?path=...
  router.get("/read", async (req, res) => {
    const path = req.query.path;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path) {
      const err = pluginError.validation("path query parameter required", { code: "missing_path" });
      auditEntry({
        operation: "read",
        path: "(missing)",
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        reason: "missing_path",
      });
      return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    const result = await readFile(path, { maxSize: parseInt(req.query.maxSize, 10) || undefined });

    auditEntry({
      operation: "read",
      path,
      allowed: result.ok,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      reason: result.ok ? null : result.error?.code,
      error: result.ok ? null : result.error?.message,
      metadata: result.ok ? { size: result.data?.size, truncated: result.data?.truncated } : null,
    });

    const statusCode = result.ok ? 200 : result.error?.code === "file_not_found" ? 404 : 400;
    res.status(statusCode).json(result);
  });

  // POST /workspace/write
  router.post("/write", async (req, res) => {
    const { path, content, createDirs } = req.body;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path || content === undefined) {
      const err = pluginError.validation("path and content required", { code: "missing_fields" });
      auditEntry({
        operation: "write",
        path: path || "(missing)",
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        reason: "missing_fields",
      });
      return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    const result = await writeFile(path, content, { createDirs: createDirs !== false });

    auditEntry({
      operation: "write",
      path,
      allowed: result.ok,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      reason: result.ok ? null : result.error?.code,
      error: result.ok ? null : result.error?.message,
      metadata: result.ok ? { bytesWritten: result.data?.bytesWritten, created: result.data?.created } : null,
    });

    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /workspace/list?path=...
  router.get("/list", async (req, res) => {
    const path = req.query.path || ".";
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    const result = await listDirectory(path);

    auditEntry({
      operation: "list",
      path,
      allowed: result.ok,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      reason: result.ok ? null : result.error?.code,
      error: result.ok ? null : result.error?.message,
      metadata: result.ok ? { count: result.data?.count } : null,
    });

    const statusCode = result.ok ? 200 : result.error?.code === "directory_not_found" ? 404 : 400;
    res.status(statusCode).json(result);
  });

  // GET /workspace/search?pattern=...&root=...
  router.get("/search", async (req, res) => {
    const pattern = req.query.pattern;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!pattern) {
      const err = pluginError.validation("pattern query parameter required", { code: "missing_pattern" });
      auditEntry({
        operation: "search",
        path: req.query.root || ".",
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        reason: "missing_pattern",
      });
      return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    const result = await searchFiles(pattern, { root: req.query.root });

    auditEntry({
      operation: "search",
      path: req.query.root || ".",
      allowed: result.ok,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      reason: result.ok ? null : result.error?.code,
      error: result.ok ? null : result.error?.message,
      metadata: result.ok ? { total: result.data?.total, truncated: result.data?.truncated } : null,
    });

    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /workspace/patch
  router.post("/patch", async (req, res) => {
    const { path, search, replace } = req.body;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path || !search || replace === undefined) {
      const err = pluginError.validation("path, search, and replace required", { code: "missing_fields" });
      auditEntry({
        operation: "patch",
        path: path || "(missing)",
        allowed: false,
        actor: context.actor,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        correlationId,
        durationMs: Date.now() - startTime,
        reason: "missing_fields",
      });
      return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    const patch = `${search}===REPLACE===${replace}`;
    const result = await patchFile(path, patch, { mode: "search-replace" });

    auditEntry({
      operation: "patch",
      path,
      allowed: result.ok,
      actor: context.actor,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      reason: result.ok ? null : result.error?.code,
      error: result.ok ? null : result.error?.message,
      metadata: result.ok ? { originalSize: result.data?.originalSize, newSize: result.data?.newSize, changed: result.data?.changed } : null,
    });

    const statusCode = result.ok ? 200 : result.error?.code === "file_not_found" ? 404 : 400;
    res.status(statusCode).json(result);
  });

  // GET /workspace/audit
  router.get("/audit", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/workspace", router);
}
