import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { config } from "../../core/config.js";

const CACHE_FILE = "n8n-catalog.json";

function cachePath() {
  return resolve(join(config.catalog.cacheDir, CACHE_FILE));
}

function ensureCacheDir() {
  const dir = resolve(config.catalog.cacheDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Load catalog from disk. Returns null if missing or corrupt.
 * Shape: { updatedAt, nodes, rawSource }
 */
export function loadFromDisk() {
  try {
    const raw = readFileSync(cachePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.updatedAt || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist catalog to disk. */
export function saveToDisk(catalog) {
  ensureCacheDir();
  writeFileSync(cachePath(), JSON.stringify(catalog), "utf8");
}

/**
 * Check if a cached catalog is still fresh.
 * @param {object} catalog - catalog object with updatedAt ISO string
 * @param {number} ttlHours
 */
export function isFresh(catalog, ttlHours = config.catalog.ttlHours) {
  if (!catalog?.updatedAt) return false;
  const ageMs = Date.now() - new Date(catalog.updatedAt).getTime();
  return ageMs < ttlHours * 60 * 60 * 1000;
}
