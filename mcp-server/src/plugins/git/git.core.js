/**
 * Git Plugin - Core
 *
 * Git operations wrapper with security checks.
 * Uses workspace-paths when workspaceId is provided for stricter boundaries.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { join, resolve, relative } from "path";
import { homedir } from "os";
import { getWorkspaceRoot, validateWorkspacePath } from "../../core/workspace-paths.js";

const execAsync = promisify(exec);

const WORKSPACE_BASE = process.env.WORKSPACE_BASE || process.env.WORKSPACE_ROOT || join(homedir(), "Projects");

/**
 * Validate that a repo path is within the allowed workspace base.
 * When workspaceId is provided, uses per-workspace root for stricter isolation.
 * @param {string} requestedPath - Repository path
 * @param {string} [workspaceId] - Optional workspace ID for per-workspace root
 */
export function safeRepoPath(requestedPath, workspaceId = null) {
  if (workspaceId) {
    const result = validateWorkspacePath(requestedPath, workspaceId);
    if (!result.valid) {
      return { valid: false, error: result.reason || result.error || "Path validation failed" };
    }
    return { valid: true, path: result.resolvedPath };
  }
  const resolved = resolve(requestedPath);
  const rel      = relative(WORKSPACE_BASE, resolved);
  if (rel.startsWith("..") || rel.includes("../")) {
    return { valid: false, error: `Repository path is outside allowed workspace: ${requestedPath}` };
  }
  return { valid: true, path: resolved };
}

/**
 * Execute git command in workspace
 * @param {string} args - Git arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{ok: boolean, stdout?: string, stderr?: string, error?: Object}>}
 */
async function git(args, cwd) {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, { cwd });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "git_error",
        message: err.message,
        stderr: err.stderr?.trim(),
      },
    };
  }
}

