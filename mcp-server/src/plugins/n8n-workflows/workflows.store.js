import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { config } from "../../core/config.js";

const CACHE_SUBDIR = "n8n-workflows";
const DEFAULT_TTL_MINUTES = 10;

function cacheDir() {
  return resolve(join(config.catalog.cacheDir, CACHE_SUBDIR));
}

function ensureCacheDir() {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getTtlMs() {
  return (
    (Number(process.env.WORKFLOWS_TTL_MINUTES) || DEFAULT_TTL_MINUTES) *
    60 *
    1000
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ── List cache ────────────────────────────────────────────────────────────────
// Shape: { updatedAt: ISOString, items: Array<{id, name, active, updatedAt}> }

export function loadListFromDisk() {
  const parsed = readJson(join(cacheDir(), "list.json"));
  if (!parsed?.updatedAt || !Array.isArray(parsed.items)) return null;
  return parsed;
}

export function saveListToDisk(items) {
  ensureCacheDir();
  writeFileSync(
    join(cacheDir(), "list.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), items }),
    "utf8"
  );
}

export function isListFresh(cached) {
  if (!cached?.updatedAt) return false;
  return Date.now() - new Date(cached.updatedAt).getTime() < getTtlMs();
}

// ── Per-ID cache ──────────────────────────────────────────────────────────────
// Shape: { updatedAt: ISOString, workflow: object }
// File: <cacheDir>/wf-<id>.json

export function loadWorkflowFromDisk(id) {
  const parsed = readJson(join(cacheDir(), `wf-${id}.json`));
  if (!parsed?.updatedAt || !parsed.workflow) return null;
  return parsed;
}

export function saveWorkflowToDisk(id, workflow) {
  ensureCacheDir();
  writeFileSync(
    join(cacheDir(), `wf-${id}.json`),
    JSON.stringify({ updatedAt: new Date().toISOString(), workflow }),
    "utf8"
  );
}

export function isWorkflowFresh(cached) {
  if (!cached?.updatedAt) return false;
  return Date.now() - new Date(cached.updatedAt).getTime() < getTtlMs();
}
