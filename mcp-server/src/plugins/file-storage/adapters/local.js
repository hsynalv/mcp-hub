/**
 * Local filesystem storage adapter with symlink escape protection and workspace isolation.
 */

import { readdir, readFile, writeFile, unlink, copyFile, mkdir, stat, lstat, realpath } from "fs/promises";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { createPluginErrorHandler } from "../../../core/error-standard.js";

const pluginError = createPluginErrorHandler("file-storage");

/**
 * Get root directory with optional workspace isolation
 * Format: <base_root>/<workspaceId>/
 */
function getRoot(workspaceId = null) {
  const baseRoot = resolve(process.cwd(), process.env.FILE_STORAGE_LOCAL_ROOT || "./cache/files");
  // If workspace isolation is enabled and workspaceId provided
  if (process.env.FILE_STORAGE_WORKSPACE_ISOLATION === "true" && workspaceId) {
    // Sanitize workspaceId to prevent traversal
    const sanitizedWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitizedWorkspace) {
      throw pluginError.validation("Invalid workspaceId");
    }
    return resolve(baseRoot, "workspaces", sanitizedWorkspace);
  }
  return baseRoot;
}

/**
 * Resolve path within root, preventing traversal
 */
function resolvePath(path, workspaceId = null) {
  const root = getRoot(workspaceId);
  const full = resolve(root, path);
  if (!full.startsWith(root)) return null;
  return full;
}

/**
 * Check if path is a symlink and if its target escapes the root
 * Returns { isSymlink: boolean, escapesRoot: boolean, realPath: string|null }
 */
async function checkSymlinkEscape(fullPath, workspaceId = null) {
  try {
    const stats = await lstat(fullPath);

    if (!stats.isSymbolicLink()) {
      return { isSymlink: false, escapesRoot: false, realPath: fullPath };
    }

    // It's a symlink - resolve the real path
    const real = await realpath(fullPath);
    const root = getRoot(workspaceId);

    // Check if resolved path is still within root
    const escapesRoot = !real.startsWith(root);

    return { isSymlink: true, escapesRoot, realPath: real };
  } catch (err) {
    // If lstat fails, try realpath as fallback
    try {
      const real = await realpath(fullPath);
      const root = getRoot(workspaceId);
      const escapesRoot = !real.startsWith(root);
      return { isSymlink: false, escapesRoot, realPath: real };
    } catch {
      return { isSymlink: false, escapesRoot: false, realPath: null, error: err.message };
    }
  }
}

/**
 * Validate that a path doesn't escape via symlink
 * Throws error if symlink escapes root
 */
async function validateSymlinkSafety(fullPath, operation, workspaceId = null) {
  const check = await checkSymlinkEscape(fullPath, workspaceId);

  if (check.escapesRoot) {
    throw pluginError.authorization(
      `Symlink escape detected: ${operation} target resolves outside allowed directory`
    );
  }

  return check.realPath || fullPath;
}

/**
 * Extract workspace context from operation context
 */
function extractWorkspaceId(context = {}) {
  // If strict mode and no workspace, deny
  if (process.env.FILE_STORAGE_WORKSPACE_STRICT === "true" && !context.workspaceId) {
    throw pluginError.authorization("workspaceId required in strict mode");
  }
  return context.workspaceId || null;
}

