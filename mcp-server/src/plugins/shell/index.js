/**
 * Shell Execution Plugin
 *
 * Execute shell commands with safety controls, allowlists, and audit logging.
 * Pipes (|) and compound operators (&&, ||, ;) are allowed when ALL referenced
 * binaries are in the command allowlist.
 */

import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { resolve, sep } from "path";
import { ToolTags } from "../../core/tool-registry.js";
import { Errors, standardizeError } from "../../core/error-standard.js";
import { canExecute, getPolicyManager } from "../../core/policy/index.js";
import { auditLog, getAuditManager, generateCorrelationId as coreGenerateCorrelationId } from "../../core/audit/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { requireScope } from "../../core/auth.js";

// ── Plugin Metadata ──────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "shell",
  version: "1.1.0",
  description: "Execute shell commands with safety controls, allowlists, and audit logging",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write", "admin"],
  capabilities: ["execute", "shell", "stream", "audit"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.CRITICAL,
  owner: "platform-team",
  tags: ["execution", "shell", "commands", "system"],
  dependencies: [],
  since: "1.0.0",
  notes: "Shell execution is highly restricted. Sessions allow stateful runs (same cwd, background commands). Pipes and compound operators allowed when all binaries are in the allowlist. SHELL_MAX_SESSIONS env limits concurrent sessions.",
});

const execAsync = promisify(exec);

// ── Safety configuration ──────────────────────────────────────────────────────

