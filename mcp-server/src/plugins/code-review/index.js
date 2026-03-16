/**
 * Code Review Plugin
 *
 * Automated PR reviews, code quality checks, security scanning
 */

import { readFile } from "fs/promises";
import { resolve, relative } from "path";
import { homedir } from "os";
import { Router } from "express";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { routeTask } from "../llm-router/index.js";
import { validateWorkspacePath } from "../../core/workspace-paths.js";

const handleError = createPluginErrorHandler("code-review");

const WORKSPACE_BASE = process.env.WORKSPACE_BASE || process.env.WORKSPACE_ROOT || `${homedir()}/Projects`;

/**
 * Validate path is within allowed workspace.
 * Uses workspace-paths when workspaceId provided for stricter isolation.
 */
function safePath(requestedPath, workspaceId = null) {
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
    return { valid: false, error: `Path is outside allowed workspace: ${requestedPath}` };
  }
  return { valid: true, path: resolved };
}

export const metadata = createMetadata({
  name:        "code-review",
  version:     "1.0.0",
  description: "Automated code review: security scanning, quality checks, and LLM-powered analysis.",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.MEDIUM,
  capabilities: ["read"],
  requires:    [],
  tags:        ["code-review", "security", "quality", "llm"],
  endpoints: [
    { method: "GET",  path: "/code-review/health",   description: "Plugin health",                    scope: "read" },
    { method: "POST", path: "/code-review/file",     description: "Review a single file",             scope: "read" },
    { method: "POST", path: "/code-review/pr",       description: "Review multiple files (PR style)", scope: "read" },
    { method: "POST", path: "/code-review/security", description: "Security-only scan of code",       scope: "read" },
  ],
  notes: "File paths validated against WORKSPACE_BASE. LLM review requires llm-router plugin.",
});

