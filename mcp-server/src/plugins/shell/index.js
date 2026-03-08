/**
 * Shell Execution Plugin
 *
 * Execute shell commands with safety controls.
 * Critical for Jarvis Vision - allows AI to run terminal commands.
 */

import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { ToolTags } from "../../core/tool-registry.js";
import { Errors, standardizeError } from "../../core/error-standard.js";
import { getPolicyEvaluator } from "../../core/policy-hooks.js";
import { randomBytes } from "crypto";
import { createAuditSink, MemoryAuditSink } from "./audit-sink.js";

const execAsync = promisify(exec);

// Initialize audit sink based on config (memory, file, redis, or multi)
let auditSink;
const auditType = process.env.SHELL_AUDIT_TYPE || "memory";
const auditFilePath = process.env.SHELL_AUDIT_FILE_PATH || "./logs/shell-audit.jsonl";
const auditMaxEntries = Number(process.env.SHELL_AUDIT_MAX_ENTRIES) || 1000;

try {
  auditSink = createAuditSink({
    type: auditType,
    filePath: auditFilePath,
    maxEntries: auditMaxEntries,
  });
  console.log(`[shell] Audit sink initialized: ${auditType}`);
} catch (err) {
  console.error(`[shell] Failed to create audit sink: ${err.message}. Falling back to memory.`);
  auditSink = new MemoryAuditSink(auditMaxEntries);
}

