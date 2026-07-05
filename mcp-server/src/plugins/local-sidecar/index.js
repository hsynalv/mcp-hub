/**
 * Local Sidecar Plugin
 *
 * Safe local filesystem access with whitelist enforcement.
 * Provides file operations and Google Drive upload capabilities.
 */

import { Router } from "express";
import { toolContextFromRequest } from "../../core/authorization/http-tool-context.js";
import { ToolTags, callTool } from "../../core/tool-registry.js";
import { fsList, fsRead, fsWrite, fsHash, checkPathAllowed } from "./sidecar.core.js";
import {
  fsStat,
  fsRecent,
  fsSearch,
  fsCopy,
  fsMove,
  fsDeleteToTrash,
} from "./fs-pro.core.js";
import { delegateToSidecar } from "../../core/sidecar/sidecar-proxy.js";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";
import { requireScopeByMethod } from "../../core/auth.js";
import { mountPluginHealth } from "../../core/plugin-health.js";
import { fsAccessOptsFromContext } from "./fs-access.js";

export const name = "local-sidecar";
export const version = "1.0.0";
export const description = "Safe local filesystem access with whitelist enforcement";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "GET", path: "/local/health", description: "Plugin health", scope: "read" },
  { method: "GET", path: "/local/fs/list", description: "List directory contents", scope: "read" },
  { method: "GET", path: "/local/fs/read", description: "Read file contents", scope: "read" },
  { method: "POST", path: "/local/fs/write", description: "Write file contents", scope: "write" },
  { method: "GET", path: "/local/fs/hash", description: "Calculate file hash", scope: "read" },
  { method: "POST", path: "/local/drive/upload", description: "Upload file to Google Drive", scope: "danger" },
];

// ─── MCP Tools ────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "fs_list",
    description: "List directory contents (whitelist enforced)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list",
          default: ".",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to list this directory",
        },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("list", { path, ...access, context });
      const result = delegated ?? (await fsList(path, access));
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "fs_read",
    description: "Read file contents (whitelist enforced, max 1MB)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to read",
        },
        maxSize: {
          type: "number",
          description: "Max bytes to read (default: 1MB)",
          default: 1048576,
        },
        explanation: {
          type: "string",
          description: "Explain why you need to read this file",
        },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, maxSize, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("read", { path, maxSize, ...access, context });
      const result = delegated ?? (await fsRead(path, { maxSize, ...access }));
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "fs_write",
    description: "Write file contents (whitelist enforced)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to write",
        },
        content: {
          type: "string",
          description: "Content to write",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to write this file",
        },
      },
      required: ["path", "content", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    handler: async ({ path, content, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("write", { path, content, ...access, context });
      const result = delegated ?? (await fsWrite(path, content, access));
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "fs_hash",
    description: "Calculate SHA-256 hash of file (whitelist enforced)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to hash",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to hash this file",
        },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("hash", { path, ...access, context });
      const result = delegated ?? (await fsHash(path, access));
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "fs_stat",
    description: "Get file or directory metadata (size, modified, permissions)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path" },
        explanation: { type: "string", description: "Why you need this metadata" },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("stat", { path, ...access, context });
      const result = delegated ?? (await fsStat(path, access));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "fs_recent",
    description: "List recently modified files under a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path", default: "." },
        limit: { type: "number", description: "Max files to return", default: 20 },
        explanation: { type: "string" },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, limit, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("recent", { path, limit, ...access, context });
      const result = delegated ?? (await fsRecent(path, { limit, ...access }));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "fs_search",
    description: "Search files by name pattern and optional extension under a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", default: "." },
        pattern: { type: "string", description: "Substring or glob (e.g. *.pdf)" },
        extension: { type: "string", description: "File extension without dot" },
        maxResults: { type: "number", default: 50 },
        explanation: { type: "string" },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path, pattern, extension, maxResults, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("search", { path, pattern, extension, maxResults, ...access, context });
      const result = delegated ?? (await fsSearch(path, { pattern, extension, maxResults, ...access }));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "fs_copy",
    description: "Copy file or directory (requires approval)",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["source", "destination", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    handler: async ({ source, destination, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("copy", { source, destination, ...access, context });
      const result = delegated ?? (await fsCopy(source, destination, access));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "fs_move",
    description: "Move or rename file/directory (requires approval)",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["source", "destination", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    handler: async ({ source, destination, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("move", { source, destination, ...access, context });
      const result = delegated ?? (await fsMove(source, destination, access));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "fs_delete_to_trash",
    description: "Move file or directory to Trash (requires approval)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    handler: async ({ path, explanation }, context) => {
      const access = fsAccessOptsFromContext(context);
      const delegated = await delegateToSidecar("delete_to_trash", { path, ...access, context });
      const result = delegated ?? (await fsDeleteToTrash(path, access));
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "drive_upload",
    description: "Upload file to Google Drive using rclone (requires approval)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Local file path to upload",
        },
        remote: {
          type: "string",
          description: "rclone remote name (default: drive)",
          default: "drive",
        },
        destination: {
          type: "string",
          description: "Destination folder in Drive (default: root)",
          default: "/",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to upload this file",
        },
      },
      required: ["path", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    handler: async ({ path, remote = "drive", destination = "/", explanation }) => {
      // Check whitelist
      const check = checkPathAllowed(path);
      if (!check.allowed) {
        return { ok: false, error: { code: "access_denied", message: check.error } };
      }

      // Verify file exists and get stats
      try {
        const fileStat = await stat(check.resolvedPath);
        if (!fileStat.isFile()) {
          return { ok: false, error: { code: "not_a_file", message: "Path is not a file" } };
        }

        // Upload using rclone
        const uploadResult = await uploadWithRclone(
          check.resolvedPath,
          remote,
          destination,
          basename(path)
        );

        if (!uploadResult.ok) {
          return uploadResult;
        }

        return {
          ok: true,
          data: {
            localPath: path,
            resolvedPath: check.resolvedPath,
            remote: `${remote}:${destination}`,
            fileName: basename(path),
            size: fileStat.size,
            explanation,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: { code: "upload_error", message: err.message },
        };
      }
    },
  },
];

/**
 * Upload file using rclone
 * @param {string} localPath - Local file path
 * @param {string} remote - rclone remote name
 * @param {string} destination - Destination folder
 * @param {string} fileName - File name
 * @returns {Promise<{ok: boolean, error?: Object}>}
 */
async function uploadWithRclone(localPath, remote, destination, fileName) {
  return new Promise((resolve) => {
    const destPath = destination === "/" ? fileName : `${destination}/${fileName}`;
    const args = ["copy", localPath, `${remote}:${destination}`, "--progress"];

    const child = spawn("rclone", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: {
            code: "rclone_error",
            message: `rclone exited with code ${code}`,
            details: stderr,
          },
        });
      }
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        error: {
          code: "rclone_not_found",
          message: "rclone command not found. Please install rclone and configure Google Drive remote.",
        },
      });
    });
  });
}

