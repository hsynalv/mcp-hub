/**
 * Workspace Plugin
 *
 * File operations within configured workspace root with audit logging.
 */

import { Router } from "express";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { requireScope } from "../../core/auth.js";
import { auditLog, getAuditManager, generateCorrelationId } from "../../core/audit/index.js";
import {
  readFile,
  writeFile,
  deleteFile,
  moveFile,
  listDirectory,
  searchFiles,
  patchFile,
  validateWorkspacePath,
  extractContext,
} from "./workspace.core.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginError = createPluginErrorHandler("workspace");

/** Emit workspace operation to core audit (no throw). */
async function wsAudit(entry) {
  await auditLog({
    plugin: "workspace",
    operation: entry.operation,
    actor: entry.actor || "mcp",
    workspaceId: entry.workspaceId || "global",
    projectId: entry.projectId ?? null,
    correlationId: entry.correlationId || generateCorrelationId(),
    allowed: entry.allowed,
    success: entry.success !== undefined ? entry.success : entry.allowed,
    durationMs: entry.durationMs ?? 0,
    ...(entry.reason && { reason: entry.reason }),
    ...(entry.error && { error: entry.error }),
    ...(entry.metadata && { metadata: entry.metadata }),
    ...((entry.path || entry.resource) && { resource: entry.path || entry.resource }),
  });
}

export const metadata = createMetadata({
  name:        "workspace",
  version:     "1.0.0",
  description: "Safe file CRUD within a configured workspace root. All paths are validated against WORKSPACE_ROOT.",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.MEDIUM,
  capabilities: ["read", "write"],
  requires:    [],
  tags:        ["workspace", "files", "filesystem", "local"],
  endpoints: [
    { method: "GET",    path: "/workspace/health", description: "Plugin health",               scope: "read"  },
    { method: "GET",    path: "/workspace/read",   description: "Read file contents",          scope: "read"  },
    { method: "POST",   path: "/workspace/write",  description: "Write file contents",         scope: "write" },
    { method: "DELETE", path: "/workspace/file",   description: "Delete a file",               scope: "write" },
    { method: "POST",   path: "/workspace/move",   description: "Move/rename a file",          scope: "write" },
    { method: "GET",    path: "/workspace/list",   description: "List directory contents",     scope: "read"  },
    { method: "GET",    path: "/workspace/search", description: "Search files by pattern",     scope: "read"  },
    { method: "POST",   path: "/workspace/patch",  description: "Apply search/replace patch",  scope: "write" },
    { method: "GET",    path: "/workspace/audit",  description: "View audit log",              scope: "read"  },
  ],
  notes: "All file operations are constrained to WORKSPACE_ROOT. Path traversal is blocked.",
});


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
    handler: async (args, context = {}) => {
      const result = await readFile(args.path, { maxSize: args.maxSize });
      await wsAudit({ operation: "read", path: args.path, allowed: result.ok, actor: context.actor || "mcp", correlationId: generateCorrelationId(), durationMs: 0 });
      return result;
    },
  },
  {
    name: "workspace_write_file",
    description: "Write content to a file within the workspace",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string",  description: "Relative path to file" },
        content:    { type: "string",  description: "File content to write" },
        createDirs: { type: "boolean", description: "Create parent directories if missing", default: true },
        explanation: { type: "string", description: "Optional: why you're writing this file (audit reason)" },
      },
      required: ["path", "content"],
    },
    handler: async (args, context = {}) => {
      const result = await writeFile(args.path, args.content, { createDirs: args.createDirs });
      await wsAudit({ operation: "write", path: args.path, allowed: result.ok, actor: context.actor || "mcp", correlationId: generateCorrelationId(), durationMs: 0, ...(args.explanation && { reason: args.explanation }) });
      return result;
    },
  },
  {
    name: "workspace_delete_file",
    description: "Delete a file within the workspace. Cannot delete directories.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to file to delete" },
        explanation: { type: "string", description: "Optional: why you're deleting (audit reason)" },
      },
      required: ["path"],
    },
    handler: async (args, context = {}) => {
      const result = await deleteFile(args.path);
      await wsAudit({ operation: "delete", path: args.path, allowed: result.ok, actor: context.actor || "mcp", correlationId: generateCorrelationId(), durationMs: 0, ...(args.explanation && { reason: args.explanation }) });
      return result;
    },
  },
  {
    name: "workspace_move_file",
    description: "Move or rename a file within the workspace. Both source and destination must be inside the workspace root.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source path (relative)" },
        to:   { type: "string", description: "Destination path (relative)" },
        explanation: { type: "string", description: "Optional: why you're moving (audit reason)" },
      },
      required: ["from", "to"],
    },
    handler: async (args, context = {}) => {
      const result = await moveFile(args.from, args.to);
      await wsAudit({ operation: "move", path: `${args.from} → ${args.to}`, allowed: result.ok, actor: context.actor || "mcp", correlationId: generateCorrelationId(), durationMs: 0, ...(args.explanation && { reason: args.explanation }) });
      return result;
    },
  },
  {
    name: "workspace_list",
    description: "List contents of a directory within the workspace",
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
    description: "Search files by name pattern within the workspace",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (substring match)" },
        root:    { type: "string", description: "Search root directory", default: "." },
      },
      required: ["pattern"],
    },
    handler: async (args) => searchFiles(args.pattern, { root: args.root }),
  },
  {
    name: "workspace_patch",
    description: "Apply a search/replace patch to a file within the workspace",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path:    { type: "string", description: "Path to file" },
        search:  { type: "string", description: "Text to search for" },
        replace: { type: "string", description: "Replacement text" },
        explanation: { type: "string", description: "Optional: why you're patching (audit reason)" },
      },
      required: ["path", "search", "replace"],
    },
    handler: async (args, context = {}) => {
      const patch  = `${args.search}===REPLACE===${args.replace}`;
      const result = await patchFile(args.path, patch, { mode: "search-replace" });
      await wsAudit({ operation: "patch", path: args.path, allowed: result.ok, actor: context.actor || "mcp", correlationId: generateCorrelationId(), durationMs: 0, ...(args.explanation && { reason: args.explanation }) });
      return result;
    },
  },
  {
    name: "workspace_audit",
    description: "View the workspace operation audit log (reads, writes, deletes, patches).",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries to return (default 50, max 100)", default: 50 },
      },
    },
    handler: async (args) => {
      const limit   = Math.min(args.limit || 50, 100);
      const manager = getAuditManager();
      if (!manager.initialized) await manager.init();
      const entries = await manager.getRecentEntries({ plugin: "workspace", limit });
      return { ok: true, data: { audit: entries, total: entries.length } };
    },
  },
];

