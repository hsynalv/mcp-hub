/**
 * Repo Intelligence Plugin - Core
 *
 * Repository analysis and data collection functions.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readdir, stat, readFile } from "fs/promises";
import { join, relative, resolve } from "path";

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * The root directory that all repo path requests must be confined to.
 * Defaults to cwd(); override with REPO_PATH env var for production.
 */
export const BASE_REPO_PATH = resolve(process.env.REPO_PATH || process.cwd());

/**
 * Validate and resolve a requested repo path.
 * Throws if the resolved path escapes BASE_REPO_PATH (path traversal prevention).
 *
 * @param {string} requestedPath - The path provided by the caller
 * @returns {string} Resolved absolute path
 */
export function safeResolvePath(requestedPath) {
  const resolved = resolve(requestedPath);
  if (!resolved.startsWith(BASE_REPO_PATH)) {
    throw Object.assign(
      new Error(`Path "${requestedPath}" is outside the allowed base directory`),
      { code: "path_traversal", base: BASE_REPO_PATH, requested: resolved }
    );
  }
  return resolved;
}

const execAsync = promisify(exec);

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
 * Get recent commits with detailed info
 * @param {string} repoPath - Repository path
 * @param {number} limit - Number of commits (default 20)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function getRecentCommits(repoPath, limit = 20) {
  try { repoPath = safeResolvePath(repoPath); } catch (err) {
    return { ok: false, error: { code: err.code || "path_error", message: err.message } };
  }

  // Get commits with stats
  const format = '%H|%s|%an|%ae|%ad|%b';
  const result = await git(`log -${limit} --pretty=format:"${format}" --stat`, repoPath);

  if (!result.ok) return result;

  const commits = [];
  let currentCommit = null;
  let lines = result.stdout.split("\n");

  for (const line of lines) {
    if (line.includes("|")) {
      const parts = line.split("|");
      if (parts.length >= 5 && parts[0].match(/^[a-f0-9]{40}$/)) {
        if (currentCommit) commits.push(currentCommit);
        currentCommit = {
          hash: parts[0].slice(0, 7),
          fullHash: parts[0],
          subject: parts[1],
          author: parts[2],
          email: parts[3],
          date: parts[4],
          body: parts[5] || "",
          files: [],
          stats: { insertions: 0, deletions: 0 },
        };
      }
    } else if (line.match(/^\s+\d+\s+files?\s+changed/)) {
      const match = line.match(/(\d+)\s+insertions?\(\+\).*?(\d+)\s+deletions?/);
      if (match && currentCommit) {
        currentCommit.stats.insertions = parseInt(match[1], 10) || 0;
        currentCommit.stats.deletions = parseInt(match[2], 10) || 0;
      }
    } else if (line.match(/^\s+[\w\-\/\.]+\s+\|/)) {
      const fileMatch = line.match(/^\s+([\w\-\/\.]+)\s+\|/);
      if (fileMatch && currentCommit) {
        currentCommit.files.push(fileMatch[1]);
      }
    }
  }

  if (currentCommit) commits.push(currentCommit);

  return {
    ok: true,
    data: {
      commits,
      count: commits.length,
      summary: {
        totalInsertions: commits.reduce((sum, c) => sum + c.stats.insertions, 0),
        totalDeletions: commits.reduce((sum, c) => sum + c.stats.deletions, 0),
        uniqueAuthors: [...new Set(commits.map(c => c.author))].length,
      },
    },
  };
}

/**
 * Get repository file structure
 * @param {string} repoPath - Repository path
 * @param {Object} options - Options
 * @param {number} options.maxDepth - Maximum depth to traverse (default 3)
 * @param {string[]} options.exclude - Patterns to exclude
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function getProjectStructure(repoPath, options = {}) {
  try { repoPath = safeResolvePath(repoPath); } catch (err) {
    return { ok: false, error: { code: err.code || "path_error", message: err.message } };
  }

  const maxDepth = options.maxDepth || 3;
  const exclude = options.exclude || [
    "node_modules", ".git", "dist", "build", ".next", 
    "coverage", "__pycache__", ".venv", "venv"
  ];

  async function traverse(dir, depth = 0) {
    if (depth > maxDepth) return null;

    const entries = [];
    try {
      const items = await readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (exclude.some(pattern => item.name.includes(pattern))) continue;

        const fullPath = join(dir, item.name);
        const relativePath = relative(repoPath, fullPath);

        if (item.isDirectory()) {
          const children = await traverse(fullPath, depth + 1);
          entries.push({
            type: "directory",
            name: item.name,
            path: relativePath,
            children: children || [],
          });
        } else {
          const fileStat = await stat(fullPath);
          entries.push({
            type: "file",
            name: item.name,
            path: relativePath,
            size: fileStat.size,
          });
        }
      }
    } catch (err) {
      return null;
    }

    return entries;
  }

  try {
    const structure = await traverse(repoPath);
    
    // Detect project type
    const projectType = detectProjectType(structure);
    
    // Get key files content (README, package.json, etc.)
    const keyFiles = await getKeyFiles(repoPath, structure);

    return {
      ok: true,
      data: {
        structure,
        projectType,
        keyFiles,
        stats: {
          totalFiles: countFiles(structure),
          totalDirs: countDirs(structure),
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "structure_error", message: err.message },
    };
  }
}

/**
 * Detect project type from structure
 * @param {Array} structure - Directory structure
 * @returns {string}
 */
