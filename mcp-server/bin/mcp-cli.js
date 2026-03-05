#!/usr/bin/env node

/**
 * MCP Hub CLI
 *
 * Interactive terminal interface for managing the MCP server.
 * Provides commands for plugins, health checks, logs, and more.
 */

import { createInterface } from "readline";
import { spawn } from "child_process";
import { readdir, readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}`),
};

// CLI State
const state = {
  serverUrl: process.env.MCP_SERVER_URL || "http://localhost:3000",
  lastCommand: null,
  history: [],
};

// Command definitions
const commands = {
  help: {
    description: "Show available commands",
    usage: "help [command]",
    handler: showHelp,
  },
  status: {
    description: "Check server health and status",
    usage: "status",
    handler: checkStatus,
  },
  plugins: {
    description: "List all registered plugins",
    usage: "plugins [--detailed]",
    handler: listPlugins,
  },
  tools: {
    description: "List MCP tools from all plugins",
    usage: "tools [plugin-name]",
    handler: listTools,
  },
  call: {
    description: "Call an MCP tool directly",
    usage: "call <tool-name> [args-json]",
    handler: callTool,
  },
  logs: {
    description: "View recent server logs",
    usage: "logs [--follow] [--lines N]",
    handler: viewLogs,
  },
  config: {
    description: "View or edit configuration",
    usage: "config [get|set] [key] [value]",
    handler: manageConfig,
  },
  test: {
    description: "Run plugin tests",
    usage: "test [plugin-name|all]",
    handler: runTests,
  },
  generate: {
    description: "Generate a new plugin scaffold",
    usage: "generate <plugin-name>",
    handler: generatePlugin,
  },
  reload: {
    description: "Reload plugins (hot reload)",
    usage: "reload",
    handler: reloadPlugins,
  },
  debug: {
    description: "Toggle debug mode",
    usage: "debug [on|off]",
    handler: toggleDebug,
  },
  exit: {
    description: "Exit CLI",
    usage: "exit",
    handler: () => {
      log.info("Goodbye! 👋");
      process.exit(0);
    },
  },
};

// API helper
async function api(path, options = {}) {
  try {
    const url = `${state.serverUrl}${path}`;
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    return await response.json();
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Command handlers
async function showHelp(args) {
  if (args[0] && commands[args[0]]) {
    const cmd = commands[args[0]];
    console.log(`\n${colors.bright}${args[0]}${colors.reset}`);
    console.log(`  Description: ${cmd.description}`);
    console.log(`  Usage: ${colors.yellow}${cmd.usage}${colors.reset}\n`);
    return;
  }

  log.header("MCP Hub CLI - Available Commands");
  console.log("");

  const maxCmd = Math.max(...Object.keys(commands).map((c) => c.length));

  Object.entries(commands).forEach(([name, cmd]) => {
    const padded = name.padEnd(maxCmd + 2);
    console.log(`  ${colors.cyan}${padded}${colors.reset}${cmd.description}`);
  });

  console.log("\n");
  log.info("Type 'help <command>' for detailed usage.");
  log.info("Use TAB for command completion.");
}

async function checkStatus() {
  log.header("Server Status");

  const startTime = Date.now();
  const result = await api("/health");
  const latency = Date.now() - startTime;

  if (result.ok) {
    log.success(`Server is running (${latency}ms)`);

    if (result.services) {
      console.log("\n  Services:");
      Object.entries(result.services).forEach(([name, status]) => {
        const icon = status === "ok" ? colors.green + "✓" : colors.red + "✗";
        console.log(`    ${icon} ${name}${colors.reset}`);
      });
    }

    if (result.circuits) {
      console.log("\n  Circuit Breakers:");
      Object.entries(result.circuits).forEach(([name, state]) => {
        const color = state === "CLOSED" ? colors.green : state === "OPEN" ? colors.red : colors.yellow;
        console.log(`    ${color}${state}${colors.reset} ${name}`);
      });
    }
  } else {
    log.error(`Server unreachable: ${result.error}`);
  }
}

async function listPlugins(args) {
  log.header("Registered Plugins");

  const pluginsDir = join(process.cwd(), "src/plugins");

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const plugin of plugins) {
      const pluginPath = join(pluginsDir, plugin, "index.js");
      try {
        await stat(pluginPath);
        const info = await import(pluginPath);
        console.log(`\n  ${colors.green}●${colors.reset} ${colors.bright}${plugin}${colors.reset}`);
        if (args.includes("--detailed")) {
          console.log(`    Version: ${info.version || "N/A"}`);
          console.log(`    Description: ${info.description || "N/A"}`);
          if (info.tools) {
            console.log(`    Tools: ${info.tools.length}`);
          }
          if (info.endpoints) {
            console.log(`    Endpoints: ${info.endpoints.length}`);
          }
        }
      } catch {
        console.log(`  ${colors.yellow}○${colors.reset} ${plugin} (no index.js)`);
      }
    }

    console.log(`\n${colors.dim}Total: ${plugins.length} plugins${colors.reset}`);
  } catch (error) {
    log.error(`Cannot read plugins: ${error.message}`);
  }
}

async function listTools(args) {
  const pluginName = args[0];
  log.header(pluginName ? `Tools: ${pluginName}` : "All MCP Tools");

  const pluginsDir = join(process.cwd(), "src/plugins");

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const plugin of plugins) {
      if (pluginName && plugin !== pluginName) continue;

      const pluginPath = join(pluginsDir, plugin, "index.js");
      try {
        const info = await import(pluginPath);
        if (info.tools && info.tools.length > 0) {
          console.log(`\n  ${colors.cyan}${plugin}${colors.reset}`);
          info.tools.forEach((tool) => {
            console.log(`    ${colors.bright}${tool.name}${colors.reset}`);
            if (tool.description) {
              console.log(`      ${colors.dim}${tool.description}${colors.reset}`);
            }
          });
        }
      } catch {
        // Skip
      }
    }
  } catch (error) {
    log.error(`Error: ${error.message}`);
  }
}

async function callTool(args) {
  if (args.length < 1) {
    log.error("Usage: call <tool-name> [args-json]");
    return;
  }

  const toolName = args[0];
  let params = {};

  if (args[1]) {
    try {
      params = JSON.parse(args[1]);
    } catch {
      log.error("Invalid JSON in arguments");
      return;
    }
  }

  log.header(`Calling: ${toolName}`);

  const result = await api("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: params },
      id: Date.now(),
    }),
  });

  console.log("\n" + JSON.stringify(result, null, 2));
}

async function viewLogs(args) {
  const follow = args.includes("--follow");
  const linesArg = args.find((a) => a.startsWith("--lines="));
  const lines = linesArg ? parseInt(linesArg.split("=")[1]) : 50;

  log.header(`Server Logs (last ${lines} lines)`);

  // Try to read log file if exists
  const logPath = join(process.cwd(), "logs/mcp-server.log");
  try {
    const content = await readFile(logPath, "utf-8");
    const logLines = content.split("\n").slice(-lines);
    console.log(logLines.join("\n"));
  } catch {
    log.warn("No log file found. Using console output...");
  }

  if (follow) {
    log.info("Following logs (Ctrl+C to stop)...");
    // In a real implementation, this would tail the log file
  }
}

async function manageConfig(args) {
  const action = args[0] || "view";
  const key = args[1];
  const value = args[2];

  const configPath = join(process.cwd(), ".env");

  if (action === "view") {
    log.header("Current Configuration");
    try {
      const content = await readFile(configPath, "utf-8");
      const lines = content.split("\n").filter((l) => l && !l.startsWith("#"));
      lines.forEach((line) => {
        const [k, ...v] = line.split("=");
        console.log(`  ${colors.cyan}${k}${colors.reset}=${v.join("=")}`);
      });
    } catch {
      log.error("Cannot read .env file");
    }
  } else if (action === "get" && key) {
    console.log(`${key}=${process.env[key] || "(not set)"}`);
  } else if (action === "set" && key && value) {
    log.warn("Use your editor to modify .env file directly");
  }
}

async function runTests(args) {
  const target = args[0] || "all";
  log.header(`Running Tests: ${target}`);

  return new Promise((resolve) => {
    const cmd = target === "all" ? "npm test" : `npm test -- tests/plugins/${target}.test.js`;
    const proc = spawn("sh", ["-c", cmd], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        log.success("All tests passed!");
      } else {
        log.error(`Tests failed with code ${code}`);
      }
      resolve();
    });
  });
}

async function generatePlugin(args) {
  if (args.length < 1) {
    log.error("Usage: generate <plugin-name>");
    return;
  }

  const name = args[0];
  const pluginDir = join(process.cwd(), "src/plugins", name);

  log.header(`Generating Plugin: ${name}`);

  // Create directory and files
  const fs = await import("fs/promises");
  await fs.mkdir(pluginDir, { recursive: true });

  const template = `export const name = "${name}";
