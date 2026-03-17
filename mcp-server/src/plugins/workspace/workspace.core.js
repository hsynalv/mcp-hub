/**
 * Workspace Plugin
 *
 * File operations within a configured allowlist root directory.
 * Security: path traversal protection via central workspace-paths module.
 */

import { promises as fs, constants as fsConstants } from "fs";
import { join, relative, dirname } from "path";
import { validateWorkspacePath, getWorkspaceRoot, requireWorkspaceId } from "../../core/workspace-paths.js";

const MAX_FILE_SIZE = parseInt(process.env.WORKSPACE_MAX_FILE_SIZE, 10) || 10 * 1024 * 1024; // 10MB default
const ALLOWED_EXTENSIONS = process.env.WORKSPACE_ALLOWED_EXTENSIONS?.split(",") || [
  ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt", ".yml", ".yaml",
  ".html", ".css", ".scss", ".less", ".xml", ".svg", ".csv"
];

/**
 * Extract context from request (for REST routes)
 */
export function extractContext(req) {
  return {
    actor: req.user?.id || req.user?.email || "anonymous",
    workspaceId: req.headers["x-workspace-id"] || null,
    projectId: req.headers["x-project-id"] || null,
  };
}

/**
 * Validate path using central module. Returns { valid, resolvedPath, relative }.
 * @param {string} requestedPath - User-provided path
 * @param {string} [workspaceId] - Workspace ID (default: "global")
 */
function validatePath(requestedPath, workspaceId = "global") {
  requireWorkspaceId(workspaceId, "workspace_file_op");
  const result = validateWorkspacePath(requestedPath, workspaceId || "global");
  if (!result.valid) {
    return { ...result, relative: null };
  }
  const root = getWorkspaceRoot(workspaceId || "global");
  const rel = relative(root, result.resolvedPath);
  return { ...result, path: result.resolvedPath, relative: rel };
}

/**
 * Check if file extension is allowed
 * @param {string} filename
 * @returns {boolean}
 */
function isExtensionAllowed(filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Check if file exists
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  try {
    await fs.access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file contents
 * @param {string} filePath - Relative or absolute path
 * @param {string} [workspaceId] - Workspace ID (required when WORKSPACE_REQUIRE_ID=true)
 * @param {Object} options
 * @param {number} options.maxSize - Max bytes to read (default 1MB)
 * @returns {Promise<{ok: boolean, data?: string, error?: Object}>}
 */
export async function readFile(filePath, workspaceIdOrOptions = "global", options = {}) {
  const { workspaceId, opts } = typeof workspaceIdOrOptions === "string" || workspaceIdOrOptions == null
    ? { workspaceId: workspaceIdOrOptions ?? "global", opts: options }
    : { workspaceId: "global", opts: workspaceIdOrOptions };
  const validation = validatePath(filePath, workspaceId);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.reason || validation.error } };
  }

  const maxSize = opts.maxSize || 1024 * 1024; // 1MB default

  try {
    // Check if file exists
    const stats = await fs.stat(validation.resolvedPath);
    if (!stats.isFile()) {
      return { ok: false, error: { code: "not_a_file", message: "Path is not a file" } };
    }

    // Check size limit
    if (stats.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        error: {
          code: "file_too_large",
          message: `File exceeds max size of ${MAX_FILE_SIZE} bytes`,
        },
      };
    }

    // Read file
    const content = await fs.readFile(validation.resolvedPath, "utf-8");
    const truncated = content.length > maxSize;
    const result = truncated ? content.slice(0, maxSize) + "\n\n[...truncated...]" : content;

    return {
      ok: true,
      data: {
        path: validation.relative,
        content: result,
        size: stats.size,
        truncated,
        encoding: "utf-8",
      },
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: { code: "file_not_found", message: "File does not exist" } };
    }
    return { ok: false, error: { code: "read_error", message: err.message } };
  }
}

