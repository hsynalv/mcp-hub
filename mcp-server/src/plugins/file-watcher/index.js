/**
 * File Watcher Plugin
 *
 * Watch directories for changes and trigger actions.
 * Integrates with AI orchestrator for auto-code-generation.
 */

import { Router } from "express";
import { watch } from "fs";
import { resolve, relative } from "path";
import { ToolTags } from "../../core/tool-registry.js";

// Active watchers registry
const watchers = new Map(); // id -> { watcher, path, options, createdAt }
let watcherIdCounter = 0;

/**
 * Create a file watcher
 */
function createWatcher(basePath, options = {}) {
  const {
    recursive = true,
    ignore = ["node_modules", ".git", "dist", "build", ".next", "coverage"],
    onChange = null,
  } = options;

  const absolutePath = resolve(basePath);
  const id = `watcher_${++watcherIdCounter}`;

  const watcher = watch(absolutePath, { recursive }, (eventType, filename) => {
    if (!filename) return;

    // Check ignore patterns
    const shouldIgnore = ignore.some((pattern) =>
      filename.includes(pattern)
    );
    if (shouldIgnore) return;

    const change = {
      id: `${id}_${Date.now()}`,
      watcherId: id,
      timestamp: new Date().toISOString(),
      event: eventType, // 'rename' or 'change'
      path: filename,
      fullPath: resolve(absolutePath, filename),
    };

    // Call handler if provided
    if (onChange) {
      onChange(change);
    }
  });

  const watcherInfo = {
    id,
    watcher,
    path: absolutePath,
    options,
    createdAt: new Date().toISOString(),
    status: "active",
    changes: [], // Last 100 changes
  };

  watchers.set(id, watcherInfo);

  // Keep only last 100 changes
  const originalHandler = onChange;
  watcherInfo._handler = (change) => {
    watcherInfo.changes.unshift(change);
    if (watcherInfo.changes.length > 100) {
      watcherInfo.changes.pop();
    }
    if (originalHandler) originalHandler(change);
  };

  console.error(`[FileWatcher] Created watcher ${id} for ${absolutePath}`);
  return watcherInfo;
}

/**
 * Stop a watcher
 */
function stopWatcher(id) {
  const info = watchers.get(id);
  if (!info) return false;

  info.watcher.close();
  info.status = "stopped";
  console.error(`[FileWatcher] Stopped watcher ${id}`);
  return true;
}

/**
 * Get watcher info
 */
function getWatcher(id) {
  return watchers.get(id);
}

/**
 * List all watchers
 */
function listWatchers() {
  return Array.from(watchers.values()).map((w) => ({
    id: w.id,
    path: w.path,
    status: w.status,
    createdAt: w.createdAt,
    changeCount: w.changes.length,
  }));
}

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name = "file-watcher";
export const version = "1.0.0";
export const description = "Watch directories for file changes and trigger AI actions";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "POST", path: "/file-watcher/watch", description: "Start watching a directory", scope: "write" },
  { method: "DELETE", path: "/file-watcher/:id", description: "Stop a watcher", scope: "write" },
  { method: "GET", path: "/file-watcher", description: "List all watchers", scope: "read" },
  { method: "GET", path: "/file-watcher/:id", description: "Get watcher details", scope: "read" },
  { method: "GET", path: "/file-watcher/:id/changes", description: "Get recent changes", scope: "read" },
];
export const examples = [
  'POST /file-watcher/watch  body: {"path":"./src","recursive":true}',
  'DELETE /file-watcher/watcher_1',
  'GET /file-watcher/watcher_1/changes?limit=10',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "file_watcher_start",
    description: "Start watching a directory for changes",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to watch" },
        recursive: { type: "boolean", default: true, description: "Watch subdirectories" },
        ignore: { type: "array", items: { type: "string" }, description: "Patterns to ignore" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      try {
        const watcher = createWatcher(args.path, {
          recursive: args.recursive ?? true,
          ignore: args.ignore ?? ["node_modules", ".git", "dist"],
        });
        return {
          ok: true,
          data: {
            watcherId: watcher.id,
            path: watcher.path,
            status: watcher.status,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "watcher_error", message: err.message } };
      }
    },
  },
  {
    name: "file_watcher_stop",
    description: "Stop a file watcher",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        watcherId: { type: "string", description: "Watcher ID to stop" },
      },
      required: ["watcherId"],
    },
    handler: async (args) => {
      const stopped = stopWatcher(args.watcherId);
      if (!stopped) {
        return { ok: false, error: { code: "watcher_not_found", message: "Watcher not found" } };
      }
      return { ok: true, data: { stopped: args.watcherId } };
    },
  },
  {
    name: "file_watcher_list",
    description: "List all active file watchers",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return { ok: true, data: { watchers: listWatchers() } };
    },
  },
  {
    name: "file_watcher_changes",
    description: "Get recent changes from a watcher",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        watcherId: { type: "string", description: "Watcher ID" },
        limit: { type: "number", default: 10, description: "Number of changes to return" },
      },
      required: ["watcherId"],
    },
    handler: async (args) => {
      const watcher = getWatcher(args.watcherId);
      if (!watcher) {
        return { ok: false, error: { code: "watcher_not_found", message: "Watcher not found" } };
      }
      const limit = Math.min(args.limit || 10, 100);
      return {
        ok: true,
        data: {
          watcherId: watcher.id,
          path: watcher.path,
          changes: watcher.changes.slice(0, limit),
        },
      };
    },
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // Start watching
  router.post("/watch", (req, res) => {
    const { path, recursive = true, ignore } = req.body || {};
    if (!path) {
      return res.status(400).json({ ok: false, error: { code: "missing_path", message: "Path is required" } });
    }

    try {
      const watcher = createWatcher(path, { recursive, ignore });
      res.status(201).json({
        ok: true,
        data: {
          id: watcher.id,
          path: watcher.path,
          status: watcher.status,
          createdAt: watcher.createdAt,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "watcher_error", message: err.message } });
    }
  });

  // List watchers
  router.get("/", (_req, res) => {
    res.json({ ok: true, data: { watchers: listWatchers() } });
  });

  // Get watcher details
  router.get("/:id", (req, res) => {
    const watcher = getWatcher(req.params.id);
    if (!watcher) {
      return res.status(404).json({ ok: false, error: { code: "watcher_not_found", message: "Watcher not found" } });
    }
    res.json({
      ok: true,
      data: {
        id: watcher.id,
        path: watcher.path,
        status: watcher.status,
        createdAt: watcher.createdAt,
        changeCount: watcher.changes.length,
      },
    });
  });

  // Get watcher changes
  router.get("/:id/changes", (req, res) => {
    const watcher = getWatcher(req.params.id);
    if (!watcher) {
      return res.status(404).json({ ok: false, error: { code: "watcher_not_found", message: "Watcher not found" } });
    }
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    res.json({
      ok: true,
      data: {
        watcherId: watcher.id,
        path: watcher.path,
        changes: watcher.changes.slice(0, limit),
      },
    });
  });

  // Stop watcher
  router.delete("/:id", (req, res) => {
    const stopped = stopWatcher(req.params.id);
    if (!stopped) {
      return res.status(404).json({ ok: false, error: { code: "watcher_not_found", message: "Watcher not found" } });
    }
    res.json({ ok: true, data: { stopped: req.params.id } });
  });

  app.use("/file-watcher", router);
}