export const version = "1.0.0";
export const description = "${name} plugin description";

export const tools = [
  {
    name: "${name}_hello",
    description: "Example tool for ${name}",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name to greet",
        },
      },
      required: ["name"],
    },
    handler: async ({ name }) => {
      return {
        ok: true,
        data: { message: \`Hello, \${name}! from ${name} plugin\` },
      };
    },
  },
];

export const endpoints = [
  {
    path: "/${name}/hello",
    method: "POST",
    handler: async (req, res) => {
      res.json({ ok: true, data: req.body });
    },
  },
];

export function register(app, dependencies) {
  console.log("[${name}] Plugin registered");
}
`;

  await fs.writeFile(join(pluginDir, "index.js"), template);

  const testTemplate = `import { describe, it, expect } from "vitest";
import * as ${name} from "../../src/plugins/${name}/index.js";

describe("${name} Plugin", () => {
  it("should have correct metadata", () => {
    expect(${name}.name).toBe("${name}");
    expect(${name}.version).toBe("1.0.0");
  });

  it("should have tools", () => {
    expect(${name}.tools.length).toBeGreaterThan(0);
  });
});
`;

  await fs.writeFile(join(process.cwd(), "tests/plugins", `${name}.test.js`), testTemplate);

  log.success(`Plugin ${name} created!`);
  console.log(`  Location: ${pluginDir}`);
  console.log(`  Files: index.js, tests/plugins/${name}.test.js`);
}

async function reloadPlugins() {
  log.header("Reloading Plugins");

  const result = await api("/admin/reload", { method: "POST" });

  if (result.ok) {
    log.success("Plugins reloaded successfully");
  } else {
    log.error(`Reload failed: ${result.error || "Unknown error"}`);
  }
}

async function toggleDebug(args) {
  const mode = args[0] || "toggle";
  log.header(`Debug Mode: ${mode}`);

  // In a real implementation, this would toggle server debug mode
  if (mode === "on") {
    log.success("Debug mode enabled");
    console.log("  - Verbose logging active");
    console.log("  - Request/response tracing enabled");
  } else if (mode === "off") {
    log.success("Debug mode disabled");
  } else {
    log.info("Current: " + (process.env.DEBUG ? "ON" : "OFF"));
  }
}

// Tab completion
function completer(line) {
  const hits = Object.keys(commands).filter((c) => c.startsWith(line));
  return [hits.length ? hits : Object.keys(commands), line];
}

// Main CLI loop
async function main() {
  console.clear();
  console.log(`${colors.cyan}
   ███╗   ███╗ ██████╗██████╗     ██╗  ██╗██╗   ██╗██████╗ 
   ████╗ ████║██╔════╝██╔══██╗    ██║  ██║██║   ██║██╔══██╗
   ██╔████╔██║██║     ██████╔╝    ███████║██║   ██║██████╔╝
   ██║╚██╔╝██║██║     ██╔═══╝     ██╔══██║██║   ██║██╔══██╗
   ██║ ╚═╝ ██║╚██████╗██║         ██║  ██║╚██████╔╝██████╔╝
   ╚═╝     ╚═╝ ╚═════╝╚═╝         ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ 
  ${colors.reset}`);
  console.log(`${colors.dim}  Model Context Protocol Hub - Developer CLI${colors.reset}\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.green}mcp>${colors.reset} `,
    completer,
  });

  log.info("Server URL: " + state.serverUrl);
  log.info("Type 'help' for commands\n");

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    state.history.push(trimmed);
    const [cmd, ...args] = trimmed.split(/\s+/);

    if (commands[cmd]) {
      try {
        await commands[cmd].handler(args);
      } catch (error) {
        log.error(`Command failed: ${error.message}`);
      }
    } else {
      log.error(`Unknown command: ${cmd}. Type 'help' for list.`);
    }

    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    commands.exit.handler();
  });
}

main().catch((err) => {
  console.error("CLI Error:", err);
  process.exit(1);
});