function detectProjectType(structure) {
  const files = flattenFiles(structure);
  const names = files.map(f => f.name);

  if (names.includes("package.json")) {
    if (names.includes("next.config.js") || names.includes("next.config.ts")) return "nextjs";
    if (names.includes("vite.config.js") || names.includes("vite.config.ts")) return "vite";
    if (names.some(n => n.includes("react"))) return "react";
    return "nodejs";
  }
  
  if (names.includes("requirements.txt") || names.includes("pyproject.toml") || names.includes("setup.py")) {
    if (names.includes("django")) return "django";
    if (names.includes("fastapi")) return "fastapi";
    if (names.includes("flask")) return "flask";
    return "python";
  }
  
  if (names.includes("Cargo.toml")) return "rust";
  if (names.includes("go.mod")) return "go";
  if (names.includes("pom.xml") || names.includes("build.gradle")) return "java";
  if (names.includes("Dockerfile")) return "docker";
  
  return "unknown";
}

/**
 * Get key project files content
 * @param {string} repoPath - Repository path
 * @param {Array} structure - Directory structure
 * @returns {Promise<Object>}
 */
async function getKeyFiles(repoPath, structure) {
  const keyFiles = {};
  const targetFiles = ["README.md", "package.json", "requirements.txt", ".env.example", "docker-compose.yml", "Dockerfile"];
  
  const files = flattenFiles(structure);
  
  for (const file of files) {
    if (targetFiles.includes(file.name)) {
      try {
        const content = await readFile(join(repoPath, file.path), "utf8");
        keyFiles[file.name] = content.slice(0, 5000); // Limit content size
      } catch (err) {
        // Skip if can't read
      }
    }
  }
  
  return keyFiles;
}

/**
 * Flatten file structure to array
 * @param {Array} structure - Directory structure
 * @returns {Array}
 */
function flattenFiles(structure) {
  const files = [];
  for (const item of structure || []) {
    if (item.type === "file") {
      files.push(item);
    } else if (item.children) {
      files.push(...flattenFiles(item.children));
    }
  }
  return files;
}

/**
 * Count files in structure
 * @param {Array} structure - Directory structure
 * @returns {number}
 */
function countFiles(structure) {
  let count = 0;
  for (const item of structure || []) {
    if (item.type === "file") count++;
    if (item.children) count += countFiles(item.children);
  }
  return count;
}

/**
 * Count directories in structure
 * @param {Array} structure - Directory structure
 * @returns {number}
 */
function countDirs(structure) {
  let count = 0;
  for (const item of structure || []) {
    if (item.type === "directory") {
      count++;
      if (item.children) count += countDirs(item.children);
    }
  }
  return count;
}

/**
 * Get open issues/todos from code comments
 * @param {string} repoPath - Repository path
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function getOpenIssues(repoPath) {
  try { repoPath = safeResolvePath(repoPath); } catch (err) {
    return { ok: false, error: { code: err.code || "path_error", message: err.message } };
  }

  const issues = [];
  const patterns = [
    { pattern: /TODO[\s:]*(.+?)$/gmi, type: "TODO" },
    { pattern: /FIXME[\s:]*(.+?)$/gmi, type: "FIXME" },
    { pattern: /BUG[\s:]*(.+?)$/gmi, type: "BUG" },
    { pattern: /HACK[\s:]*(.+?)$/gmi, type: "HACK" },
    { pattern: /XXX[\s:]*(.+?)$/gmi, type: "XXX" },
  ];

  const codeExtensions = [".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".go", ".rs", ".php", ".rb"];
  
  async function scanDirectory(dir, depth = 0) {
    if (depth > 3) return;
    
    try {
      const items = await readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.name.includes("node_modules") || item.name.includes(".git")) continue;
        
        const fullPath = join(dir, item.name);
        
        if (item.isDirectory()) {
          await scanDirectory(fullPath, depth + 1);
        } else if (codeExtensions.some(ext => item.name.endsWith(ext))) {
          try {
            const content = await readFile(fullPath, "utf8");
            const relativePath = relative(repoPath, fullPath);
            
            for (const { pattern, type } of patterns) {
              let match;
              while ((match = pattern.exec(content)) !== null) {
                const lines = content.slice(0, match.index).split("\n");
                const lineNumber = lines.length;
                
                issues.push({
                  type,
                  message: match[1].trim(),
                  file: relativePath,
                  line: lineNumber,
                });
              }
              pattern.lastIndex = 0; // Reset for next file
            }
          } catch (err) {
            // Skip unreadable files
          }
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }

  await scanDirectory(repoPath);

  // Group by type
  const grouped = issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    data: {
      issues,
      count: issues.length,
      summary: grouped,
    },
  };
}
