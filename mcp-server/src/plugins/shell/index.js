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

const execAsync = promisify(exec);

// Command history
const commandHistory = []; // Last 100 commands
const MAX_HISTORY = 100;

// Blocked commands for safety
const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "> /dev/sda",
  "dd if=/dev/zero",
  "mkfs",
  "fdisk",
  "format",
  "del /f /s /q",
  "rd /s /q",
];

// Allowed working directories
const ALLOWED_WORKING_DIRS = process.env.ALLOWED_WORKING_DIRS?.split(",") || [
  process.cwd(),
  process.env.WORKSPACE_PATH,
].filter(Boolean);

/**
 * Check if command is blocked
 */
function isBlocked(command) {
  const lowerCmd = command.toLowerCase();
  return BLOCKED_COMMANDS.some((blocked) => lowerCmd.includes(blocked));
}

/**
 * Validate working directory
 */
function validateWorkingDir(cwd) {
  if (!cwd) return true;
  const resolved = require("path").resolve(cwd);
  return ALLOWED_WORKING_DIRS.some((allowed) =>
    resolved.startsWith(require("path").resolve(allowed))
  );
}

/**
 * Execute a shell command
 */
async function executeCommand(command, options = {}) {
  const {
    cwd = process.cwd(),
    timeout = 30000,
    env = {},
    captureOutput = true,
  } = options;

  // Safety checks
  if (isBlocked(command)) {
    throw new Error("Command blocked for security reasons");
  }

  if (!validateWorkingDir(cwd)) {
    throw new Error(`Working directory not allowed: ${cwd}`);
  }

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const result = {
      command,
      cwd,
      exitCode: 0,
      stdout: captureOutput ? stdout : null,
      stderr: captureOutput ? stderr : null,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    addToHistory(result);
    return result;
  } catch (err) {
    const result = {
      command,
      cwd,
      exitCode: err.code || 1,
      stdout: captureOutput ? err.stdout : null,
      stderr: captureOutput ? err.stderr : null,
      error: err.message,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    addToHistory(result);
    throw err;
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
  } = options;

  // Safety checks
  if (isBlocked(command)) {
    throw new Error("Command blocked for security reasons");
  }

  if (!validateWorkingDir(cwd)) {
    throw new Error(`Working directory not allowed: ${cwd}`);
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
  };

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
    result.duration = Date.now() - new Date(result.timestamp).getTime();
    addToHistory(result);
    if (onExit) onExit(code, result);
  });

  child.on("error", (err) => {
    result.error = err.message;
    addToHistory(result);
  });

  return child;
}

/**
 * Add command to history
 */
function addToHistory(result) {
  commandHistory.unshift(result);
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory.pop();
  }
}

/**
 * Get command history
 */
function getHistory(limit = 50) {
  return commandHistory.slice(0, Math.min(limit, MAX_HISTORY));
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
  { method: "GET", path: "/shell/history", description: "Get command history", scope: "read" },
  { method: "GET", path: "/shell/safety", description: "Get safety configuration", scope: "read" },
];
export const examples = [
  'POST /shell/execute  body: {"command":"ls -la","cwd":"./workspace"}',
  'POST /shell/execute  body: {"command":"npm install","timeout":60000}',
  'GET /shell/history?limit=10',
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
    handler: async (args) => {
      try {
        const result = await executeCommand(args.command, {
          cwd: args.cwd,
          timeout: args.timeout || 30000,
          env: args.env,
        });
        return {
          ok: true,
          data: {
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration: result.duration,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "command_failed",
            message: err.message,
            exitCode: err.code || 1,
            stdout: err.stdout,
            stderr: err.stderr,
          },
        };
      }
    },
  },
  {
    name: "shell_history",
    description: "Get recent command execution history",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10, description: "Number of entries" },
      },
    },
    handler: async (args) => {
      return {
        ok: true,
        data: { history: getHistory(args.limit || 10) },
      };
    },
  },
  {
    name: "shell_safety_check",
    description: "Check if a command would be allowed",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to check" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const blocked = isBlocked(args.command);
      const cwdAllowed = validateWorkingDir(args.cwd);
      return {
        ok: true,
        data: {
          command: args.command,
          allowed: !blocked && cwdAllowed,
          blocked,
          cwdAllowed,
          blockedPatterns: BLOCKED_COMMANDS,
          allowedDirs: ALLOWED_WORKING_DIRS,
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
      const result = await executeCommand(command, { cwd, timeout, env });
      res.json({
        ok: true,
        data: {
          command: result.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration: result.duration,
          timestamp: result.timestamp,
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: {
          code: "command_failed",
          message: err.message,
          exitCode: err.code || 1,
          stdout: err.stdout,
          stderr: err.stderr,
        },
      });
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
      const child = executeCommandStream(command, {
        cwd,
        env,
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
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      res.end();
    }
  });

  // Get history
  router.get("/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { history: getHistory(limit) } });
  });

  // Get safety config
  router.get("/safety", (_req, res) => {
    res.json({
      ok: true,
      data: {
        blockedCommands: BLOCKED_COMMANDS,
        allowedDirectories: ALLOWED_WORKING_DIRS,
      },
    });
  });

  app.use("/shell", router);
}