/**
 * Get git status
 * @param {string} repoPath - Repository path
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitStatus(repoPath) {
  const result = await git("status --porcelain -b", repoPath);
  if (!result.ok) return result;

  const lines = result.stdout.split("\n").filter(Boolean);
  const branchLine = lines.find((l) => l.startsWith("##"));
  const files = lines.filter((l) => !l.startsWith("##"));

  // Parse branch info
  let branch = "unknown";
  let ahead = 0;
  let behind = 0;

  if (branchLine) {
    const match = branchLine.match(/##\s+([^\.\s]+)(?:\.\.\.[^\[]+)?(?:\[ahead\s+(\d+)(?:,\s*behind\s+(\d+))?\])?/);
    if (match) {
      branch = match[1];
      ahead = parseInt(match[2], 10) || 0;
      behind = parseInt(match[3], 10) || 0;
    }
  }

  // Parse file statuses
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of files) {
    const x = line[0]; // index status
    const y = line[1]; // working tree status
    const path = line.slice(3);

    if (x === "?" && y === "?") {
      untracked.push(path);
    } else if (x !== " ") {
      staged.push({ path, status: x });
    }
    if (y !== " ") {
      unstaged.push({ path, status: y });
    }
  }

  return {
    ok: true,
    data: {
      branch,
      ahead,
      behind,
      clean: files.length === 0,
      staged,
      unstaged,
      untracked,
      summary: {
        staged: staged.length,
        unstaged: unstaged.length,
        untracked: untracked.length,
      },
    },
  };
}

/**
 * Get git diff
 * @param {string} repoPath - Repository path
 * @param {Object} options
 * @param {boolean} options.staged - Show staged changes
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitDiff(repoPath, options = {}) {
  const args = options.staged ? "diff --staged" : "diff";
  const result = await git(args, repoPath);

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      diff: result.stdout,
      staged: options.staged,
      hasChanges: result.stdout.length > 0,
    },
  };
}

/**
 * Create and checkout branch
 * @param {string} repoPath - Repository path
 * @param {string} branchName - New branch name
 * @param {string} baseBranch - Base branch to checkout from (optional)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitBranchCreate(repoPath, branchName, baseBranch = null) {
  // Validate branch name
  if (!/^[a-zA-Z0-9._-]+$/.test(branchName)) {
    return {
      ok: false,
      error: { code: "invalid_branch_name", message: "Branch name contains invalid characters" },
    };
  }

  const base = baseBranch || "HEAD";
  const result = await git(`checkout -b ${branchName} ${base}`, repoPath);

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      branch: branchName,
      base: baseBranch,
      created: true,
    },
  };
}

/**
 * Checkout existing branch
 * @param {string} repoPath - Repository path
 * @param {string} branchName - Branch to checkout
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitCheckout(repoPath, branchName) {
  const result = await git(`checkout ${branchName}`, repoPath);

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      branch: branchName,
      checkedOut: true,
    },
  };
}

/**
 * Get commit log
 * @param {string} repoPath - Repository path
 * @param {Object} options
 * @param {number} options.limit - Number of commits (default 10)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitLog(repoPath, options = {}) {
  const limit = options.limit || 10;
  const format = '%H|%s|%an|%ae|%ad';
  const result = await git(`log -${limit} --pretty=format:"${format}"`, repoPath);

  if (!result.ok) return result;

  const commits = result.stdout.split("\n").filter(Boolean).map((line) => {
    const [hash, subject, author, email, date] = line.split("|");
    return {
      hash: hash.slice(0, 7),
      fullHash: hash,
      subject,
      author,
      email,
      date,
    };
  });

  return {
    ok: true,
    data: {
      commits,
      count: commits.length,
    },
  };
}

/**
 * Stage files
 * @param {string} repoPath - Repository path
 * @param {string[]} files - Files to stage
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitAdd(repoPath, files) {
  const paths = files.join(" ");
  const result = await git(`add ${paths}`, repoPath);

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      staged: files,
      count: files.length,
    },
  };
}

/**
 * Commit staged changes
 * @param {string} repoPath - Repository path
 * @param {string} message - Commit message
 * @param {Object} options
 * @param {string[]} options.files - Specific files to commit (stages them first)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitCommit(repoPath, message, options = {}) {
  // Stage specific files if provided
  if (options.files && options.files.length > 0) {
    const addResult = await gitAdd(repoPath, options.files);
    if (!addResult.ok) return addResult;
  }

  // Escape commit message
  const escapedMessage = message.replace(/"/g, '\\"');
  const result = await git(`commit -m "${escapedMessage}"`, repoPath);

  if (!result.ok) return result;

  // Extract commit hash from output
  const hashMatch = result.stdout.match(/\[.+\s+([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : null;

  return {
    ok: true,
    data: {
      committed: true,
      hash,
      message,
      files: options.files,
    },
  };
}

/**
 * Push commits
 * @param {string} repoPath - Repository path
 * @param {Object} options
 * @param {string} options.remote - Remote name (default: origin)
 * @param {string} options.branch - Branch to push (default: current)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function gitPush(repoPath, options = {}) {
  const remote = options.remote || "origin";
  const branch = options.branch || "";

  const args   = branch ? `${remote} ${branch}` : remote;
  const result = await git(`push ${args}`, repoPath);

  if (!result.ok) return result;

  return { ok: true, data: { pushed: true, remote, branch: branch || "current" } };
}

/**
 * Pull from remote
 */
export async function gitPull(repoPath, options = {}) {
  const remote = options.remote || "origin";
  const branch = options.branch || "";
  const args   = branch ? `${remote} ${branch}` : remote;
  const result = await git(`pull ${args}`, repoPath);

  if (!result.ok) return result;
  return { ok: true, data: { pulled: true, output: result.stdout } };
}

/**
 * List branches (local and/or remote)
 */
export async function gitBranchList(repoPath, options = {}) {
  const flag   = options.remote ? "-r" : options.all ? "-a" : "";
  const result = await git(`branch ${flag} --format="%(refname:short) %(HEAD)"`, repoPath);

  if (!result.ok) return result;

  const branches = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts   = line.trim().split(" ");
      const current = parts[1] === "*";
      return { name: parts[0], current };
    });

  return { ok: true, data: { branches, count: branches.length } };
}

/**
 * Stash changes (push or pop)
 */
export async function gitStash(repoPath, options = {}) {
  const action  = options.pop ? "pop" : "push";
  const message = (!options.pop && options.message) ? `--message "${options.message}"` : "";
  const result  = await git(`stash ${action} ${message}`.trim(), repoPath);

  if (!result.ok) return result;
  return { ok: true, data: { action, output: result.stdout } };
}
