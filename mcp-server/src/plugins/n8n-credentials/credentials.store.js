import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { config } from "../../core/config.js";

const CACHE_SUBDIR = "n8n-credentials";
const CACHE_FILE = "credentials.json";
const DEFAULT_TTL_MINUTES = 60;

function cacheFilePath() {
  return resolve(join(config.catalog.cacheDir, CACHE_SUBDIR, CACHE_FILE));
}

function ensureCacheDir() {
  const dir = resolve(join(config.catalog.cacheDir, CACHE_SUBDIR));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getTtlMs() {
  return (
    (Number(process.env.CREDENTIALS_TTL_MINUTES) || DEFAULT_TTL_MINUTES) *
    60 *
    1000
  );
}

/**
 * Load credentials cache from disk.
 * Shape: { updatedAt: ISOString, items: Array<{id, name, type}> }
 * Returns null if missing or corrupt.
 */
export function loadFromDisk() {
  try {
    const raw = readFileSync(cacheFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.updatedAt || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist credential list to disk with current timestamp. */
export function saveToDisk(items) {
  ensureCacheDir();
  writeFileSync(
    cacheFilePath(),
    JSON.stringify({ updatedAt: new Date().toISOString(), items }),
    "utf8"
  );
}

/** Check if cached data is still within TTL. */
export function isFresh(cached) {
  if (!cached?.updatedAt) return false;
  const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
  return ageMs < getTtlMs();
}