// ─── REST API Endpoints ───────────────────────────────────────────────────

export function register(app) {
  const router = Router();
  mountPluginHealth(router, { name, version });
  router.use(requireScopeByMethod({
    pathScopes: { "/drive/upload": "admin" },
  }));

  // GET /local/fs/list
  router.get("/fs/list", async (req, res) => {
    const { path = "." } = req.query;
    const result = await fsList(path);
    res.json(result);
  });

  // GET /local/fs/read
  router.get("/fs/read", async (req, res) => {
    const { path, maxSize = 1048576 } = req.query;
    if (!path) {
      return res.status(400).json({ ok: false, error: "path is required" });
    }
    const result = await fsRead(path, { maxSize: parseInt(maxSize, 10) });
    res.json(result);
  });

  // POST /local/fs/write
  router.post("/fs/write", async (req, res) => {
    const { path, content } = req.body || {};
    if (!path || content === undefined) {
      return res.status(400).json({ ok: false, error: "path and content are required" });
    }
    const result = await fsWrite(path, content);
    res.json(result);
  });

  // GET /local/fs/hash
  router.get("/fs/hash", async (req, res) => {
    const { path } = req.query;
    if (!path) {
      return res.status(400).json({ ok: false, error: "path is required" });
    }
    const result = await fsHash(path);
    res.json(result);
  });

  // POST /local/drive/upload
  router.post("/drive/upload", async (req, res) => {
    const { path, remote = "drive", destination = "/" } = req.body || {};
    if (!path) {
      return res.status(400).json({ ok: false, error: "path is required" });
    }

    const result = await callTool(
      "drive_upload",
      {
        path,
        remote,
        destination,
        explanation: "REST API upload request",
      },
      toolContextFromRequest(req)
    );

    res.json(result);
  });

  app.use("/local", router);
}
