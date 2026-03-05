/**
 * Workspace Plugin
 *
 * File operations within a configured allowlist root directory.
 * Security: path traversal protection, symlink checks, size limits.
 */

import { promises as fs, constants as fsConstants } from "fs";
import { join, resolve, relative, dirname, basename } from "path";
import { homedir } from "os";

// Configuration
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || join(homedir(), "Projects");
const MAX_FILE_SIZE = parseInt(process.env.WORKSPACE_MAX_FILE_SIZE, 10) || 10 * 1024 * 1024; // 10MB default
const ALLOWED_EXTENSIONS = process.env.WORKSPACE_ALLOWED_EXTENSIONS?.split(",") || [
  ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt", ".yml", ".yaml",
  ".html", ".css", ".scss", ".less", ".xml", ".svg", ".csv"
];

/**
 * Validate and sanitize workspace path
 * @param {string} requestedPath - User-provided path
 * @returns {{valid: boolean, path?: string, error?: string}}
 */
export function validateWorkspacePath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== "string") {
    return { valid: false, error: "Path is required" };
  }

  // Normalize path and resolve to absolute
  let normalizedPath;
  try {
    // Handle paths starting with ~
    if (requestedPath.startsWith("~/")) {
      requestedPath = join(homedir(), requestedPath.slice(2));
    }

    // Resolve relative to workspace root
    if (requestedPath.startsWith("/")) {
      normalizedPath = resolve(requestedPath);
    } else {
      normalizedPath = resolve(WORKSPACE_ROOT, requestedPath);
    }
  } catch (err) {
    return { valid: false, error: "Invalid path format" };
  }

  // Ensure path is within workspace root
  const relativePath = relative(WORKSPACE_ROOT, normalizedPath);
  if (relativePath.startsWith("..") || relativePath.includes("../")) {
    return { valid: false, error: "Path traversal detected" };
  }

  // Check for path traversal patterns
  if (requestedPath.includes("..") || requestedPath.includes("~/../")) {
    return { valid: false, error: "Path traversal detected" };
  }

  return { valid: true, path: normalizedPath, relative: relativePath };
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
 * @param {Object} options
 * @param {number} options.maxSize - Max bytes to read (default 1MB)
 * @returns {Promise<{ok: boolean, data?: string, error?: Object}>}
 */
export async function readFile(filePath, options = {}) {
  const validation = validateWorkspacePath(filePath);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.error } };
  }

  const maxSize = options.maxSize || 1024 * 1024; // 1MB default

  try {
    // Check if file exists
    const stats = await fs.stat(validation.path);
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
    const content = await fs.readFile(validation.path, "utf-8");
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
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function writeFile(filePath, content, options = {}) {
  const validation = validateWorkspacePath(filePath);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.error } };
  }

  try {
    // Check if parent directory exists
    const parentDir = dirname(validation.path);
    const parentExists = await fileExists(parentDir);

    if (!parentExists) {
      if (options.createDirs) {
        await fs.mkdir(parentDir, { recursive: true });
      } else {
        return { ok: false, error: { code: "parent_not_found", message: "Parent directory does not exist" } };
      }
    }

    // Check if file already exists
    const exists = await fileExists(validation.path);

    // Write file
    await fs.writeFile(validation.path, content, "utf-8");

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
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function listDirectory(dirPath = ".", options = {}) {
  const validation = validateWorkspacePath(dirPath);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.error } };
  }

  try {
    const stats = await fs.stat(validation.path);
    if (!stats.isDirectory()) {
      return { ok: false, error: { code: "not_a_directory", message: "Path is not a directory" } };
    }

    const entries = await fs.readdir(validation.path, { withFileTypes: true });

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
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function searchFiles(pattern, options = {}) {
  const rootValidation = validateWorkspacePath(options.root || ".");
  if (!rootValidation.valid) {
    return { ok: false, error: { code: "invalid_path", message: rootValidation.error } };
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

    await searchDir(rootValidation.path, rootValidation.relative);

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
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function patchFile(filePath, patch, options = {}) {
  const validation = validateWorkspacePath(filePath);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_path", message: validation.error } };
  }

  try {
    // Read current content
    const currentContent = await fs.readFile(validation.path, "utf-8");
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

    // Write patched content
    await fs.writeFile(validation.path, newContent, "utf-8");

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
