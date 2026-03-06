import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "./config.js";
import { registerTool } from "./tool-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, "../plugins");

const loaded = [];

/**
 * Discover and load plugins from src/plugins/<name>/index.js.
 *
 * Each plugin must export:
 *   name      string   — plugin identifier
 *   version   string   — semver
 *   register  function — register(app) mounts routes
 *
 * Optional manifest fields (used by GET /plugins and GET /plugins/:name/manifest):
 *   description  string
 *   capabilities string[]  e.g. ["read", "write"]
 *   endpoints    { path, method, description, scope? }[]
 *   requires     string[]  env var names that must be set
 *   examples     string[]  curl examples
 *   tools        { name, description, inputSchema?, handler }[]  — MCP tools
 */
export async function loadPlugins(app) {
  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Statistics for startup validation report
  let stats = {
    pluginsLoaded: 0,
    pluginsFailed: 0,
    toolsRegistered: 0,
    toolsFailed: 0,
  };

  for (const dir of dirs) {
    // Check if this plugin should be disabled
    if (dir === "n8n" && !config.plugins.enableN8n) {
      console.log(`[plugins] "${dir}" disabled by ENABLE_N8N_PLUGIN=false`);
      continue;
    }
    if (dir === "n8n-credentials" && !config.plugins.enableN8nCredentials) {
      console.log(`[plugins] "${dir}" disabled by ENABLE_N8N_CREDENTIALS=false`);
      continue;
    }
    if (dir === "n8n-workflows" && !config.plugins.enableN8nWorkflows) {
      console.log(`[plugins] "${dir}" disabled by ENABLE_N8N_WORKFLOWS=false`);
      continue;
    }

    const url = pathToFileURL(join(PLUGINS_DIR, dir, "index.js")).href;
    let plugin;
    try {
      plugin = await import(url);
    } catch (err) {
      console.warn(`[plugins] failed to load "${dir}": ${err.message}`);
      continue;
    }

    if (typeof plugin.register !== "function") {
      console.warn(`[plugins] "${dir}" has no register(app) export — skipped`);
      continue;
    }

    plugin.register(app);

    // Register MCP tools from plugin
    let pluginToolsRegistered = 0;
    let pluginToolsFailed = 0;
    if (Array.isArray(plugin.tools)) {
      for (const tool of plugin.tools) {
        try {
          registerTool({
            ...tool,
            plugin: plugin.name || dir,
          });
          stats.toolsRegistered++;
          pluginToolsRegistered++;
        } catch (err) {
          console.warn(`[plugins] failed to register tool "${tool.name}" from "${dir}": ${err.message}`);
          stats.toolsFailed++;
          pluginToolsFailed++;
        }
      }
    }

    const manifest = {
      name:         plugin.name        ?? dir,
      version:      plugin.version     ?? "0.0.0",
      description:  plugin.description ?? "",
      capabilities: plugin.capabilities ?? [],
      endpoints:    plugin.endpoints    ?? [],
      tools:        plugin.tools?.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || { type: "object" },
      })) ?? [],
      requires:     plugin.requires     ?? [],
      examples:     plugin.examples     ?? [],
    };

    loaded.push(manifest);
    stats.pluginsLoaded++;
    console.log(`[plugins] loaded ${manifest.name}@${manifest.version} (${pluginToolsRegistered} tools${pluginToolsFailed > 0 ? `, ${pluginToolsFailed} failed` : ""})`);
  }

  // Print startup validation summary
  console.log("\n[plugins] ═══════════════════════════════════════");
  console.log(`[plugins] Startup Validation Summary:`);
  console.log(`[plugins]   Plugins loaded: ${stats.pluginsLoaded}`);
  console.log(`[plugins]   Plugins failed: ${stats.pluginsFailed}`);
  console.log(`[plugins]   Tools registered: ${stats.toolsRegistered}`);
  console.log(`[plugins]   Tools failed: ${stats.toolsFailed}`);
  if (stats.toolsFailed === 0) {
    console.log(`[plugins]   ✅ All tools passed validation`);
  } else {
    console.log(`[plugins]   ⚠️  Some tools failed validation - check warnings above`);
  }
  console.log("[plugins] ═══════════════════════════════════════\n");
}

/** Returns full manifest of all successfully loaded plugins. */
export function getPlugins() {
  return loaded;
}
