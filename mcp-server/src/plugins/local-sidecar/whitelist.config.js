/**
 * Whitelist Configuration
 *
 * Manages allowed directories for local filesystem access.
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const DEFAULT_WHITELIST = [
  // Current workspace
  process.cwd(),
  // User's home directory (limited access)
  join(homedir(), "Documents"),
  join(homedir(), "Downloads"),
  // Project-specific directories can be added via config
];

let cachedWhitelist = null;

/**
 * Load whitelist configuration from file or use defaults
 * @returns {string[]} Array of allowed paths
 */
export function loadWhitelistConfig() {
  if (cachedWhitelist) return cachedWhitelist;

  const configPath = process.env.WHITELIST_CONFIG_PATH || join(process.cwd(), "whitelist.json");

  if (!existsSync(configPath)) {
    cachedWhitelist = DEFAULT_WHITELIST;
    return cachedWhitelist;
  }

  try {
    const fileContent = readFileSync(configPath, "utf8");
    const userConfig = JSON.parse(fileContent);
    
    if (Array.isArray(userConfig.directories)) {
      // Resolve all paths to absolute
      cachedWhitelist = userConfig.directories.map(dir => 
        resolve(dir.replace(/^~/, homedir()))
      );
    } else {
      cachedWhitelist = DEFAULT_WHITELIST;
    }
  } catch (err) {
    console.warn(`[local-sidecar] Failed to load whitelist: ${err.message}. Using defaults.`);
    cachedWhitelist = DEFAULT_WHITELIST;
  }

  return cachedWhitelist;
}

/**
 * Clear whitelist cache (for reloading)
 */
export function clearWhitelistCache() {
  cachedWhitelist = null;
}

/**
 * Check if a path is in the whitelist
 * @param {string} path - Path to check
 * @returns {boolean}
 */
export function isPathWhitelisted(path) {
  const whitelist = loadWhitelistConfig();
  const resolved = resolve(path);
  
  return whitelist.some(allowed => {
    const normalizedAllowed = resolve(allowed);
    return resolved === normalizedAllowed || 
           resolved.startsWith(normalizedAllowed + "/") ||
           resolved.startsWith(normalizedAllowed + "\\");
  });
}
