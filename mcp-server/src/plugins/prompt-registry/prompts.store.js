/**
 * Async prompt store with single-writer queue to prevent race conditions.
 * Uses fs/promises. Supports v2 schema (sections) and migrates v1 (content) on load.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const DEFAULT_DIR = process.env.CATALOG_CACHE_DIR || "./cache";
const FILENAME   = "prompts.json";

let storePath = null;

function getStorePath() {
  if (storePath) return storePath;
  const dir = DEFAULT_DIR;
  storePath = join(dir, FILENAME);
  return storePath;
}

/** Ensure cache directory exists */
async function ensureDir() {
  const dir = DEFAULT_DIR;
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/** Migrate v1 document (content) to v2 (sections) */
function migrateDoc(doc) {
  if (doc.sections && typeof doc.sections === "object") return doc;
  return {
    ...doc,
    mode: doc.mode || "agent",
    contextSlots: doc.contextSlots || [],
    toolsBundle: doc.toolsBundle || [],
    sections: doc.content != null
      ? { identity: doc.content }
      : (doc.sections || {}),
  };
}

/** Migrate full store */
function migrateStore(data) {
  if (!data.prompts || !Array.isArray(data.prompts)) {
    return { prompts: [], versions: data.versions || {} };
  }
  const prompts = data.prompts.map(migrateDoc);
  const versions = data.versions || {};
  for (const id of Object.keys(versions)) {
    const vMap = versions[id];
    for (const v of Object.keys(vMap)) {
      vMap[v] = migrateDoc(vMap[v]);
    }
  }
  return { prompts, versions };
}

let writeQueue = Promise.resolve();

/**
 * Load store from disk (async). Migrates v1 to v2 on read.
 * @returns {Promise<{ prompts: Array, versions: Object }>}
 */
export async function loadPrompts() {
  await ensureDir();
  const p = getStorePath();
  if (!existsSync(p)) {
    return { prompts: [], versions: {} };
  }
  try {
    const raw = await readFile(p, "utf8");
    const data = JSON.parse(raw);
    return migrateStore(data);
  } catch (err) {
    if (err.code === "ENOENT") return { prompts: [], versions: {} };
    throw err;
  }
}

/**
 * Save store to disk. Queued to avoid concurrent writes.
 * @param {{ prompts: Array, versions: Object }} data
 */
export async function savePrompts(data) {
  await ensureDir();
  const p = getStorePath();
  writeQueue = writeQueue
    .then(() => writeFile(p, JSON.stringify(data, null, 2), "utf8"))
    .catch((err) => {
      console.error("[prompt-registry] savePrompts error:", err.message);
      throw err;
    });
  await writeQueue;
}