// Strict allowlist (configurable via env)
const ALLOWED_COMMANDS = new Set(
  (process.env.SHELL_ALLOWLIST || "ls,cat,echo,grep,find,head,tail,wc,stat,du,df,ps,top,uname,whoami,pwd,cd,mkdir,cp,mv,chmod,git,npm,node,python,python3,pip,which,whereis,date,uptime,free")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /\brm\b.+\s-rf?\b/,
  /\bsudo\b/,
  /\bchmod\s+[0-7]{3,4}\b/,
  /\bchown\b/,
  /&&|\|\||;/,
  /\|/,
  /[<>]/,
  /\$\([^)]*\)/,
  /`[^`]*`/,
  />\s*\/dev\/(sd|hd|vd|xvd)[a-z]/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bformat\b/,
  /\b(del|rd)\s+\/[sfq]/,
];

// Configurable timeout (ms)
const DEFAULT_TIMEOUT = Number(process.env.SHELL_DEFAULT_TIMEOUT_MS) || 30000;
const MAX_TIMEOUT = Number(process.env.SHELL_MAX_TIMEOUT_MS) || 300000;

// Allowed working directories (configurable)
const ALLOWED_WORKING_DIRS = (process.env.ALLOWED_WORKING_DIRS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function generateCorrelationId() {
  return randomBytes(8).toString("hex");
}

async function auditEntry({ command, cwd, allowed, reason, duration, exitCode, error, correlationId, actor }) {
  const entry = {
    timestamp: new Date().toISOString(),
    command,
    cwd: cwd || process.cwd(),
    allowed,
    reason,
    duration,
    exitCode,
    error: error ? String(error) : undefined,
    correlationId,
    actor: actor || "unknown",
  };
  await auditSink.write(entry);
  return entry;
}

async function getAuditLogEntries(limit = 100) {
  return auditSink.read(limit);
}

/**
 * Check if command is allowed (allowlist + dangerous patterns)
 */
function isCommandAllowed(command) {
  const trimmed = command.trim();
  const baseCmd = trimmed.split(/\s+/)[0].toLowerCase();

  if (!ALLOWED_COMMANDS.has(baseCmd)) {
    return { allowed: false, reason: "Command not in allowlist", baseCmd };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: "Dangerous pattern detected", pattern: pattern.source };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Validate working directory
 * Secure by default: if ALLOWED_WORKING_DIRS is empty, only current working directory is allowed
 */
function validateWorkingDir(cwd) {
  if (!cwd) return true; // No explicit cwd means use process.cwd() which is always allowed
  
  const path = require("path");
  const resolved = path.resolve(cwd);
  const currentCwd = path.resolve(process.cwd());
  
  // If no working directories configured, only allow current working directory
  if (ALLOWED_WORKING_DIRS.length === 0) {
    return resolved === currentCwd || resolved.startsWith(currentCwd + path.sep);
  }
  
  // Check against configured allowed directories
  return ALLOWED_WORKING_DIRS.some((allowed) =>
    resolved.startsWith(path.resolve(allowed))
  );
}

/**
 * Execute a shell command
 */
async function executeCommand(command, options = {}) {
  const {
    cwd = process.cwd(),
    timeout = DEFAULT_TIMEOUT,
    env = {},
    captureOutput = true,
    correlationId = generateCorrelationId(),
    actor = null,
  } = options;

  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) {
    const err = Errors.authorization(`Shell command denied: ${allowedCheck.reason}`);
    await auditEntry({ command, cwd, allowed: false, reason: allowedCheck.reason, correlationId, actor });
    throw err;
  }

  if (!validateWorkingDir(cwd)) {
    const err = Errors.validation(`Working directory not allowed: ${cwd}`);
    await auditEntry({ command, cwd, allowed: false, reason: "Invalid working directory", correlationId, actor });
    throw err;
  }

  // Policy check (if available)
  const evaluate = getPolicyEvaluator();
  if (evaluate) {
    const requestedBy = actor?.type === "api_key" ? `key:${actor.scopes?.join(",") || "read"}` : "unknown";
    const policyResult = evaluate("POST", "/shell/execute", { command, cwd, timeout }, requestedBy);
    if (!policyResult.allowed) {
      const err = Errors.authorization(`Policy denied: ${policyResult.reason || "Shell command blocked by policy"}`);
      await auditEntry({ command, cwd, allowed: false, reason: "Policy denied", correlationId, actor });
      throw err;
    }
  }

  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: effectiveTimeout,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const duration = Date.now() - startTime;
    const entry = await auditEntry({ command, cwd, allowed: true, duration, exitCode: 0, correlationId, actor });

    return {
      command,
      cwd,
      exitCode: 0,
      stdout: captureOutput ? stdout : null,
      stderr: captureOutput ? stderr : null,
      duration,
      timestamp: entry.timestamp,
      correlationId,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const isTimeout = err.code === "ETIMEDOUT" || err.message.includes("timeout");
    const exitCode = typeof err.code === "number" ? err.code : err.code === "ETIMEDOUT" ? 124 : 1;

    await auditEntry({
      command,
      cwd,
      allowed: true,
      duration,
      exitCode,
      error: err.message,
      correlationId,
      actor,
    });

    if (isTimeout) {
      throw Errors.timeout("Shell command execution");
    } else {
      throw Errors.externalError("shell", err.message);
    }
  }
}

/**
 * Execute command with streaming output
 */
function executeCommandStream(command, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    onStdout = null,
    onStderr = null,
    onExit = null,
    correlationId = generateCorrelationId(),
    actor = null,
  } = options;

  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) {
    const err = Errors.authorization(`Shell command denied: ${allowedCheck.reason}`);
    auditSink.write({ command, cwd, allowed: false, reason: allowedCheck.reason, timestamp: new Date().toISOString(), correlationId, actor: actor || "unknown" });
    throw err;
  }

  if (!validateWorkingDir(cwd)) {
    const err = Errors.validation(`Working directory not allowed: ${cwd}`);
    auditSink.write({ command, cwd, allowed: false, reason: "Invalid working directory", timestamp: new Date().toISOString(), correlationId, actor: actor || "unknown" });
    throw err;
  }

  // Policy check (if available)
  const evaluate = getPolicyEvaluator();
  if (evaluate) {
    const requestedBy = actor?.type === "api_key" ? `key:${actor.scopes?.join(",") || "read"}` : "unknown";
    const policyResult = evaluate("POST", "/shell/execute/stream", { command, cwd }, requestedBy);
    if (!policyResult.allowed) {
      const err = Errors.authorization(`Policy denied: ${policyResult.reason || "Shell command blocked by policy"}`);
      auditSink.write({ command, cwd, allowed: false, reason: "Policy denied", timestamp: new Date().toISOString(), correlationId, actor: actor || "unknown" });
      throw err;
    }
  }

  const parts = command.split(" ");
  const cmd = parts[0];
  const args = parts.slice(1);

  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
  });

  const result = {
    command,
    cwd,
    pid: child.pid,
    stdout: "",
    stderr: "",
    timestamp: new Date().toISOString(),
    correlationId,
  };

  const streamStartTime = Date.now();

  if (onStdout) {
    child.stdout?.on("data", (data) => {
      const chunk = data.toString();
      result.stdout += chunk;
      onStdout(chunk);
    });
  }

  if (onStderr) {
    child.stderr?.on("data", (data) => {
      const chunk = data.toString();
      result.stderr += chunk;
      onStderr(chunk);
    });
  }

  child.on("close", (code) => {
    result.exitCode = code;
    result.duration = Date.now() - streamStartTime;
    auditSink.write({ command, cwd, allowed: true, duration: result.duration, exitCode: code, timestamp: new Date().toISOString(), correlationId, actor: actor || "unknown" });
    if (onExit) onExit(code, result);
  });

  child.on("error", (err) => {
    result.error = err.message;
    auditSink.write({ command, cwd, allowed: true, duration: Date.now() - streamStartTime, exitCode: null, error: err.message, timestamp: new Date().toISOString(), correlationId, actor: actor || "unknown" });
  });

  return child;
}

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name = "shell";
export const version = "1.0.0";
export const description = "Execute shell commands with safety controls";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "POST", path: "/shell/execute", description: "Execute a shell command", scope: "write" },
  { method: "POST", path: "/shell/execute/stream", description: "Execute with streaming output (SSE)", scope: "write" },
  { method: "GET", path: "/shell/audit", description: "Get shell execution audit log", scope: "read" },
  { method: "GET", path: "/shell/safety", description: "Get safety configuration", scope: "read" },
];
export const examples = [
  'POST /shell/execute  body: {"command":"ls -la","cwd":"./workspace"}',
  'POST /shell/execute  body: {"command":"npm install","timeout":60000}',
  'GET /shell/audit?limit=10',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "shell_execute",
    description: "Execute a shell command with safety controls",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeout: { type: "number", default: 30000, description: "Timeout in ms" },
        env: { type: "object", description: "Environment variables" },
      },
      required: ["command"],
    },
    handler: async (args, context) => {
      try {
        const correlationId = generateCorrelationId();
        const actor = context?.actor || null;
        const result = await executeCommand(args.command, {
          cwd: args.cwd,
          timeout: args.timeout || DEFAULT_TIMEOUT,
          env: args.env,
          correlationId,
          actor,
        });
        return {
          ok: true,
          data: {
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration: result.duration,
            correlationId: result.correlationId,
          },
        };
      } catch (err) {
        const standardized = standardizeError(err, "shell_execute");
        return {
          ok: false,
          error: {
            code: standardized.code,
            category: standardized.category,
            message: standardized.message,
            userSafeMessage: standardized.userSafeMessage,
            retryable: standardized.retryable,
            ...(standardized.details && { details: standardized.details }),
          },
        };
      }
    },
  },
  {
    name: "shell_audit",
    description: "Get shell execution audit log",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10, description: "Number of entries" },
      },
    },
    handler: async (args) => {
      return {
        ok: true,
        data: { audit: await getAuditLogEntries(args.limit || 10) },
      };
    },
  },
  {
    name: "shell_safety_check",
    description: "Check if a command would be allowed",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to check" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const allowed = isCommandAllowed(args.command);
      const cwdAllowed = validateWorkingDir(args.cwd);
      return {
        ok: true,
        data: {
          command: args.command,
          allowed: allowed.allowed && cwdAllowed,
          allowedCommand: allowed.allowed,
          reason: allowed.reason,
          cwdAllowed,
          allowlist: Array.from(ALLOWED_COMMANDS),
          dangerousPatterns: DANGEROUS_PATTERNS.map(p => p.source),
          allowedDirs: ALLOWED_WORKING_DIRS,
          defaultTimeout: DEFAULT_TIMEOUT,
          maxTimeout: MAX_TIMEOUT,
        },
      };
    },
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // Execute command
  router.post("/execute", async (req, res) => {
    const { command, cwd, timeout = 30000, env } = req.body || {};

    if (!command) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_command", message: "Command is required" },
      });
    }

    try {
      const correlationId = generateCorrelationId();
      const actor = req.actor || null;
      const result = await executeCommand(command, { cwd, timeout, env, correlationId, actor });
      res.json({
        ok: true,
        data: {
          command: result.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration: result.duration,
          timestamp: result.timestamp,
          correlationId: result.correlationId,
        },
      });
    } catch (err) {
      const standardized = standardizeError(err, "shell_execute");
      res.status(standardized.statusCode || 500).json(standardized.serialize(req.requestId));
    }
  });

  // Execute with streaming (SSE)
  router.post("/execute/stream", (req, res) => {
    const { command, cwd, env } = req.body || {};

    if (!command) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_command", message: "Command is required" },
      });
    }

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const correlationId = generateCorrelationId();
      const actor = req.actor || null;
      const child = executeCommandStream(command, {
        cwd,
        env,
        correlationId,
        actor,
        onStdout: (chunk) => {
          res.write(`data: ${JSON.stringify({ type: "stdout", data: chunk })}\n\n`);
        },
        onStderr: (chunk) => {
          res.write(`data: ${JSON.stringify({ type: "stderr", data: chunk })}\n\n`);
        },
        onExit: (code) => {
          res.write(`data: ${JSON.stringify({ type: "exit", code })}\n\n`);
          res.end();
        },
      });

      // Handle client disconnect
      req.on("close", () => {
        child.kill();
      });
    } catch (err) {
      const standardized = standardizeError(err, "shell_execute_stream");
      res.write(`data: ${JSON.stringify({ type: "error", error: standardized.serialize(req.requestId) })}\n\n`);
      res.end();
    }
  });

  // Get audit log
  router.get("/audit", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: await getAuditLogEntries(limit) } });
  });

  // Get safety config
  router.get("/safety", (_req, res) => {
    res.json({
      ok: true,
      data: {
        allowlist: Array.from(ALLOWED_COMMANDS),
        dangerousPatterns: DANGEROUS_PATTERNS.map(p => p.source),
        allowedDirectories: ALLOWED_WORKING_DIRS,
        defaultTimeout: DEFAULT_TIMEOUT,
        maxTimeout: MAX_TIMEOUT,
      },
    });
  });

  app.use("/shell", router);
}
