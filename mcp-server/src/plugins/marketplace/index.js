/**
 * Marketplace Plugin
 *
 * Community plugin discovery and management for MCP-Hub.
 * Enables searching, installing, and managing external plugins from npm.
 */

import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { config } from "../../core/config.js";
import { requireScope } from "../../core/auth.js";

const execAsync = promisify(exec);

// Marketplace configuration
const MARKETPLACE_DIR = join(process.cwd(), "marketplace");
const INSTALLED_DIR = join(MARKETPLACE_DIR, "installed");
const REGISTRY_CACHE_FILE = join(config.catalog.cacheDir, "marketplace-registry.json");

export const name = "marketplace";
export const version = "1.0.0";
export const description = "Community plugin discovery and installation from npm";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET", path: "/marketplace/search", description: "Search npm for MCP-Hub plugins", scope: "read" },
  { method: "GET", path: "/marketplace/installed", description: "List installed marketplace plugins", scope: "read" },
  { method: "POST", path: "/marketplace/install", description: "Install plugin from npm", scope: "write" },
  { method: "POST", path: "/marketplace/uninstall", description: "Uninstall marketplace plugin", scope: "write" },
  { method: "POST", path: "/marketplace/enable", description: "Enable/disable installed plugin", scope: "write" },
];
export const examples = [
  "GET /marketplace/search?q=mcp-hub-plugin",
  "POST /marketplace/install {\"package\": \"mcp-hub-plugin-example\"}",
  "GET /marketplace/installed",
];

// Ensure marketplace directories exist
function ensureDirectories() {
  if (!existsSync(MARKETPLACE_DIR)) {
    mkdirSync(MARKETPLACE_DIR, { recursive: true });
  }
  if (!existsSync(INSTALLED_DIR)) {
    mkdirSync(INSTALLED_DIR, { recursive: true });
  }
}

// Search npm registry for MCP-Hub plugins
async function searchNpm(query, limit = 20) {
  try {
    // Use npm search command
    const { stdout } = await execAsync(
      `npm search ${query} --json --long 2>/dev/null || echo "[]"`,
      { timeout: 30000 }
    );

    let results = [];
    try {
      results = JSON.parse(stdout);
    } catch {
      // Fallback: try alternative search
      const { stdout: altStdout } = await execAsync(
        `npm view ${query} --json 2>/dev/null || echo "{}"`,
        { timeout: 15000 }
      );
      const pkg = JSON.parse(altStdout);
      if (pkg && pkg.name) {
        results = [pkg];
      }
    }

    // Filter for MCP-Hub compatible plugins
    return results
      .filter((pkg) => {
        const name = pkg.name || "";
        const description = pkg.description || "";
        const keywords = pkg.keywords || [];

        return (
          name.startsWith("mcp-hub-plugin-") ||
          name.startsWith("mcp-hub-") ||
          description.toLowerCase().includes("mcp-hub") ||
          keywords.some((k) => k.toLowerCase().includes("mcp-hub"))
        );
      })
      .slice(0, limit)
      .map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        author: pkg.author?.name || pkg.author || "Unknown",
        keywords: pkg.keywords || [],
        npmLink: `https://www.npmjs.com/package/${pkg.name}`,
        repository: pkg.repository?.url || null,
        homepage: pkg.homepage || null,
        license: pkg.license || "Unknown",
        downloads: pkg.downloads || null,
        mcpHubCompatible: true,
      }));
  } catch (error) {
    console.error("[marketplace] npm search error:", error.message);
    return [];
  }
}

// Get installed plugins
function getInstalledPlugins() {
  ensureDirectories();

  try {
    const dirs = readdirSync(INSTALLED_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return dirs.map((dir) => {
      const manifestPath = join(INSTALLED_DIR, dir, "manifest.json");
      const packagePath = join(INSTALLED_DIR, dir, "package.json");

      let manifest = {};
      let pkg = {};

      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        } catch {}
      }

      if (existsSync(packagePath)) {
        try {
          pkg = JSON.parse(readFileSync(packagePath, "utf8"));
        } catch {}
      }

      return {
        name: manifest.name || pkg.name || dir,
        version: manifest.version || pkg.version || "unknown",
        description: manifest.description || pkg.description || "",
        installedAt: manifest.installedAt || null,
        enabled: manifest.enabled !== false,
        path: join(INSTALLED_DIR, dir),
      };
    });
  } catch (error) {
    console.error("[marketplace] Error reading installed plugins:", error.message);
    return [];
  }
}

