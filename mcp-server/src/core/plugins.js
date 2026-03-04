import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "./config.js";

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
 */
export async function loadPlugins(app) {
  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

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

    const manifest = {
      name:         plugin.name        ?? dir,
      version:      plugin.version     ?? "0.0.0",
      description:  plugin.description ?? "",
      capabilities: plugin.capabilities ?? [],
      endpoints:    plugin.endpoints    ?? [],
      requires:     plugin.requires     ?? [],
      examples:     plugin.examples     ?? [],
    };

    loaded.push(manifest);
    console.log(`[plugins] loaded ${manifest.name}@${manifest.version}`);
  }
}

/** Returns full manifest of all successfully loaded plugins. */
export function getPlugins() {
  return loaded;
}
