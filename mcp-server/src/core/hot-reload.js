/**
 * Hot Reload Module
 *
 * Automatically restarts the server when files change.
 * Watches plugin directories and core files for changes.
 */

import { watch } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { readdir, stat } from "fs/promises";

// Hot reload state
const state = {
  enabled: false,
  childProcess: null,
  watchers: new Map(),
  restartDelay: 500, // ms
  restartTimer: null,
  watchedPaths: new Set(),
  ignorePatterns: [
    /node_modules/,
    /\.git/,
    /\.log$/,
    /\.tmp$/,
    /\.swp$/,
    /~$/,
    /test\/coverage/,
  ],
};

/**
 * Check if path should be ignored
 */
function shouldIgnore(path) {
  return state.ignorePatterns.some((pattern) => pattern.test(path));
}

/**
 * Log with prefix
 */
function log(message, type = "info") {
  const colors = {
    info: "\x1b[36m", // cyan
    success: "\x1b[32m", // green
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    reset: "\x1b[0m",
  };

  const prefix = type === "info" ? "[Hot Reload]" : `[Hot Reload:${type}]`;
  console.log(`${colors[type] || colors.info}${prefix}${colors.reset} ${message}`);
}

/**
 * Debounced restart
 */
function scheduleRestart(reason) {
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
  }

  log(`Restart scheduled: ${reason}`, "warn");

  state.restartTimer = setTimeout(() => {
    restartServer();
  }, state.restartDelay);
}

/**
 * Start the server process
 */
function startServer() {
  if (state.childProcess) {
    return;
  }

  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "npm.cmd" : "npm";

  log("Starting server...", "info");

  state.childProcess = spawn(cmd, ["start"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, HOT_RELOAD: "true" },
  });

  state.childProcess.on("error", (err) => {
    log(`Failed to start: ${err.message}`, "error");
  });

  state.childProcess.on("exit", (code) => {
    if (!state.enabled) return; // Don't restart if disabled

    if (code !== 0 && code !== null) {
      log(`Server crashed (code ${code}). Restarting in 3s...`, "error");
      setTimeout(startServer, 3000);
    } else {
      state.childProcess = null;
    }
  });
}

/**
 * Stop the server process
 */
function stopServer() {
  return new Promise((resolve) => {
    if (!state.childProcess) {
      resolve();
      return;
    }

    log("Stopping server...", "warn");

    const timeout = setTimeout(() => {
      state.childProcess.kill("SIGKILL");
      resolve();
    }, 5000);

    state.childProcess.on("exit", () => {
      clearTimeout(timeout);
      state.childProcess = null;
      resolve();
    });

    state.childProcess.kill(isWindows ? "SIGTERM" : "SIGTERM");
  });
}

/**
 * Restart the server
 */
async function restartServer() {
  log("Restarting server...", "info");
  await stopServer();
  startServer();
}

/**
 * Watch a file or directory
 */
function watchPath(path, label) {
  if (state.watchedPaths.has(path) || shouldIgnore(path)) {
    return;
  }

  state.watchedPaths.add(path);

  try {
    const watcher = watch(path, { recursive: true }, (eventType, filename) => {
      const fullPath = join(path, filename || "");

      if (shouldIgnore(fullPath)) {
        return;
      }

      const event = eventType === "change" ? "modified" : "renamed";
      scheduleRestart(`${label}: ${filename} ${event}`);
    });

    state.watchers.set(path, watcher);
    log(`Watching ${label}: ${path}`, "info");
  } catch (error) {
    log(`Cannot watch ${path}: ${error.message}`, "error");
  }
}

/**
 * Setup watchers for all relevant paths
 */
async function setupWatchers() {
  const rootDir = process.cwd();

  // Watch core source files
  watchPath(join(rootDir, "src/core"), "core");

  // Watch plugins directory
  const pluginsDir = join(rootDir, "src/plugins");
  try {
    const plugins = await readdir(pluginsDir);
    for (const plugin of plugins) {
      const pluginPath = join(pluginsDir, plugin);
      const stats = await stat(pluginPath);
      if (stats.isDirectory()) {
        watchPath(pluginPath, `plugin:${plugin}`);
      }
    }
  } catch {
    log("No plugins directory found", "warn");
  }

  // Watch main entry point
  const indexPath = join(rootDir, "src/index.js");
  try {
    await stat(indexPath);
    watchPath(indexPath, "entry");
  } catch {
    // ignore
  }
}

/**
 * Enable hot reload
 */
export async function enable(options = {}) {
  if (state.enabled) {
    log("Already enabled", "warn");
    return;
  }

  state.enabled = true;

  if (options.restartDelay) {
    state.restartDelay = options.restartDelay;
  }

  if (options.ignore) {
    state.ignorePatterns.push(...options.ignore);
  }

  log("Hot reload enabled", "success");

  await setupWatchers();
  startServer();
}

/**
 * Disable hot reload
 */
export async function disable() {
  if (!state.enabled) {
    return;
  }

  state.enabled = false;

  // Close all watchers
  for (const [path, watcher] of state.watchers) {
    watcher.close();
    log(`Stopped watching: ${path}`, "info");
  }
  state.watchers.clear();
  state.watchedPaths.clear();

  await stopServer();

  log("Hot reload disabled", "info");
}

/**
 * Check if hot reload is enabled
 */
export function isEnabled() {
  return state.enabled;
}

/**
 * Get status information
 */
export function getStatus() {
  return {
    enabled: state.enabled,
    watchedPaths: Array.from(state.watchedPaths),
    watchersCount: state.watchers.size,
    childRunning: state.childProcess !== null,
  };
}

/**
 * Force a restart
 */
export async function forceRestart() {
  if (!state.enabled) {
    log("Hot reload not enabled", "warn");
    return;
  }

  log("Forcing restart...", "warn");
  await restartServer();
}

/**
 * Add a path to watch
 */
export function watchAdditional(path, label = "custom") {
  if (!state.enabled) {
    log("Hot reload not enabled, cannot watch", "error");
    return;
  }

  watchPath(path, label);
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "start":
      enable().catch((err) => {
        log(err.message, "error");
        process.exit(1);
      });

      // Handle graceful shutdown
      process.on("SIGINT", async () => {
        log("Received SIGINT, shutting down...", "warn");
        await disable();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        await disable();
        process.exit(0);
      });
      break;

    case "status":
      console.log(JSON.stringify(getStatus(), null, 2));
      break;

    case "restart":
      forceRestart().then(() => process.exit(0));
      break;

    default:
      console.log(`
Hot Reload Manager for MCP Hub

Usage:
  node hot-reload.js start     Start with hot reload
  node hot-reload.js status    Show status
  node hot-reload.js restart   Force restart

Options (via environment):
  HOT_RELOAD_DELAY=500         Restart delay in ms
  HOT_RELOAD_IGNORE=pattern    Additional ignore patterns
      `);
      break;
  }
}

export default {
  enable,
  disable,
  isEnabled,
  getStatus,
  forceRestart,
  watchAdditional,
};
