/**
 * Async prompt store with a promise-based mutex that covers the full
 * load → modify → save cycle, preventing read-modify-write race conditions.
 * Uses fs/promises exclusively (no sync fs calls).
 * Supports v2 schema (sections) and migrates v1 (content) on load.
 */

import { readFile, writeFile, mkdir, access } from "fs/promises";
import { join } from "path";

const DEFAULT_DIR = process.env.CATALOG_CACHE_DIR || "./cache";
const FILENAME   = "prompts.json";

let storePath = null;

function getStorePath() {
  if (storePath) return storePath;
  storePath = join(DEFAULT_DIR, FILENAME);
  return storePath;
}

/** Ensure cache directory exists (fully async) */
async function ensureDir() {
  try {
    await access(DEFAULT_DIR);
  } catch {
    await mkdir(DEFAULT_DIR, { recursive: true });
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

// ─── Mutex (covers full load → modify → save cycle) ─────────────────────────

let storeLock = Promise.resolve();

/**
 * Serialize any async operation against the store.
 * Failures do NOT poison the lock — future callers always get a chance to run.
 */
function withLock(fn) {
  const next = storeLock.then(fn);
  storeLock = next.catch(() => {});
  return next;
}

// ─── Internal (unlocked) helpers ─────────────────────────────────────────────

async function readStoreRaw() {
  await ensureDir();
  const p = getStorePath();
  try {
    const raw = await readFile(p, "utf8");
    return migrateStore(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return { prompts: [], versions: {} };
    throw err;
  }
}

async function writeStoreRaw(data) {
  await ensureDir();
  await writeFile(getStorePath(), JSON.stringify(data, null, 2), "utf8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load store from disk (async, serialized under lock for consistency).
 * Safe to call from read-only paths; does not modify on-disk state.
 * @returns {Promise<{ prompts: Array, versions: Object }>}
 */
export function loadPrompts() {
  return withLock(readStoreRaw);
}

/**
 * Atomically load, transform, and save the store.
 * The callback receives the current store data and must return
 * `{ data, result }` — `data` is written to disk, `result` is returned to the caller.
 * All concurrent calls are fully serialized so no read-modify-write races occur.
 *
 * @template T
 * @param {(store: { prompts: Array, versions: Object }) => Promise<{ data: object, result: T }>} fn
 * @returns {Promise<T>}
 */
export function withStore(fn) {
  return withLock(async () => {
    const store = await readStoreRaw();
    const { data, result } = await fn(store);
    await writeStoreRaw(data);
    return result;
  });
}
