/**
 * V10 — Filesystem pro tools (search, stat, copy, move, trash).
 */

import { readdir, stat, cp, rename, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, basename, dirname } from "path";
import { checkPathAllowed } from "./sidecar.core.js";
import { fsDenyEnvelope } from "./fs-access.js";

const DEFAULT_SEARCH_MAX = 50;
const DEFAULT_SEARCH_DEPTH = 4;
const DEFAULT_RECENT_LIMIT = 20;

function matchesName(name, pattern) {
  if (!pattern) return true;
  const p = String(pattern).toLowerCase();
  const n = name.toLowerCase();
  if (p.includes("*")) {
    const re = new RegExp(`^${p.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`, "i");
    return re.test(name);
  }
  return n.includes(p);
}

function matchesExtension(name, extension) {
  if (!extension) return true;
  const ext = extension.startsWith(".") ? extension.slice(1) : extension;
  return name.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
}

async function walkFiles(rootPath, { maxDepth, maxResults, pattern, extension, results }) {
  if (results.length >= maxResults || maxDepth < 0) return;

  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    const full = join(rootPath, entry.name);
    if (entry.isFile()) {
      if (matchesName(entry.name, pattern) && matchesExtension(entry.name, extension)) {
        try {
          const s = await stat(full);
          results.push({
            name: entry.name,
            path: full,
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
          });
        } catch {
          /* skip */
        }
      }
    } else if (entry.isDirectory() && maxDepth > 0) {
      await walkFiles(full, { maxDepth: maxDepth - 1, maxResults, pattern, extension, results });
    }
  }
}

/**
 * @param {string} targetPath
 * @param {{ approvalGranted?: boolean }} [accessOpts]
 */
export async function fsStat(targetPath, accessOpts = {}) {
  const check = checkPathAllowed(targetPath, "read", accessOpts);
  if (!check.allowed) return fsDenyEnvelope(check);

  try {
    const s = await stat(check.resolvedPath);
    return {
      ok: true,
      data: {
        path: targetPath,
        resolvedPath: check.resolvedPath,
        size: s.size,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        mode: s.mode,
        modifiedAt: s.mtime.toISOString(),
        createdAt: s.birthtime?.toISOString?.() ?? s.ctime.toISOString(),
        classification: check.classification,
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "stat_failed", message: err.message } };
  }
}

/**
 * @param {string} dirPath
 * @param {{ limit?: number, maxDepth?: number, approvalGranted?: boolean }} [opts]
 */
export async function fsRecent(dirPath, { limit = DEFAULT_RECENT_LIMIT, maxDepth = 3, approvalGranted = false } = {}) {
  const check = checkPathAllowed(dirPath, "list", { approvalGranted });
  if (!check.allowed) return fsDenyEnvelope(check);

  const found = [];
  await walkFiles(check.resolvedPath, {
    maxDepth,
    maxResults: limit * 5,
    pattern: null,
    extension: null,
    results: found,
  });

  found.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  const items = found.slice(0, limit);

  return {
    ok: true,
    data: {
      path: dirPath,
      resolvedPath: check.resolvedPath,
      count: items.length,
      items,
    },
  };
}

/**
 * @param {string} dirPath
 * @param {{ pattern?: string, extension?: string, maxResults?: number, maxDepth?: number, approvalGranted?: boolean }} [opts]
 */
export async function fsSearch(
  dirPath,
  { pattern, extension, maxResults = DEFAULT_SEARCH_MAX, maxDepth = DEFAULT_SEARCH_DEPTH, approvalGranted = false } = {}
) {
  const check = checkPathAllowed(dirPath, "list", { approvalGranted });
  if (!check.allowed) return fsDenyEnvelope(check);

  const matches = [];
  await walkFiles(check.resolvedPath, {
    maxDepth,
    maxResults,
    pattern,
    extension,
    results: matches,
  });

  return {
    ok: true,
    data: {
      path: dirPath,
      resolvedPath: check.resolvedPath,
      pattern: pattern || null,
      extension: extension || null,
      count: matches.length,
      matches,
    },
  };
}