export default {
  async list(path, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const full = resolvePath(path, workspaceId);
    if (!full) throw pluginError.validation("Invalid path - path traversal detected");
    if (!existsSync(full)) return { items: [] };

    // Check symlink safety for the directory itself
    await validateSymlinkSafety(full, "list", workspaceId);

    const entries = await readdir(full, { withFileTypes: true });
    const items = await Promise.all(entries.map(async (e) => {
      const itemPath = path ? `${path}/${e.name}` : e.name;
      let size = null;
      let isSymlink = false;

      const entryFullPath = resolve(full, e.name);

      // Check if entry is a symlink
      try {
        const entryStats = await lstat(entryFullPath);
        isSymlink = entryStats.isSymbolicLink();

        // If symlink, check it doesn't escape
        if (isSymlink) {
          const check = await checkSymlinkEscape(entryFullPath, workspaceId);
          if (check.escapesRoot) {
            // Don't expose symlink that escapes, mark as inaccessible
            return { name: e.name, path: itemPath, isDir: false, isSymlink: true, inaccessible: true, size: null };
          }
        }
      } catch { /* ignore stat errors */ }

      if (e.isFile() || isSymlink) {
        try {
          // Use realpath to get target size if symlink
          const targetPath = isSymlink ? await realpath(entryFullPath) : entryFullPath;
          const s = await stat(targetPath);
          size = s.size;
        } catch { /* ignore */ }
      }

      return {
        name: e.name,
        path: itemPath,
        isDir: e.isDirectory() && !isSymlink,
        isSymlink,
        size,
        inaccessible: false
      };
    }));

    return { items };
  },

  async read(path, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const full = resolvePath(path, workspaceId);
    if (!full) throw pluginError.validation("Invalid path - path traversal detected");

    // Validate symlink doesn't escape
    await validateSymlinkSafety(full, "read", workspaceId);

    const buf = await readFile(full);
    return { content: buf.toString("base64"), size: buf.length };
  },

  async write(path, content, contentType, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const full = resolvePath(path, workspaceId);
    if (!full) throw pluginError.validation("Invalid path - path traversal detected");

    const root = getRoot(workspaceId);
    if (!full.startsWith(root)) throw pluginError.validation("Path outside allowed directory");

    // If file exists and is a symlink, check it doesn't escape
    if (existsSync(full)) {
      await validateSymlinkSafety(full, "write", workspaceId);
    }

    const dir = dirname(full);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, typeof content === "string" && content.length > 0 && !content.includes(",") ? "utf8" : "base64");
    await writeFile(full, buf);
    return { path, size: buf.length };
  },

  async delete(path, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const full = resolvePath(path, workspaceId);
    if (!full) throw pluginError.validation("Invalid path - path traversal detected");

    // Validate symlink doesn't escape before deleting
    await validateSymlinkSafety(full, "delete", workspaceId);

    await unlink(full);
    return { deleted: path };
  },

  async copy(sourcePath, destPath, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const src = resolvePath(sourcePath, workspaceId);
    const dst = resolvePath(destPath, workspaceId);
    if (!src || !dst) throw pluginError.validation("Invalid source or destination path");

    const root = getRoot(workspaceId);
    if (!src.startsWith(root) || !dst.startsWith(root)) throw pluginError.validation("Path outside allowed directory");

    // Validate both paths don't escape via symlink
    await validateSymlinkSafety(src, "copy source", workspaceId);
    if (existsSync(dst)) {
      await validateSymlinkSafety(dst, "copy destination", workspaceId);
    }

    const dir = dirname(dst);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await copyFile(src, dst);
    return { source: sourcePath, dest: destPath };
  },

  async move(sourcePath, destPath, context = {}) {
    const workspaceId = extractWorkspaceId(context);
    const src = resolvePath(sourcePath, workspaceId);
    const dst = resolvePath(destPath, workspaceId);
    if (!src || !dst) throw pluginError.validation("Invalid source or destination path");

    const root = getRoot(workspaceId);
    if (!src.startsWith(root) || !dst.startsWith(root)) throw pluginError.validation("Path outside allowed directory");

    // Validate both paths don't escape via symlink
    await validateSymlinkSafety(src, "move source", workspaceId);
    if (existsSync(dst)) {
      await validateSymlinkSafety(dst, "move destination", workspaceId);
    }

    const dir = dirname(dst);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await copyFile(src, dst);
    await unlink(src);
    return { source: sourcePath, dest: destPath };
  },

  // Export helpers for testing
  _helpers: {
    checkSymlinkEscape,
    validateSymlinkSafety,
    getRoot,
    resolvePath,
    extractWorkspaceId,
  },
};
