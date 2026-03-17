/**
 * Workspace Path Safety
 *
 * Centralized path validation: traversal prevention, workspace boundaries,
 * cross-workspace access blocking.
 */

import { resolve, relative } from "path";
import { getWorkspace } from "./workspace.js";

const WORKSPACE_ROOT_BASE = process.env.WORKSPACE_ROOT_BASE || process.env.WORKSPACE_ROOT || process.env.WORKSPACE_BASE || process.env.REPO_PATH || ".";

function isStrictMode() {
  return process.env.WORKSPACE_STRICT_BOUNDARIES === "true";
}

const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Sanitize workspace ID to prevent path traversal
 * @param {string} workspaceId
 * @returns {{ valid: boolean, sanitized?: string, error?: string }}
 */
export function sanitizeWorkspaceId(workspaceId) {
  if (!workspaceId || typeof workspaceId !== "string") {
    return { valid: false, error: "workspace_id_required" };
  }
  const trimmed = workspaceId.trim();
  if (!trimmed) return { valid: false, error: "workspace_id_empty" };
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
  if (sanitized !== trimmed) {
    return { valid: false, error: "workspace_id_invalid_chars", sanitized };
  }
  if (!WORKSPACE_ID_PATTERN.test(sanitized)) return { valid: false, error: "workspace_id_invalid" };
  return { valid: true, sanitized };
}

/**
 * Resolve workspace root path for a workspace ID
 * Uses per-workspace workspace_root if set, otherwise derived from base.
 * For "global", returns base directly (legacy WORKSPACE_ROOT behavior).
 * @param {string} workspaceId
 * @returns {string} Absolute path
 */
export function getWorkspaceRoot(workspaceId) {
  const ws = getWorkspace(workspaceId);
  if (ws?.settings?.workspace_root) {
    return resolve(ws.settings.workspace_root);
  }
  const base = resolve(process.cwd(), WORKSPACE_ROOT_BASE);
  const { valid, sanitized } = sanitizeWorkspaceId(workspaceId || "global");
  const safeId = valid ? sanitized : "global";
  if (safeId === "global") {
    return base;
  }
  return resolve(base, "workspaces", safeId);
}

/**
 * Validate path is within workspace boundary and safe
 * @param {string} requestedPath - User-provided path
 * @param {string} workspaceId
 * @param {Object} options
 * @param {boolean} [options.allowAbsolute] - Allow absolute paths within workspace
 * @returns {{valid: boolean, resolvedPath?: string, error?: string, reason?: string}}
 */
export function validateWorkspacePath(requestedPath, workspaceId, options = {}) {
  if (!requestedPath || typeof requestedPath !== "string") {
    return { valid: false, error: "path_required", reason: "Path is required" };
  }

  const wsId = workspaceId || "global";
  const { valid: idValid, error: idError } = sanitizeWorkspaceId(wsId);
  if (!idValid && isStrictMode()) {
    return { valid: false, error: idError || "invalid_workspace", reason: "Invalid workspace ID" };
  }

  let normalized = requestedPath.replace(/\\/g, "/").replace(/\/+/g, "/").trim();

  if (normalized.includes("..") || normalized.includes("~")) {
    return { valid: false, error: "path_traversal", reason: "Path traversal detected" };
  }

  try {
    const root = getWorkspaceRoot(wsId);
    const resolved = resolve(root, normalized.startsWith("/") ? normalized.slice(1) : normalized);
    const rel = relative(root, resolved);

    if (rel.startsWith("..") || rel.includes("../")) {
      return { valid: false, error: "path_escape", reason: "Path escapes workspace boundary" };
    }

    if (!resolved.startsWith(root)) {
      return { valid: false, error: "path_escape", reason: "Path outside workspace" };
    }

    return { valid: true, resolvedPath: resolved };
  } catch (err) {
    return { valid: false, error: "path_resolution_failed", reason: err.message };
  }
}

/**
 * Resolve path within workspace; returns null if invalid
 * @param {string} path
 * @param {string} workspaceId
 * @returns {string|null}
 */
export function resolvePathInWorkspace(path, workspaceId) {
  const result = validateWorkspacePath(path, workspaceId);
  return result.valid ? result.resolvedPath : null;
}

