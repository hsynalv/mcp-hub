/**
 * Workspace Plugin
 *
 * File operations within configured workspace root.
 */

import { Router } from "express";
import {
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  patchFile,
  validateWorkspacePath,
} from "./workspace.core.js";
import { ToolTags } from "../../core/tool-registry.js";

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
    if (!path) {
      return res.status(400).json({ ok: false, error: { code: "missing_path", message: "path query parameter required" } });
    }

    const result = await readFile(path, { maxSize: parseInt(req.query.maxSize, 10) || undefined });
    res.status(result.ok ? 200 : result.error?.code === "file_not_found" ? 404 : 400).json(result);
  });

  // POST /workspace/write
  router.post("/write", async (req, res) => {
    const { path, content, createDirs } = req.body;
    if (!path || content === undefined) {
      return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "path and content required" } });
    }

    const result = await writeFile(path, content, { createDirs: createDirs !== false });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /workspace/list?path=...
  router.get("/list", async (req, res) => {
    const result = await listDirectory(req.query.path || ".");
    res.status(result.ok ? 200 : result.error?.code === "directory_not_found" ? 404 : 400).json(result);
  });

  // GET /workspace/search?pattern=...&root=...
  router.get("/search", async (req, res) => {
    const pattern = req.query.pattern;
    if (!pattern) {
      return res.status(400).json({ ok: false, error: { code: "missing_pattern", message: "pattern query parameter required" } });
    }

    const result = await searchFiles(pattern, { root: req.query.root });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /workspace/patch
  router.post("/patch", async (req, res) => {
    const { path, search, replace } = req.body;
    if (!path || !search || replace === undefined) {
      return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "path, search, and replace required" } });
    }

    const patch = `${search}===REPLACE===${replace}`;
    const result = await patchFile(path, patch, { mode: "search-replace" });
    res.status(result.ok ? 200 : result.error?.code === "file_not_found" ? 404 : 400).json(result);
  });

  app.use("/workspace", router);
}