// Install plugin from npm
async function installPlugin(packageName) {
  ensureDirectories();

  const pluginDir = join(INSTALLED_DIR, packageName.replace(/[@/]/g, "-"));

  if (existsSync(pluginDir)) {
    return { ok: false, error: "Plugin already installed", code: "already_installed" };
  }

  try {
    // Create plugin directory
    mkdirSync(pluginDir, { recursive: true });

    // Install package
    console.log(`[marketplace] Installing ${packageName}...`);
    await execAsync(
      `npm install ${packageName} --prefix ${pluginDir} --save`,
      { timeout: 120000, cwd: pluginDir }
    );

    // Read package.json to extract metadata
    const packagePath = join(pluginDir, "node_modules", packageName, "package.json");
    let pkg = {};
    if (existsSync(packagePath)) {
      pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    }

    // Create manifest
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      installedAt: new Date().toISOString(),
      enabled: true,
      entryPoint: pkg.main || "index.js",
      mcpHub: pkg.mcpHub || {},
    };

    writeFileSync(
      join(pluginDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    console.log(`[marketplace] Successfully installed ${packageName}`);

    return {
      ok: true,
      plugin: {
        name: manifest.name,
        version: manifest.version,
        path: pluginDir,
        requiresRestart: true,
      },
    };
  } catch (error) {
    console.error(`[marketplace] Failed to install ${packageName}:`, error.message);

    // Cleanup on failure
    try {
      await execAsync(`rm -rf ${pluginDir}`);
    } catch {}

    return {
      ok: false,
      error: `Installation failed: ${error.message}`,
      code: "install_failed",
    };
  }
}

// Uninstall plugin
async function uninstallPlugin(packageName) {
  const pluginDir = join(INSTALLED_DIR, packageName.replace(/[@/]/g, "-"));

  if (!existsSync(pluginDir)) {
    return { ok: false, error: "Plugin not found", code: "not_found" };
  }

  try {
    await execAsync(`rm -rf ${pluginDir}`);
    console.log(`[marketplace] Uninstalled ${packageName}`);
    return { ok: true, requiresRestart: true };
  } catch (error) {
    return {
      ok: false,
      error: `Uninstall failed: ${error.message}`,
      code: "uninstall_failed",
    };
  }
}

// Enable/disable plugin
function setPluginEnabled(packageName, enabled) {
  const pluginDir = join(INSTALLED_DIR, packageName.replace(/[@/]/g, "-"));
  const manifestPath = join(pluginDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    return { ok: false, error: "Plugin manifest not found", code: "not_found" };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.enabled = enabled;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return {
      ok: true,
      plugin: { name: manifest.name, enabled },
      requiresRestart: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to update plugin: ${error.message}`,
      code: "update_failed",
    };
  }
}

// Register routes
export function register(app) {
  ensureDirectories();

  const router = Router();

  /**
   * GET /marketplace/search?q=keyword
   * Search npm registry for MCP-Hub plugins
   */
  router.get("/search", requireScope("read"), async (req, res) => {
    const { q, limit = 20 } = req.query;

    if (!q) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_query", message: "Query parameter 'q' is required" },
      });
    }

    const results = await searchNpm(q, parseInt(limit, 10));

    res.json({
      ok: true,
      data: {
        query: q,
        count: results.length,
        results,
      },
    });
  });

  /**
   * GET /marketplace/installed
   * List installed marketplace plugins
   */
  router.get("/installed", requireScope("read"), (req, res) => {
    const plugins = getInstalledPlugins();

    res.json({
      ok: true,
      data: {
        count: plugins.length,
        plugins,
        marketplaceDir: INSTALLED_DIR,
      },
    });
  });

  /**
   * POST /marketplace/install
   * Install plugin from npm
   */
  router.post("/install", requireScope("write"), async (req, res) => {
    const { package: packageName } = req.body || {};

    if (!packageName) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_package", message: "Package name is required" },
      });
    }

    // Security: Validate package name
    if (!/^[a-z0-9-_.@/]+$/.test(packageName)) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_package", message: "Invalid package name" },
      });
    }

    const result = await installPlugin(packageName);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  });

  /**
   * POST /marketplace/uninstall
   * Uninstall marketplace plugin
   */
  router.post("/uninstall", requireScope("write"), async (req, res) => {
    const { package: packageName } = req.body || {};

    if (!packageName) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_package", message: "Package name is required" },
      });
    }

    const result = await uninstallPlugin(packageName);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  /**
   * POST /marketplace/enable
   * Enable/disable installed plugin
   */
  router.post("/enable", requireScope("write"), (req, res) => {
    const { package: packageName, enabled } = req.body || {};

    if (!packageName || typeof enabled !== "boolean") {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_params", message: "Package name and enabled boolean are required" },
      });
    }

    const result = setPluginEnabled(packageName, enabled);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  app.use("/marketplace", router);
  console.log("[marketplace] Plugin marketplace routes registered");
}