// Security patterns to detect
const SECURITY_PATTERNS = [
  {
    id: "hardcoded-secret",
    severity: "critical",
    pattern: /(?:password|secret|key|token)\s*[=:]\s*["'][^"']{8,}["']/i,
    message: "Potential hardcoded secret detected",
    suggestion: "Use environment variables or a secrets manager",
  },
  {
    id: "sql-injection",
    severity: "critical",
    pattern: /(?:query|exec)\s*\(\s*[`"'].*\$\{/,
    message: "Possible SQL injection vulnerability",
    suggestion: "Use parameterized queries or an ORM",
  },
  {
    id: "eval-usage",
    severity: "high",
    pattern: /\beval\s*\(/,
    message: "Dangerous eval() usage detected",
    suggestion: "Avoid eval(), use JSON.parse or safer alternatives",
  },
  {
    id: "inner-html",
    severity: "high",
    pattern: /\.innerHTML\s*=/,
    message: "innerHTML assignment can lead to XSS",
    suggestion: "Use textContent or sanitize HTML with DOMPurify",
  },
  {
    id: "insecure-random",
    severity: "medium",
    pattern: /Math\.random\s*\(\s*\)/,
    message: "Math.random() not cryptographically secure",
    suggestion: "Use crypto.getRandomValues() for security-sensitive operations",
  },
  {
    id: "disabled-security",
    severity: "high",
    pattern: /(?:rejectUnauthorized|verifySSL|verifyPeer)\s*[=:]\s*(?:false|0)/i,
    message: "SSL/TLS verification disabled",
    suggestion: "Never disable SSL verification in production",
  },
];

// Code quality rules
const QUALITY_RULES = [
  {
    id: "long-function",
    check: (code) => {
      const lines = code.split("\n");
      return lines.length > 50 ? { severity: "warning", message: `Function is ${lines.length} lines long` } : null;
    },
  },
  {
    id: "todo-comment",
    check: (code) => {
      const todos = code.match(/\/\/\s*TODO|#\s*TODO/g);
      return todos ? { severity: "info", message: `${todos.length} TODO comments found` } : null;
    },
  },
  {
    id: "console-log",
    check: (code) => {
      const logs = code.match(/console\.(log|warn|error|debug)/g);
      return logs ? { severity: "info", message: `${logs.length} console statements found` } : null;
    },
  },
  {
    id: "deep-nesting",
    check: (code) => {
      const nesting = code.match(/\{/g)?.length || 0;
      return nesting > 10 ? { severity: "warning", message: "High nesting depth detected" } : null;
    },
  },
];

/**
 * Perform security scan on code
 */
export function securityScan(code, filename) {
  const issues = [];

  for (const rule of SECURITY_PATTERNS) {
    if (rule.pattern.test(code)) {
      issues.push({
        id: rule.id,
        severity: rule.severity,
        file: filename,
        line: null, // Would need line number detection
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }

  return issues;
}

/**
 * Check code quality
 */
export function qualityCheck(code, filename) {
  const issues = [];

  for (const rule of QUALITY_RULES) {
    const result = rule.check(code);
    if (result) {
      issues.push({
        id: rule.id,
        severity: result.severity,
        file: filename,
        message: result.message,
      });
    }
  }

  return issues;
}

/**
 * Analyze code with LLM
 */
export async function llmReview(code, filename, context = {}) {
  const prompt = `Review the following code file: ${filename}

Context: ${JSON.stringify(context)}

Code:
\`\`\`
${code}
\`\`\`

Please provide:
1. Summary of what the code does
2. Any bugs or logic errors
3. Security concerns
4. Performance issues
5. Style/naming suggestions
6. Overall quality rating (1-10)

Format your response as JSON:
{
  "summary": "brief description",
  "bugs": [{"severity": "high|medium|low", "description": "...", "line": number}],
  "security": [{"severity": "...", "description": "..."}],
  "performance": [{"severity": "...", "description": "..."}],
  "style": [{"suggestion": "..."}],
  "rating": number,
  "recommendations": ["..."]
}`;

  try {
    const result = await routeTask("code_review", prompt, { maxTokens: 4000 });
    const raw = result?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { error: "Failed to parse LLM response", raw };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Review a single file
 */
export async function reviewFile(filepath, options = {}) {
  try {
    const code = await readFile(filepath, "utf-8");
    const filename = filepath.split("/").pop();

    const securityIssues = options.security !== false ? securityScan(code, filename) : [];
    const qualityIssues = options.quality !== false ? qualityCheck(code, filename) : [];
    const llmIssues = options.llm !== false ? await llmReview(code, filename, options.context) : null;

    return {
      file: filename,
      path: filepath,
      security: securityIssues,
      quality: qualityIssues,
      llm: llmIssues,
      stats: {
        lines: code.split("\n").length,
        chars: code.length,
      },
    };
  } catch (error) {
    return {
      file: filepath,
      error: error.message,
    };
  }
}

/**
 * Review multiple files (PR style)
 */
export async function reviewPR(files, options = {}) {
  const results = await Promise.all(
    files.map(f => reviewFile(f.path || f, options))
  );

  const summary = {
    totalFiles: files.length,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
    filesWithIssues: [],
  };

  for (const result of results) {
    const fileIssues = [...(result.security || []), ...(result.quality || [])];
    if (fileIssues.length > 0) {
      summary.filesWithIssues.push(result.file);
    }

    for (const issue of fileIssues) {
      if (issue.severity === "critical") summary.criticalIssues++;
      else if (issue.severity === "high") summary.highIssues++;
      else if (issue.severity === "medium") summary.mediumIssues++;
      else if (issue.severity === "low" || issue.severity === "info") summary.lowIssues++;
    }
  }

  return {
    summary,
    results,
  };
}

/**
 * Generate fix suggestions
 */
export async function generateFix(issue, code) {
  const prompt = `Given this code issue:

Issue: ${issue.message}
Severity: ${issue.severity}

Code:
\`\`\`
${code}
\`\`\`

Please provide a fix suggestion. Show the exact code change needed.`;

  try {
    const result = await routeTask("debugging", prompt, { maxTokens: 2000 });
    return result?.content ?? "";
  } catch (error) {
    return `Error generating fix: ${error.message}`;
  }
}

// MCP Tools
export const tools = [
  {
    name: "code_review_file",
    description: "Review a single code file: security scan, quality checks, and LLM-powered analysis. File must be inside WORKSPACE_BASE.",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path:     { type: "string",  description: "Path to the file to review (must be inside WORKSPACE_BASE)" },
        security: { type: "boolean", description: "Run security scan", default: true },
        quality:  { type: "boolean", description: "Run quality checks", default: true },
        llm:      { type: "boolean", description: "Run LLM-powered review (slower)", default: true },
      },
      required: ["path"],
    },
    handler: async ({ path, security, quality, llm }, context = {}) => {
      const v = safePath(path, context.workspaceId);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      try {
        const result = await reviewFile(v.path, { security, quality, llm });
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: { code: "review_error", message: error.message } };
      }
    },
  },
  {
    name: "code_review_pr",
    description: "Review multiple files like a PR review. Returns per-file issues and a summary with severity counts.",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path:   { type: "string" },
              status: { type: "string", enum: ["added", "modified", "deleted"] },
            },
          },
          description: "Files to review (each must be inside WORKSPACE_BASE)",
        },
        context: { type: "object", description: "Additional context (PR description, related issues)" },
      },
      required: ["files"],
    },
    handler: async ({ files, context: ctx }, toolContext = {}) => {
      const validated = [];
      const wsId = toolContext.workspaceId;
      for (const f of files) {
        const p = f.path || f;
        const v = safePath(p, wsId);
        if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
        validated.push({ ...f, path: v.path });
      }
      try {
        const result = await reviewPR(validated, { context: ctx });
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: { code: "pr_review_error", message: error.message } };
      }
    },
  },
  {
    name: "code_review_security",
    description: "Run a fast regex-based security scan on a code snippet. Detects hardcoded secrets, SQL injection, eval, innerHTML, and more.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        code:     { type: "string", description: "Code snippet to scan" },
        filename: { type: "string", description: "Filename for context (optional)" },
      },
      required: ["code"],
    },
    handler: ({ code, filename = "unnamed" }) => {
      const issues = securityScan(code, filename);
      return { ok: true, data: { issues, passed: issues.length === 0, count: issues.length } };
    },
  },
  {
    name: "code_review_suggest_fix",
    description: "Ask the LLM to suggest a fix for a specific code issue. Returns a diff-style suggestion.",
    tags: [ToolTags.READ_ONLY, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        issue: { type: "object", description: "Issue details (id, severity, message)" },
        code:  { type: "string", description: "Code snippet containing the issue" },
      },
      required: ["issue", "code"],
    },
    handler: async ({ issue, code }) => {
      try {
        const fix = await generateFix(issue, code);
        return { ok: true, data: { fix } };
      } catch (error) {
        return { ok: false, error: { code: "fix_error", message: error.message } };
      }
    },
  },
];

