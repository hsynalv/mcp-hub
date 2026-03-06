/**
 * Local Sidecar - Core
 *
 * Safe filesystem operations with whitelist enforcement.
 */

import { readdir, readFile, writeFile, stat, createHash } from "fs/promises";
import { join, resolve, relative, isAbsolute, normalize } from "path";
import { loadWhitelistConfig } from "./whitelist.config.js";

/**
 * Check if a path is within whitelisted directories
 * @param {string} targetPath - Path to check
 * @returns {{allowed: boolean, resolvedPath?: string, error?: string}}
 */
export function checkPathAllowed(targetPath) {
  const whitelist = loadWhitelistConfig();
  
  // Resolve to absolute path
  const resolved = isAbsolute(targetPath) 
    ? normalize(targetPath)
    : normalize(join(process.cwd(), targetPath));

  // Check against whitelist
  const isAllowed = whitelist.some(allowedPath => {
    const normalizedAllowed = normalize(allowedPath);
    // Path must be within allowed directory
    return resolved === normalizedAllowed || 
           resolved.startsWith(normalizedAllowed + "/") ||
           resolved.startsWith(normalizedAllowed + "\\");
  });

  if (!isAllowed) {
    return {
      allowed: false,
      error: `Access denied: ${resolved} is not in whitelisted directories`,
    };
  }

  return { allowed: true, resolvedPath: resolved };
}

/**
 * List directory contents
 * @param {string} dirPath - Directory path
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function fsList(dirPath) {
  const check = checkPathAllowed(dirPath);
  if (!check.allowed) {
    return { ok: false, error: { code: "access_denied", message: check.error } };
  }

  try {
    const entries = await readdir(check.resolvedPath, { withFileTypes: true });
    
    const items = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      path: join(dirPath, entry.name),
    }));

    // Get stats for each item
    const itemsWithStats = await Promise.all(
      items.map(async (item) => {
        try {
          const itemStat = await stat(join(check.resolvedPath, item.name));
          return {
            ...item,
            size: itemStat.size,
            modified: itemStat.mtime.toISOString(),
          };
        } catch {
          return item;
        }
      })
    );

    return {
      ok: true,
      data: {
        path: dirPath,
        resolvedPath: check.resolvedPath,
        items: itemsWithStats,
        count: items.length,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "fs_error", message: err.message },
    };
  }
}

/**
 * Read file contents
 * @param {string} filePath - File path
 * @param {Object} options - Options
 * @param {string} options.encoding - File encoding (default: utf8)
 * @param {number} options.maxSize - Max bytes to read (default: 1MB)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function fsRead(filePath, options = {}) {
  const check = checkPathAllowed(filePath);
  if (!check.allowed) {
    return { ok: false, error: { code: "access_denied", message: check.error } };
  }

  const encoding = options.encoding || "utf8";
  const maxSize = options.maxSize || 1024 * 1024; // 1MB default

  try {
    const fileStat = await stat(check.resolvedPath);
    
    if (!fileStat.isFile()) {
      return { ok: false, error: { code: "not_a_file", message: "Path is not a file" } };
    }

    if (fileStat.size > maxSize) {
      return {
        ok: false,
        error: {
          code: "file_too_large",
          message: `File size (${fileStat.size} bytes) exceeds max (${maxSize} bytes)`,
        },
      };
    }

    const content = await readFile(check.resolvedPath, encoding);

    return {
      ok: true,
      data: {
        path: filePath,
        resolvedPath: check.resolvedPath,
        content,
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "fs_error", message: err.message },
    };
  }
}

/**
 * Write file contents
 * @param {string} filePath - File path
 * @param {string} content - Content to write
 * @param {Object} options - Options
 * @param {boolean} options.createDirs - Create parent directories if missing
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function fsWrite(filePath, content, options = {}) {
  const check = checkPathAllowed(filePath);
  if (!check.allowed) {
    return { ok: false, error: { code: "access_denied", message: check.error } };
  }

  try {
    await writeFile(check.resolvedPath, content, "utf8");

    const fileStat = await stat(check.resolvedPath);

    return {
      ok: true,
      data: {
        path: filePath,
        resolvedPath: check.resolvedPath,
        size: fileStat.size,
        written: content.length,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "fs_error", message: err.message },
    };
  }
}

/**
 * Calculate file hash (SHA-256)
 * @param {string} filePath - File path
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function fsHash(filePath) {
  const check = checkPathAllowed(filePath);
  if (!check.allowed) {
    return { ok: false, error: { code: "access_denied", message: check.error } };
  }

  try {
    const content = await readFile(check.resolvedPath);
    
    const hash = createHash("sha256");
    hash.update(content);
    const digest = hash.digest("hex");

    return {
      ok: true,
      data: {
        path: filePath,
        resolvedPath: check.resolvedPath,
        hash: digest,
        algorithm: "sha256",
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "fs_error", message: err.message },
    };
  }
}