/**
 * Check if a target workspace is accessible from the caller's context
 * (prevents cross-workspace access when strict)
 * @param {string} callerWorkspaceId
 * @param {string} targetWorkspaceId
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAccessWorkspace(callerWorkspaceId, targetWorkspaceId) {
  if (!isStrictMode()) return { allowed: true };
  if (!callerWorkspaceId || callerWorkspaceId === "global") return { allowed: true };
  if (callerWorkspaceId === targetWorkspaceId) return { allowed: true };
  return { allowed: false, reason: "cross_workspace_access_denied" };
}

/**
 * Resolve and validate a path for a given workspace and operation.
 * Alias for validateWorkspacePath. Use resolvedPath for filesystem operations.
 * @param {string} requestedPath - Path (relative or absolute within workspace)
 * @param {string} workspaceId
 * @param {Object} [options]
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string, reason?: string }}
 */
export function resolveAndValidatePath(requestedPath, workspaceId, options = {}) {
  return validateWorkspacePath(requestedPath, workspaceId, options);
}

/**
 * Resolve workspace path — validates and returns absolute path or throws.
 * Use for filesystem operations. Requires workspaceId when WORKSPACE_REQUIRE_ID=true.
 * @param {string} requestedPath
 * @param {string} workspaceId
 * @returns {string} Resolved absolute path
 * @throws {Error} When path is invalid or workspaceId required but missing
 */
export function resolveWorkspacePath(requestedPath, workspaceId) {
  if (!workspaceId && process.env.WORKSPACE_REQUIRE_ID === "true") {
    const err = new Error("workspaceId is required for file operations");
    err.code = "WORKSPACE_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }
  const result = validateWorkspacePath(requestedPath, workspaceId || "global");
  if (!result.valid) {
    const err = new Error(result.reason || result.error || "Invalid path");
    err.code = result.error || "INVALID_PATH";
    err.statusCode = 400;
    err.details = { requestedPath, workspaceId };
    throw err;
  }
  return result.resolvedPath;
}

/**
 * Require workspaceId for file operations. Throws structured error if missing.
 * Call before any read/write when WORKSPACE_REQUIRE_ID=true.
 * @param {string} [workspaceId]
 * @param {string} [operation] - Operation name for error context
 * @throws {Error} When workspaceId is missing and required
 */
export function requireWorkspaceId(workspaceId, operation = "file_operation") {
  if (process.env.WORKSPACE_REQUIRE_ID !== "true") return;
  if (!workspaceId || (typeof workspaceId === "string" && workspaceId.trim() === "")) {
    const err = new Error(`workspaceId is required for ${operation}`);
    err.code = "WORKSPACE_ID_REQUIRED";
    err.statusCode = 400;
    err.details = { operation };
    throw err;
  }
}

/**
 * Validate path is within an explicit base directory (for plugins with custom roots).
 * Use when base is not derived from workspaceId (e.g. project-orchestrator).
 * @param {string} requestedPath - Path relative to base
 * @param {string} basePath - Absolute base directory
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string, reason?: string }}
 */
export function validatePathWithinBase(requestedPath, basePath) {
  if (!requestedPath || typeof requestedPath !== "string") {
    return { valid: false, error: "path_required", reason: "Path is required" };
  }
  if (!basePath || typeof basePath !== "string") {
    return { valid: false, error: "base_required", reason: "Base path is required" };
  }
  const normalized = requestedPath.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (normalized.includes("..") || normalized.includes("~")) {
    return { valid: false, error: "path_traversal", reason: "Path traversal detected" };
  }
  try {
    const base = resolve(basePath);
    const resolved = resolve(base, normalized.startsWith("/") ? normalized.slice(1) : normalized);
    const rel = relative(base, resolved);
    if (rel.startsWith("..") || rel.includes("../") || !resolved.startsWith(base)) {
      return { valid: false, error: "path_escape", reason: "Path escapes base boundary" };
    }
    return { valid: true, resolvedPath: resolved };
  } catch (err) {
    return { valid: false, error: "path_resolution_failed", reason: err.message };
  }
}