// Plugin registration
export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, plugin: "code-review", version: "1.0.0", securityPatterns: SECURITY_PATTERNS.length, qualityRules: QUALITY_RULES.length });
  });

  router.post("/file", requireScope("read"), async (req, res) => {
    const wsId = req.workspaceId || req.workspaceContext?.workspaceId;
    const v = safePath(req.body.path, wsId);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    try {
      const result = await reviewFile(v.path, req.body.options || {});
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json(handleError(err, "file"));
    }
  });

  router.post("/pr", requireScope("read"), async (req, res) => {
    const files = req.body.files;
    const wsId = req.workspaceId || req.workspaceContext?.workspaceId;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ ok: false, error: { code: "missing_files", message: "files array required" } });
    }
    const validated = [];
    for (const f of files) {
      const p = f.path || f;
      const v = safePath(p, wsId);
      if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
      validated.push({ ...f, path: v.path });
    }
    try {
      const result = await reviewPR(validated, req.body.options || {});
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json(handleError(err, "pr"));
    }
  });

  router.post("/security", requireScope("read"), (req, res) => {
    try {
      const { code, filename = "unnamed" } = req.body;
      if (!code) return res.status(400).json({ ok: false, error: { code: "missing_code", message: "code is required" } });
      const issues = securityScan(code, filename);
      res.json({ ok: true, data: { issues, passed: issues.length === 0, count: issues.length } });
    } catch (err) {
      res.status(500).json(handleError(err, "security"));
    }
  });

  app.use("/code-review", router);
}