const ALLOWED_COMMANDS = new Set(
  (process.env.SHELL_ALLOWLIST ||
    "ls,cat,echo,grep,find,head,tail,wc,stat,du,df,ps,uname,whoami,pwd,mkdir,cp,mv,git,npm,node,python,python3,pip,which,whereis,date,uptime,curl,wget,jq,sed,awk,sort,uniq,cut,tr,xargs,diff,tar,zip,unzip,touch,file,env,printenv,test")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Patterns that are ALWAYS blocked regardless of allowlist.
 * These cover genuinely destructive or privilege-escalation operations.
 * Pipes (|), compound operators (&&, ||, ;) and redirects are NOT here —
 * they are handled by allowlist-aware parsing instead.
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+.*-[rf]*r/i,              // rm -rf (any order of -r -f)
  /\bsudo\b/i,                       // sudo escalation
  /\bsu\b\s+-/i,                     // su - (user switching)
  /\bchmod\s+[0-7]{3,4}\b/,         // chmod with octal mode
  /\bchown\b/i,                      // chown
  /\bdd\s+if=/i,                     // dd if= (disk dump)
  /\bmkfs\b/i,                       // format filesystem
  /\bfdisk\b/i,                      // partition table editor
  /\bformat\b\s+[a-z]:/i,           // Windows format
  />\s*\/dev\/(sd|hd|vd|xvd|nvme)/i, // redirect to disk device
  /\bcurl\b.*\|\s*\bbash\b/i,        // curl | bash (remote code exec)
  /\bwget\b.*-O\s*-\s*\|\s*\bbash\b/i, // wget | bash
  /\$\([^)]*\)/,                     // command substitution $(...)
  /`[^`]*`/,                         // backtick substitution
  /\beval\b/i,                       // eval
  /\bexec\b\s+/i,                    // exec (replace process)
  /\bkill\b\s+-9\s+1\b/,            // kill init (kill -9 1)
  /\b(del|rd)\s+\/[sfq]/i,           // Windows del /s /f /q
];

const DEFAULT_TIMEOUT = Number(process.env.SHELL_DEFAULT_TIMEOUT_MS) || 30_000;
const MAX_TIMEOUT     = Number(process.env.SHELL_MAX_TIMEOUT_MS)     || 300_000;

const ALLOWED_WORKING_DIRS = (process.env.ALLOWED_WORKING_DIRS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const MAX_SESSIONS = Math.max(1, parseInt(process.env.SHELL_MAX_SESSIONS, 10) || 10);
const MAX_SESSION_OUTPUT_LINES = 500;

// ── Session store (stateful shell — Manus pattern) ─────────────────────────────

const sessions = new Map(); // sessionId -> { id, cwd, env, pid, outputLines[], lastCommand, createdAt }

function generateSessionId() {
  return `sh-${randomBytes(8).toString("hex")}`;
}

function createSession(cwd = process.cwd(), env = {}) {
  if (sessions.size >= MAX_SESSIONS) {
    return { ok: false, error: { code: "max_sessions", message: `Max sessions (${MAX_SESSIONS}) reached. Close one first.` } };
  }
  const resolvedCwd = resolve(cwd || process.cwd());
  if (!validateWorkingDir(resolvedCwd)) {
    return { ok: false, error: { code: "invalid_cwd", message: "Working directory not allowed" } };
  }
  const id = generateSessionId();
  sessions.set(id, {
    id,
    cwd: resolvedCwd,
    env: { ...env },
    pid: null,
    outputLines: [],
    lastCommand: null,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, data: { session_id: id, cwd: resolvedCwd } };
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function appendSessionOutput(session, stdout, stderr) {
  if (!session) return;
  const lines = [];
  if (stdout) lines.push(...String(stdout).split("\n").filter(Boolean));
  if (stderr) lines.push(...String(stderr).split("\n").filter(Boolean));
  for (const line of lines) {
    session.outputLines.push(line);
    if (session.outputLines.length > MAX_SESSION_OUTPUT_LINES) session.outputLines.shift();
  }
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: { code: "not_found", message: `Session ${sessionId} not found` } };
  if (session.pid) {
    try { process.kill(session.pid, "SIGTERM"); } catch { /* already dead */ }
    session.pid = null;
  }
  sessions.delete(sessionId);
  return { ok: true, data: { session_id: sessionId, closed: true } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCorrelationId() {
  return coreGenerateCorrelationId
    ? coreGenerateCorrelationId()
    : `shell-${randomBytes(8).toString("hex")}`;
}

async function auditEntry({ command, cwd, allowed, reason, duration, exitCode, error, correlationId, actor, workspaceId }) {
  await auditLog({
    plugin: "shell",
    operation: "execute",
    actor: actor || "unknown",
    workspaceId: workspaceId || "global",
    correlationId,
    allowed,
    success: allowed && exitCode === 0,
    durationMs: duration,
    reason: reason || undefined,
    error: error || undefined,
    metadata: {
      command,
      cwd: cwd || process.cwd(),
      exitCode: exitCode !== undefined ? exitCode : null,
    },
  });
}

async function getAuditLogEntries(limit = 100) {
  return getAuditManager().read(limit);
}

/**
 * Extract all binary names from a (possibly compound) command.
 *
 * Strips quoted strings first so operators inside quotes (e.g. `echo "a && b"`)
 * are not mistaken for compound-command separators.
 *
 * Limitation: very complex quoting or heredocs are not fully parsed.
 * Keep commands simple — avoid shell meta-characters inside quoted strings.
 */
function parseCommandBinaries(command) {
  // Remove single- and double-quoted strings to avoid false splits on operators inside quotes
  const stripped = command
    .replace(/"[^"]*"/g, '""')   // "hello && world" → ""
    .replace(/'[^']*'/g, "''");  // 'hello && world' → ''

  return stripped
    .split(/&&|\|\||;|\|/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(segment => segment.split(/\s+/)[0].toLowerCase())
    .filter(Boolean);
}

/**
 * Check if command is allowed:
 *   1. Every binary in the command must be in the allowlist.
 *   2. No DANGEROUS_PATTERNS may match.
 */
function isCommandAllowed(command) {
  const trimmed = command.trim();

  // Always block dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: "Dangerous pattern detected", pattern: pattern.source };
    }
  }

  // Every binary (before and after pipes/&&/||/;) must be in the allowlist
  const binaries = parseCommandBinaries(trimmed);
  for (const bin of binaries) {
    if (bin && !ALLOWED_COMMANDS.has(bin)) {
      return { allowed: false, reason: `Command not in allowlist: ${bin}`, baseCmd: bin };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Validate working directory — prevents path traversal.
 * Uses static import of `path` (no require()).
 */
function validateWorkingDir(cwd) {
  if (!cwd) return true;

  const resolved   = resolve(cwd);
  const currentCwd = resolve(process.cwd());

  if (ALLOWED_WORKING_DIRS.length === 0) {
    return resolved === currentCwd || resolved.startsWith(currentCwd + sep);
  }

  return ALLOWED_WORKING_DIRS.some(allowed => resolved.startsWith(resolve(allowed)));
}

// ── Core execution ───────────────────────────────────────────────────────────

async function executeCommand(command, options = {}) {
  const {
    cwd          = process.cwd(),
    timeout      = DEFAULT_TIMEOUT,
    env          = {},
    captureOutput = true,
    correlationId = generateCorrelationId(),
    actor        = null,
  } = options;

  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) {
    await auditEntry({ command, cwd, allowed: false, reason: allowedCheck.reason, correlationId, actor });
    throw Errors.authorization(`Shell command denied: ${allowedCheck.reason}`);
  }

  if (!validateWorkingDir(cwd)) {
    await auditEntry({ command, cwd, allowed: false, reason: "Invalid working directory", correlationId, actor });
    throw Errors.validation(`Working directory not allowed: ${cwd}`);
  }

  const policyManager = getPolicyManager();
  if (policyManager) {
    const policyResult = await canExecute({
      actor: actor?.type === "api_key" ? `key:${actor.scopes?.join(",") || "read"}` : (actor || "unknown"),
      workspaceId: cwd || "global",
      command,
      metadata: { timeout },
    });
    if (!policyResult.allowed) {
      await auditEntry({ command, cwd, allowed: false, reason: policyResult.reason || "Policy denied", correlationId, actor });
      throw Errors.authorization(`Policy denied: ${policyResult.reason || "Shell command blocked by policy"}`);
    }
  }

  const effectiveTimeout = Math.min(Math.max(timeout, 1_000), MAX_TIMEOUT);
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: effectiveTimeout,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    await auditEntry({ command, cwd, allowed: true, duration, exitCode: 0, correlationId, actor });

    return {
      command,
      cwd,
      exitCode: 0,
      stdout: captureOutput ? stdout : null,
      stderr: captureOutput ? stderr : null,
      duration,
      timestamp: new Date().toISOString(),
      correlationId,
    };
  } catch (execErr) {
    const duration  = Date.now() - startTime;
    const isTimeout = execErr.code === "ETIMEDOUT" || execErr.message?.includes("timeout");
    const exitCode  = typeof execErr.code === "number" ? execErr.code : isTimeout ? 124 : 1;

    await auditEntry({ command, cwd, allowed: true, duration, exitCode, error: execErr.message, correlationId, actor });

    if (isTimeout) throw Errors.timeout("Shell command execution");
    throw Errors.externalError("shell", execErr.message);
  }
}

/**
 * Execute command with streaming output (async — policy is properly awaited).
 */
async function executeCommandStream(command, options = {}) {
  const {
    cwd          = process.cwd(),
    env          = {},
    onStdout     = null,
    onStderr     = null,
    onExit       = null,
    correlationId = generateCorrelationId(),
    actor        = null,
  } = options;

  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) {
    await auditEntry({ command, cwd, allowed: false, reason: allowedCheck.reason, correlationId, actor, workspaceId: cwd });
    throw Errors.authorization(`Shell command denied: ${allowedCheck.reason}`);
  }

  if (!validateWorkingDir(cwd)) {
    await auditEntry({ command, cwd, allowed: false, reason: "Invalid working directory", correlationId, actor, workspaceId: cwd });
    throw Errors.validation(`Working directory not allowed: ${cwd}`);
  }

  // Policy check properly awaited — streaming cannot bypass policy
  const policyManager = getPolicyManager();
  if (policyManager) {
    const policyResult = await canExecute({
      actor: actor?.type === "api_key" ? `key:${actor.scopes?.join(",") || "read"}` : (actor || "unknown"),
      workspaceId: cwd || "global",
      command,
      metadata: { stream: true },
    });
    if (!policyResult.allowed) {
      await auditEntry({ command, cwd, allowed: false, reason: policyResult.reason || "Policy denied", correlationId, actor, workspaceId: cwd });
      throw Errors.authorization(`Policy denied: ${policyResult.reason || "Shell command blocked by policy"}`);
    }
  }

  const child = spawn(command, [], {
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
    auditEntry({ command, cwd, allowed: true, duration: result.duration, exitCode: code, correlationId, actor, workspaceId: cwd }).catch(() => {});
    if (onExit) onExit(code, result);
  });

  child.on("error", (err) => {
    result.error = err.message;
    auditEntry({ command, cwd, allowed: true, duration: Date.now() - streamStartTime, exitCode: null, error: err.message, correlationId, actor, workspaceId: cwd }).catch(() => {});
  });

  return child;
}

/**
 * Run command in background; output and pid stored in session.
 * Session must exist. Policy and allowlist checked before spawn.
 */
async function executeCommandBackground(command, sessionId, options = {}) {
  const session = getSession(sessionId);
  if (!session) throw Errors.validation(`Session ${sessionId} not found`);
  const { correlationId = generateCorrelationId(), actor = null } = options;

  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) {
    await auditEntry({ command, cwd: session.cwd, allowed: false, reason: allowedCheck.reason, correlationId, actor });
    throw Errors.authorization(`Shell command denied: ${allowedCheck.reason}`);
  }
  if (!validateWorkingDir(session.cwd)) {
    await auditEntry({ command, cwd: session.cwd, allowed: false, reason: "Invalid working directory", correlationId, actor });
    throw Errors.validation("Working directory not allowed");
  }

  const policyManager = getPolicyManager();
  if (policyManager) {
    const policyResult = await canExecute({
      actor: actor?.type === "api_key" ? `key:${actor.scopes?.join(",") || "read"}` : (actor || "unknown"),
      workspaceId: session.cwd || "global",
      command,
      metadata: { background: true },
    });
    if (!policyResult.allowed) {
      await auditEntry({ command, cwd: session.cwd, allowed: false, reason: policyResult.reason || "Policy denied", correlationId, actor });
      throw Errors.authorization(`Policy denied: ${policyResult.reason}`);
    }
  }

  const child = spawn(command, [], {
    cwd: session.cwd,
    env: { ...process.env, ...session.env },
    shell: true,
  });

  session.pid = child.pid;
  session.lastCommand = command;

  child.stdout?.on("data", (data) => appendSessionOutput(session, data.toString(), null));
  child.stderr?.on("data", (data) => appendSessionOutput(session, null, data.toString()));
  child.on("close", (code) => {
    session.pid = null;
    auditEntry({ command, cwd: session.cwd, allowed: true, exitCode: code, correlationId, actor }).catch(() => {});
  });
  child.on("error", (err) => {
    session.pid = null;
    appendSessionOutput(session, null, `Error: ${err.message}`);
  });

  return { pid: child.pid, session_id: sessionId, command, cwd: session.cwd };
}

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name        = "shell";
export const version     = "1.1.0";
export const description = "Execute shell commands with safety controls";
export const capabilities = ["read", "write"];
export const requires    = [];

export const endpoints = [
  { method: "POST", path: "/shell/execute",         description: "Execute a shell command (optional session_id, is_background)", scope: "write" },
  { method: "POST", path: "/shell/execute/stream",  description: "Execute with streaming output (SSE)", scope: "write" },
  { method: "POST", path: "/shell/session",        description: "Create a new shell session", scope: "write" },
  { method: "GET",  path: "/shell/sessions",        description: "List active shell sessions", scope: "read"  },
  { method: "GET",  path: "/shell/sessions/:id/output", description: "Get session output", scope: "read"  },
  { method: "DELETE", path: "/shell/sessions/:id",   description: "Close a shell session", scope: "write" },
  { method: "POST", path: "/shell/check",           description: "Check if a command would be allowed", scope: "read"  },
  { method: "GET",  path: "/shell/audit",           description: "Get shell execution audit log", scope: "read"  },
  { method: "GET",  path: "/shell/safety",          description: "Get safety configuration (allowlist etc.)", scope: "read"  },
];

export const examples = [
  'POST /shell/execute  body: {"command":"git status","explanation":"Check current repo status"}',
  'POST /shell/execute  body: {"command":"ls | grep package","explanation":"Find package files"}',
  'POST /shell/execute  body: {"command":"git log --oneline -10 && git diff HEAD~1","explanation":"See recent commits and diff"}',
  'GET /shell/safety',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "shell_execute",
    description: "Execute a shell command. Use session_id to run in a persistent session (same cwd). Use is_background=true to run long commands without waiting (output via shell_session_output).",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        command:     { type: "string", description: "Command to execute" },
        cwd:         { type: "string", description: "Working directory (ignored if session_id is set)" },
        session_id:  { type: "string", description: "Optional. Run in this session's cwd; output appended to session" },
        is_background: { type: "boolean", default: false, description: "If true, run in background (requires session_id). Returns immediately." },
        timeout:     { type: "number", default: 30000, description: "Timeout in ms (foreground only)" },
        env:         { type: "object", description: "Additional env (session_id: merged with session env)" },
        explanation: { type: "string", description: "Explain what this command does" },
      },
      required: ["command", "explanation"],
    },
    handler: async (args, context) => {
      try {
        let cwd = args.cwd;
        const session = args.session_id ? getSession(args.session_id) : null;
        if (session) cwd = session.cwd;

        if (args.is_background) {
          if (!args.session_id) {
            return { ok: false, error: { code: "session_required", message: "is_background requires session_id" } };
          }
          const result = await executeCommandBackground(args.command, args.session_id, {
            correlationId: generateCorrelationId(),
            actor: context?.actor || null,
          });
          return { ok: true, data: { ...result, message: "Running in background. Use shell_session_output to get output." } };
        }

        const result = await executeCommand(args.command, {
          cwd,
          timeout: args.timeout || DEFAULT_TIMEOUT,
          env: session ? { ...session.env, ...args.env } : args.env,
          correlationId: generateCorrelationId(),
          actor: context?.actor || null,
        });

        if (session) {
          appendSessionOutput(session, result.stdout, result.stderr);
          session.lastCommand = args.command;
        }

        return {
          ok: true,
          data: {
            command:       result.command,
            exitCode:      result.exitCode,
            stdout:        result.stdout,
            stderr:        result.stderr,
            duration:      result.duration,
            correlationId: result.correlationId,
            session_id:    args.session_id || null,
          },
        };
      } catch (err) {
        const standardized = standardizeError(err, "shell_execute");
        return {
          ok: false,
          error: {
            code:           standardized.code,
            message:        standardized.message,
            userSafeMessage: standardized.userSafeMessage,
            retryable:      standardized.retryable,
          },
        };
      }
    },
  },
  {
    name: "shell_session_create",
    description: "Create a new shell session with a given working directory. Use the returned session_id in shell_execute to run commands in the same cwd.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        cwd:  { type: "string", description: "Working directory for this session", default: "." },
        env:  { type: "object", description: "Environment variables for the session" },
      },
    },
    handler: async (args) => {
      const result = createSession(args.cwd, args.env || {});
      if (!result.ok) return result;
      return { ok: true, data: result.data };
    },
  },
  {
    name: "shell_session_list",
    description: "List active shell sessions (id, cwd, pid, lastCommand).",
    tags: [ToolTags.READ_ONLY],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const list = Array.from(sessions.values()).map((s) => ({
        session_id: s.id,
        cwd: s.cwd,
        pid: s.pid,
        lastCommand: s.lastCommand,
        createdAt: s.createdAt,
      }));
      return { ok: true, data: { sessions: list, count: list.length, max_sessions: MAX_SESSIONS } };
    },
  },
  {
    name: "shell_session_output",
    description: "Get the last N lines of output from a session (stdout/stderr from commands run in that session).",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID" },
        lines:      { type: "number", default: 50, description: "Number of lines (default 50)" },
      },
      required: ["session_id"],
    },
    handler: async ({ session_id, lines = 50 }) => {
      const session = getSession(session_id);
      if (!session) return { ok: false, error: { code: "not_found", message: `Session ${session_id} not found` } };
      const n = Math.min(Math.max(1, lines), MAX_SESSION_OUTPUT_LINES);
      const output = session.outputLines.slice(-n);
      return { ok: true, data: { session_id, output, lineCount: output.length, pid: session.pid } };
    },
  },
  {
    name: "shell_session_close",
    description: "Close a shell session. If a command is running in the background, it will be terminated.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string", description: "Session ID to close" } },
      required: ["session_id"],
    },
    handler: async ({ session_id }) => closeSession(session_id),
  },
  {
    name: "shell_safety_check",
    description: "Check if a command would be allowed before running it. Use this to verify a command is safe.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to check" },
        cwd:     { type: "string", description: "Working directory to validate" },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const cmdCheck = isCommandAllowed(args.command);
      const cwdOk    = validateWorkingDir(args.cwd);
      const binaries = parseCommandBinaries(args.command);
      return {
        ok: true,
        data: {
          command:         args.command,
          allowed:         cmdCheck.allowed && cwdOk,
          commandAllowed:  cmdCheck.allowed,
          cwdAllowed:      cwdOk,
          reason:          cmdCheck.reason,
          detectedBinaries: binaries,
          allowlist:       Array.from(ALLOWED_COMMANDS),
          allowedDirs:     ALLOWED_WORKING_DIRS,
          defaultTimeout:  DEFAULT_TIMEOUT,
          maxTimeout:      MAX_TIMEOUT,
        },
      };
    },
  },
  {
    name: "shell_audit",
    description: "Get recent shell execution audit log",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10, description: "Number of entries (max 100)" },
      },
    },
    handler: async (args) => ({
      ok: true,
      data: { audit: await getAuditLogEntries(Math.min(args.limit || 10, 100)) },
    }),
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  /**
   * POST /shell/execute
   * Execute a shell command and return output.
   */
  router.post("/execute", requireScope("write"), async (req, res) => {
    const { command, cwd, timeout = DEFAULT_TIMEOUT, env, explanation } = req.body || {};

    if (!command) {
      return res.status(400).json({ ok: false, error: { code: "missing_command", message: "command is required" } });
    }

    try {
      const result = await executeCommand(command, {
        cwd,
        timeout,
        env,
        correlationId: generateCorrelationId(),
        actor: req.actor || null,
      });

      res.json({
        ok: true,
        data: {
          command:       result.command,
          exitCode:      result.exitCode,
          stdout:        result.stdout,
          stderr:        result.stderr,
          duration:      result.duration,
          timestamp:     result.timestamp,
          correlationId: result.correlationId,
          explanation:   explanation || null,
        },
      });
    } catch (err) {
      const standardized = standardizeError(err, "shell_execute");
      res.status(standardized.statusCode || 500).json(standardized.serialize(req.requestId));
    }
  });

  /**
   * POST /shell/execute/stream
   * Execute with SSE streaming output. Policy is properly awaited before spawn.
   */
  router.post("/execute/stream", requireScope("write"), async (req, res) => {
    const { command, cwd, env } = req.body || {};

    if (!command) {
      return res.status(400).json({ ok: false, error: { code: "missing_command", message: "command is required" } });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const child = await executeCommandStream(command, {
        cwd,
        env,
        correlationId: generateCorrelationId(),
        actor: req.actor || null,
        onStdout: (chunk) => res.write(`data: ${JSON.stringify({ type: "stdout", data: chunk })}\n\n`),
        onStderr: (chunk) => res.write(`data: ${JSON.stringify({ type: "stderr", data: chunk })}\n\n`),
        onExit:   (code)  => { res.write(`data: ${JSON.stringify({ type: "exit", code })}\n\n`); res.end(); },
      });

      req.on("close", () => child.kill());
    } catch (err) {
      const standardized = standardizeError(err, "shell_execute_stream");
      res.write(`data: ${JSON.stringify({ type: "error", error: standardized.serialize(req.requestId) })}\n\n`);
      res.end();
    }
  });

  /**
   * POST /shell/check
   * Dry-run: check whether a command would be allowed.
   */
  router.post("/check", (req, res) => {
    const { command, cwd } = req.body || {};
    if (!command) return res.status(400).json({ ok: false, error: { code: "missing_command", message: "command is required" } });

    const cmdCheck = isCommandAllowed(command);
    const cwdOk    = validateWorkingDir(cwd);
    res.json({
      ok: true,
      command,
      allowed:         cmdCheck.allowed && cwdOk,
      commandAllowed:  cmdCheck.allowed,
      cwdAllowed:      cwdOk,
      reason:          cmdCheck.reason,
      detectedBinaries: parseCommandBinaries(command),
    });
  });

  /**
   * GET /shell/audit
   */
  router.get("/audit", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: await getAuditLogEntries(limit) } });
  });

  /**
   * GET /shell/safety
   */
  router.get("/safety", (_req, res) => {
    res.json({
      ok: true,
      data: {
        allowlist:        Array.from(ALLOWED_COMMANDS),
        dangerousPatterns: DANGEROUS_PATTERNS.map(p => p.source),
        allowedDirectories: ALLOWED_WORKING_DIRS,
        defaultTimeout:   DEFAULT_TIMEOUT,
        maxTimeout:       MAX_TIMEOUT,
        maxSessions:      MAX_SESSIONS,
        notes: "Pipes (|) and compound operators (&&, ||, ;) are allowed when all referenced binaries are in the allowlist.",
      },
    });
  });

  /** POST /shell/session — create session */
  router.post("/session", requireScope("write"), (req, res) => {
    const { cwd, env } = req.body || {};
    const result = createSession(cwd, env);
    res.status(result.ok ? 201 : 400).json(result);
  });

  /** GET /shell/sessions — list sessions */
  router.get("/sessions", requireScope("read"), (_req, res) => {
    const list = Array.from(sessions.values()).map((s) => ({
      session_id: s.id,
      cwd: s.cwd,
      pid: s.pid,
      lastCommand: s.lastCommand,
      createdAt: s.createdAt,
    }));
    res.json({ ok: true, data: { sessions: list, count: list.length, max_sessions: MAX_SESSIONS } });
  });

  /** GET /shell/sessions/:id/output */
  router.get("/sessions/:id/output", requireScope("read"), (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Session not found" } });
    const lines = Math.min(Math.max(1, parseInt(req.query.lines, 10) || 50), MAX_SESSION_OUTPUT_LINES);
    const output = session.outputLines.slice(-lines);
    res.json({ ok: true, data: { session_id: session.id, output, lineCount: output.length, pid: session.pid } });
  });

  /** DELETE /shell/sessions/:id — close session */
  router.delete("/sessions/:id", requireScope("write"), (req, res) => {
    const result = closeSession(req.params.id);
    res.status(result.ok ? 200 : 404).json(result);
  });

  app.use("/shell", router);
}