/**
 * Write file contents
 * @param {string} filePath - Relative or absolute path
 * @param {string} content - File content
 * @param {Object} options
 * @param {boolean} options.createDirs - Create parent directories if missing
 * @param {string} [options.workspaceId] - Workspace ID (default: "global")
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function writeFile(filePath, content, options = {}) {
  const workspaceId = options.workspaceId ?? "global";
  const validation = validatePath(filePath, workspaceId);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.reason || validation.error } };
  }

  try {
    const parentDir = dirname(validation.resolvedPath);
    const parentExists = await fileExists(parentDir);

    if (!parentExists) {
      if (options.createDirs) {
        await fs.mkdir(parentDir, { recursive: true });
      } else {
        return { ok: false, error: { code: "parent_not_found", message: "Parent directory does not exist" } };
      }
    }

    const exists = await fileExists(validation.resolvedPath);
    await fs.writeFile(validation.resolvedPath, content, "utf-8");

    return {
      ok: true,
      data: {
        path: validation.relative,
        bytesWritten: Buffer.byteLength(content, "utf-8"),
        created: !exists,
        updated: exists,
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "write_error", message: err.message } };
  }
}

/**
 * List directory contents
 * @param {string} dirPath - Directory path (default: workspace root)
 * @param {Object} options
 * @param {boolean} options.recursive - List recursively
 * @param {string} [options.workspaceId] - Workspace ID (default: "global")
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function listDirectory(dirPath = ".", options = {}) {
  const workspaceId = options.workspaceId ?? "global";
  const validation = validatePath(dirPath, workspaceId);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.reason || validation.error } };
  }

  try {
    const stats = await fs.stat(validation.resolvedPath);
    if (!stats.isDirectory()) {
      return { ok: false, error: { code: "not_a_directory", message: "Path is not a directory" } };
    }

    const entries = await fs.readdir(validation.resolvedPath, { withFileTypes: true });

    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      path: join(validation.relative, entry.name),
    }));

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === "directory" ? -1 : 1;
    });

    return {
      ok: true,
      data: {
        path: validation.relative,
        items,
        count: items.length,
      },
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: { code: "directory_not_found", message: "Directory does not exist" } };
    }
    return { ok: false, error: { code: "list_error", message: err.message } };
  }
}

/**
 * Search files by pattern
 * @param {string} pattern - Search pattern (glob or regex)
 * @param {Object} options
 * @param {string} options.root - Search root directory
 * @param {string} [options.workspaceId] - Workspace ID (default: "global")
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function searchFiles(pattern, options = {}) {
  const workspaceId = options.workspaceId ?? "global";
  const rootValidation = validatePath(options.root || ".", workspaceId);
  if (!rootValidation.valid) {
    return { ok: false, error: { code: "invalid_path", message: rootValidation.reason || rootValidation.error } };
  }

  try {
    const results = [];

    async function searchDir(dirPath, relativePath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relPath = join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden dirs
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          await searchDir(fullPath, relPath);
        } else if (entry.isFile()) {
          // Simple pattern matching (case-insensitive)
          if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
            const stats = await fs.stat(fullPath);
            results.push({
              name: entry.name,
              path: relPath,
              size: stats.size,
              modified: stats.mtime.toISOString(),
            });
          }
        }
      }
    }

    await searchDir(rootValidation.resolvedPath, rootValidation.relative);

    // Limit results
    const limited = results.slice(0, 100);

    return {
      ok: true,
      data: {
        pattern,
        results: limited,
        total: results.length,
        truncated: results.length > 100,
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "search_error", message: err.message } };
  }
}

/**
 * Apply patch/diff to file
 * @param {string} filePath - Target file path
 * @param {string} patch - Patch content (unified diff format or search/replace)
 * @param {Object} options
 * @param {string} options.mode - "search-replace" or "diff"
 * @param {string} [options.workspaceId] - Workspace ID (default: "global")
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function patchFile(filePath, patch, options = {}) {
  const workspaceId = options.workspaceId ?? "global";
  const validation = validatePath(filePath, workspaceId);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.reason || validation.error } };
  }

  try {
    const currentContent = await fs.readFile(validation.resolvedPath, "utf-8");
    let newContent;

    if (options.mode === "search-replace") {
      // Simple search and replace
      const [search, replace] = patch.split("===REPLACE===");
      if (!search || !replace) {
        return { ok: false, error: { code: "invalid_patch", message: "Invalid search-replace format. Use: search===REPLACE===replace" } };
      }
      newContent = currentContent.replace(search.trim(), replace.trim());
    } else {
      // Try to apply as unified diff (simplified implementation)
      // For a full implementation, use a library like 'diff' or 'patch'
      return { ok: false, error: { code: "not_implemented", message: "Unified diff mode not yet implemented" } };
    }

    await fs.writeFile(validation.resolvedPath, newContent, "utf-8");

    return {
      ok: true,
      data: {
        path: validation.relative,
        originalSize: currentContent.length,
        newSize: newContent.length,
        changed: currentContent !== newContent,
      },
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: { code: "file_not_found", message: "File does not exist" } };
    }
    return { ok: false, error: { code: "patch_error", message: err.message } };
  }
}

/**
 * Delete a file within the workspace.
 * @param {string} filePath - Path to file
 * @param {string} [workspaceId] - Workspace ID (default: "global")
 */
export async function deleteFile(filePath, workspaceId = "global") {
  const validation = validatePath(filePath, workspaceId);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.reason || validation.error } };
  }

  try {
    const stat = await fs.stat(validation.resolvedPath);
    if (stat.isDirectory()) {
      return { ok: false, error: { code: "is_directory", message: "Path is a directory. Use delete on files only." } };
    }
    await fs.unlink(validation.resolvedPath);
    return { ok: true, data: { deleted: validation.relative } };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: { code: "file_not_found", message: "File does not exist" } };
    }
    return { ok: false, error: { code: "delete_error", message: err.message } };
  }
}

/**
 * Move or rename a file within the workspace.
 * @param {string} srcPath - Source path
 * @param {string} dstPath - Destination path
 * @param {string} [workspaceId] - Workspace ID (default: "global")
 */
export async function moveFile(srcPath, dstPath, workspaceId = "global") {
  const srcValidation = validatePath(srcPath, workspaceId);
  if (!srcValidation.valid) {
    return { ok: false, error: { code: "invalid_source_path", message: srcValidation.reason || srcValidation.error } };
  }

  const dstValidation = validatePath(dstPath, workspaceId);
  if (!dstValidation.valid) {
    return { ok: false, error: { code: "invalid_destination_path", message: dstValidation.reason || dstValidation.error } };
  }

  try {
    await fs.mkdir(dirname(dstValidation.resolvedPath), { recursive: true });
    await fs.rename(srcValidation.resolvedPath, dstValidation.resolvedPath);
    return { ok: true, data: { from: srcValidation.relative, to: dstValidation.relative } };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: { code: "file_not_found", message: "Source file does not exist" } };
    }
    return { ok: false, error: { code: "move_error", message: err.message } };
  }
}
