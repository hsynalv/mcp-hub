/**
 * Local Sidecar Plugin
 *
 * Safe local filesystem access with whitelist enforcement.
 * Provides file operations and Google Drive upload capabilities.
 */

import { Router } from "express";
import { ToolTags } from "../../core/tool-registry.js";
import { fsList, fsRead, fsWrite, fsHash, checkPathAllowed } from "./sidecar.core.js";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";

export const name = "local-sidecar";
export const version = "1.0.0";
export const description = "Safe local filesystem access with whitelist enforcement";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
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
    handler: async ({ path, explanation }) => {
      const result = await fsList(path);
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
    handler: async ({ path, maxSize, explanation }) => {
      const result = await fsRead(path, { maxSize });
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
    handler: async ({ path, content, explanation }) => {
      const result = await fsWrite(path, content);
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
    handler: async ({ path, explanation }) => {
      const result = await fsHash(path);
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

    // Find the drive_upload tool handler
    const uploadTool = tools.find(t => t.name === "drive_upload");
    if (!uploadTool) {
      return res.status(500).json({ ok: false, error: "Tool not found" });
    }

    const result = await uploadTool.handler({
      path,
      remote,
      destination,
      explanation: "REST API upload request",
    });

    res.json(result);
  });

  app.use("/local", router);
}
