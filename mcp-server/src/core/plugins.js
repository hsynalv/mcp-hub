import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, "../plugins");

const loaded = [];

// Discover and load plugins from src/plugins/<name>/index.js.
// Each plugin must export: { name, version, register(app) }
export async function loadPlugins(app) {
  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const dir of dirs) {
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

    loaded.push({
      name: plugin.name ?? dir,
      version: plugin.version ?? "0.0.0",
      ...(plugin.description ? { description: plugin.description } : {}),
    });

    console.log(`[plugins] loaded ${plugin.name ?? dir}@${plugin.version ?? "0.0.0"}`);
  }
}

/** Returns metadata of all successfully loaded plugins. */
export function getPlugins() {
  return loaded;
}
