/**
 * Secret store — Phase 1: .env-backed references.
 *
 * Secrets are NEVER stored by value in this layer.
 * The store keeps a registry of known secret names (with metadata)
 * so the API can list them without exposing values.
 *
 * Phase 2 (future): AES-256 encrypted JSON file for runtime-registered secrets.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const REGISTRY_PATH = join(
  process.cwd(),
  process.env.CATALOG_CACHE_DIR || "./cache",
  "secrets-registry.json"
);

/**
 * Load the registry from disk.
 * Registry format: { [name]: { name, description, createdAt, source } }
 */
function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveRegistry(registry) {
  const dir = join(process.cwd(), process.env.CATALOG_CACHE_DIR || "./cache");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

/**
 * Resolve a single secret name to its value.
 * Currently reads from process.env — value never leaves the server.
 */
export function resolveSecret(name) {
  return process.env[name] ?? null;
}

/**
 * Resolve all {{secret:NAME}} refs in a string.
 * Returns the resolved string (used server-side only).
 * If a secret is not found, the placeholder is left as-is.
 */
export function resolveTemplate(str) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{secret:([A-Z0-9_]+)\}\}/g, (_, name) => {
    const val = resolveSecret(name);
    return val ?? `{{secret:${name}}}`;
  });
}

/**
 * Resolve all {{secret:NAME}} refs in any value (string, object, array).
 * Used to process headers/body objects recursively.
 */
export function resolveDeep(val) {
  if (typeof val === "string") return resolveTemplate(val);
  if (Array.isArray(val)) return val.map(resolveDeep);
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = resolveDeep(v);
    return out;
  }
  return val;
}

/** List registered secret names (never values). */
export function listSecrets() {
  const registry = loadRegistry();
  return Object.values(registry).map(({ name, description, createdAt, source }) => ({
    name,
    description: description ?? "",
    createdAt,
    source,
    hasValue: resolveSecret(name) !== null,
  }));
}

/** Register a secret name (does NOT store the value — only the name/metadata). */
export function registerSecret(name, description = "") {
  if (!name || typeof name !== "string" || !/^[A-Z0-9_]+$/.test(name)) {
    throw new Error("Secret name must be UPPER_SNAKE_CASE");
  }
  const registry = loadRegistry();
  registry[name] = {
    name,
    description,
    createdAt: new Date().toISOString(),
    source: "env",
  };
  saveRegistry(registry);
  return { name, description, source: "env", createdAt: registry[name].createdAt };
}

/** Remove a secret from the registry. Does not affect process.env. */
export function unregisterSecret(name) {
  const registry = loadRegistry();
  const existed = !!registry[name];
  delete registry[name];
  if (existed) saveRegistry(registry);
  return existed;
}
