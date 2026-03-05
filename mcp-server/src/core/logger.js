/**
 * Structured Logging Module
 *
 * JSON formatted logs for production monitoring.
 * Supports log levels, context, and rotation.
 */

import { writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, renameSync } from "fs";
import { join, dirname } from "path";

// Log levels
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

// Current log level from env
const CURRENT_LEVEL =
  LogLevel[process.env.LOG_LEVEL?.toUpperCase()] ?? LogLevel.INFO;

// Log destinations
const LOG_TO_CONSOLE = process.env.LOG_TO_CONSOLE !== "false";
const LOG_TO_FILE = process.env.LOG_TO_FILE === "true";
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || "./logs/mcp-server.log";
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE_MB || "100") * 1024 * 1024; // MB to bytes
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || "5");

// Ensure log directory exists
if (LOG_TO_FILE) {
  try {
    const dir = dirname(LOG_FILE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.error("[Logger] Failed to create log directory:", err.message);
  }
}

// Log buffer for batch writes
let logBuffer = [];
let flushTimeout = null;
const FLUSH_INTERVAL = 1000; // ms

/**
 * Write log entry to file with rotation
 */
function writeToFile(entry) {
  try {
    const line = JSON.stringify(entry) + "\n";

    // Check rotation
    if (existsSync(LOG_FILE_PATH)) {
      const stats = statSync(LOG_FILE_PATH);
      if (stats.size >= LOG_MAX_SIZE) {
        rotateLogFile();
      }
    }

    appendFileSync(LOG_FILE_PATH, line);
  } catch (err) {
    console.error("[Logger] Failed to write to log file:", err.message);
  }
}

/**
 * Rotate log files
 */
function rotateLogFile() {
  try {
    // Remove oldest log if exists
    const oldestLog = `${LOG_FILE_PATH}.${LOG_MAX_FILES}`;
    if (existsSync(oldestLog)) {
      require("fs").unlinkSync(oldestLog);
    }

    // Shift existing logs
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const oldPath = `${LOG_FILE_PATH}.${i}`;
      const newPath = `${LOG_FILE_PATH}.${i + 1}`;
      if (existsSync(oldPath)) {
        renameSync(oldPath, newPath);
      }
    }

    // Rotate current log
    if (existsSync(LOG_FILE_PATH)) {
      renameSync(LOG_FILE_PATH, `${LOG_FILE_PATH}.1`);
    }
  } catch (err) {
    console.error("[Logger] Failed to rotate log file:", err.message);
  }
}

/**
 * Flush log buffer
 */
function flushBuffer() {
  if (logBuffer.length === 0) return;

  const entries = logBuffer.splice(0);
  for (const entry of entries) {
    writeToFile(entry);
  }
}

/**
 * Schedule buffer flush
 */
function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(() => {
    flushBuffer();
    flushTimeout = null;
  }, FLUSH_INTERVAL);
}

/**
 * Create log entry
 */
function createLogEntry(level, message, context = {}) {
  return {
    timestamp: new Date().toISOString(),
    level: Object.keys(LogLevel).find((k) => LogLevel[k] === level),
    message,
    context: {
      ...context,
      pid: process.pid,
      node_version: process.version,
    },
  };
}

/**
 * Log a message
 */
function log(level, message, context = {}) {
  if (level < CURRENT_LEVEL) return;

  const entry = createLogEntry(level, message, context);

  // Console output
  if (LOG_TO_CONSOLE) {
    const color =
      level >= LogLevel.ERROR
        ? "\x1b[31m" // Red
        : level === LogLevel.WARN
        ? "\x1b[33m" // Yellow
        : level === LogLevel.DEBUG
        ? "\x1b[36m" // Cyan
        : "\x1b[0m"; // Reset

    const levelStr = entry.level.padEnd(5);
    const ctxStr = Object.keys(context).length > 0 ? JSON.stringify(context) : "";

    if (level >= LogLevel.ERROR) {
      console.error(`${color}[${levelStr}] ${message}\x1b[0m`, ctxStr);
    } else if (level === LogLevel.WARN) {
      console.warn(`${color}[${levelStr}] ${message}\x1b[0m`, ctxStr);
    } else {
      console.log(`${color}[${levelStr}] ${message}\x1b[0m`, ctxStr);
    }
  }

  // File output
  if (LOG_TO_FILE) {
    logBuffer.push(entry);
    scheduleFlush();
  }

  return entry;
}

// Convenience methods
export const logger = {
  debug: (message, context) => log(LogLevel.DEBUG, message, context),
  info: (message, context) => log(LogLevel.INFO, message, context),
  warn: (message, context) => log(LogLevel.WARN, message, context),
  error: (message, context) => log(LogLevel.ERROR, message, context),
  fatal: (message, context) => log(LogLevel.FATAL, message, context),

  // Structured logging with operation tracking
  start: (operation, context = {}) => {
    const startTime = Date.now();
    const spanId = `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    log(LogLevel.INFO, `${operation} started`, {
      ...context,
      operation,
      spanId,
      type: "span_start",
    });

    return {
      spanId,
      end: (result = {}, error = null) => {
        const duration = Date.now() - startTime;
        if (error) {
          log(LogLevel.ERROR, `${operation} failed`, {
            ...context,
            operation,
            spanId,
            duration,
            error: error.message || error,
            type: "span_end",
          });
        } else {
          log(LogLevel.INFO, `${operation} completed`, {
            ...context,
            operation,
            spanId,
            duration,
            result,
            type: "span_end",
          });
        }
        return duration;
      },
    };
  },
};

// Process cleanup
process.on("beforeExit", () => {
  flushBuffer();
});

process.on("SIGINT", () => {
  flushBuffer();
  process.exit(0);
});

process.on("SIGTERM", () => {
  flushBuffer();
  process.exit(0);
});

export default logger;