/**
 * @param {string} sourcePath
 * @param {string} destPath
 * @param {{ approvalGranted?: boolean }} [accessOpts]
 */
export async function fsCopy(sourcePath, destPath, accessOpts = {}) {
  const srcCheck = checkPathAllowed(sourcePath, "read", accessOpts);
  if (!srcCheck.allowed) return fsDenyEnvelope(srcCheck);
  const destCheck = checkPathAllowed(destPath, "write", accessOpts);
  if (!destCheck.allowed) return fsDenyEnvelope(destCheck);

  try {
    const srcStat = await stat(srcCheck.resolvedPath);
    await mkdir(dirname(destCheck.resolvedPath), { recursive: true }).catch(() => {});
    await cp(srcCheck.resolvedPath, destCheck.resolvedPath, { recursive: srcStat.isDirectory() });
    return {
      ok: true,
      data: {
        source: sourcePath,
        destination: destPath,
        resolvedSource: srcCheck.resolvedPath,
        resolvedDestination: destCheck.resolvedPath,
        isDirectory: srcStat.isDirectory(),
        undo: {
          type: "fs_delete",
          path: destPath,
          resolvedPath: destCheck.resolvedPath,
          note: "Copy undo: delete copied destination",
        },
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "copy_failed", message: err.message } };
  }
}

/**
 * @param {string} sourcePath
 * @param {string} destPath
 * @param {{ approvalGranted?: boolean }} [accessOpts]
 */
export async function fsMove(sourcePath, destPath, accessOpts = {}) {
  const srcCheck = checkPathAllowed(sourcePath, "write", accessOpts);
  if (!srcCheck.allowed) return fsDenyEnvelope(srcCheck);
  const destCheck = checkPathAllowed(destPath, "write", accessOpts);
  if (!destCheck.allowed) return fsDenyEnvelope(destCheck);

  try {
    await mkdir(dirname(destCheck.resolvedPath), { recursive: true }).catch(() => {});
    await rename(srcCheck.resolvedPath, destCheck.resolvedPath);
    return {
      ok: true,
      data: {
        source: sourcePath,
        destination: destPath,
        resolvedSource: srcCheck.resolvedPath,
        resolvedDestination: destCheck.resolvedPath,
        undo: {
          type: "fs_move_reverse",
          source: destPath,
          destination: sourcePath,
          resolvedSource: destCheck.resolvedPath,
          resolvedDestination: srcCheck.resolvedPath,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "move_failed", message: err.message } };
  }
}

/**
 * @param {string} targetPath
 * @param {{ approvalGranted?: boolean }} [accessOpts]
 */
export async function fsDeleteToTrash(targetPath, accessOpts = {}) {
  const check = checkPathAllowed(targetPath, "write", accessOpts);
  if (!check.allowed) return fsDenyEnvelope(check);

  if (process.platform === "win32") {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const escaped = check.resolvedPath.replace(/'/g, "''");
      await execFileAsync(
        "powershell",
        [
          "-Command",
          `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
        ],
        { timeout: 15_000 }
      );
      return {
        ok: true,
        data: {
          path: targetPath,
          resolvedPath: check.resolvedPath,
          trashPath: "Recycle Bin",
          platform: "win32",
        },
      };
    } catch (err) {
      return { ok: false, error: { code: "trash_failed", message: err.message } };
    }
  }

  const trashDir = join(homedir(), ".Trash");
  const name = basename(check.resolvedPath);
  let trashDest = join(trashDir, name);

  try {
    await mkdir(trashDir, { recursive: true }).catch(() => {});
    try {
      await stat(trashDest);
      trashDest = join(trashDir, `${name}.${Date.now()}`);
    } catch {
      /* unique name */
    }
    await rename(check.resolvedPath, trashDest);
    return {
      ok: true,
      data: {
        path: targetPath,
        resolvedPath: check.resolvedPath,
        trashPath: trashDest,
        undo: {
          type: "fs_restore_from_trash",
          originalPath: check.resolvedPath,
          trashPath: trashDest,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "trash_failed", message: err.message } };
  }
}