// ── REST Routes ───────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      const { homedir } = await import("os");
      const { join }    = await import("path");
      const root = process.env.WORKSPACE_ROOT || join(homedir(), "Projects");
      let rootExists = false;
      try { await (await import("fs/promises")).access(root); rootExists = true; } catch { /* noop */ }
      res.json({ ok: true, plugin: "workspace", version: "1.0.0", root, rootExists });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /workspace/read?path=...
  router.get("/read", requireScope("read"), async (req, res) => {
    const path = req.query.path;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path) {
      const err = pluginError.validation("path query parameter required", { code: "missing_path" });
      await wsAudit({
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

    await wsAudit({
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
  router.post("/write", requireScope("write"), async (req, res) => {
    const { path, content, createDirs } = req.body;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path || content === undefined) {
      const err = pluginError.validation("path and content required", { code: "missing_fields" });
      await wsAudit({
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

    await wsAudit({
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
  router.get("/list", requireScope("read"), async (req, res) => {
    const path = req.query.path || ".";
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    const result = await listDirectory(path);

    await wsAudit({
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
  router.get("/search", requireScope("read"), async (req, res) => {
    const pattern = req.query.pattern;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!pattern) {
      const err = pluginError.validation("pattern query parameter required", { code: "missing_pattern" });
      await wsAudit({
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

    await wsAudit({
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
  router.post("/patch", requireScope("write"), async (req, res) => {
    const { path, search, replace } = req.body;
    const context = extractContext(req);
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    if (!path || !search || replace === undefined) {
      const err = pluginError.validation("path, search, and replace required", { code: "missing_fields" });
      await wsAudit({
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

    await wsAudit({
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

  // DELETE /workspace/file?path=...
  router.delete("/file", requireScope("write"), async (req, res) => {
    const path    = req.query.path;
    const context = extractContext(req);
    const correlationId = generateCorrelationId();
    const startTime = Date.now();

    if (!path) {
      return res.status(400).json({ ok: false, error: { code: "missing_path", message: "path query parameter required" } });
    }

    const result = await deleteFile(path);
    await wsAudit({ operation: "delete", path, allowed: result.ok, actor: context.actor, workspaceId: context.workspaceId, correlationId, durationMs: Date.now() - startTime });
    res.status(result.ok ? 200 : result.error?.code === "file_not_found" ? 404 : 400).json(result);
  });

  // POST /workspace/move
  router.post("/move", requireScope("write"), async (req, res) => {
    const { from, to } = req.body;
    const context = extractContext(req);
    const correlationId = generateCorrelationId();
    const startTime = Date.now();

    if (!from || !to) {
      return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "from and to required" } });
    }

    const result = await moveFile(from, to);
    await wsAudit({ operation: "move", path: `${from} → ${to}`, allowed: result.ok, actor: context.actor, workspaceId: context.workspaceId, correlationId, durationMs: Date.now() - startTime });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /workspace/audit
  router.get("/audit", requireScope("read"), async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const manager = getAuditManager();
    if (!manager.initialized) await manager.init();
    const entries = await manager.getRecentEntries({ plugin: "workspace", limit });
    res.json({ ok: true, data: { audit: entries } });
  });

  app.use("/workspace", router);
}
