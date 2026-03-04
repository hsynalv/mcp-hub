/**
 * Spec store — disk-backed cache for loaded OpenAPI specs.
 * Stored at: {CATALOG_CACHE_DIR}/openapi/<id>.json
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

function cacheDir() {
  const base = process.env.OPENAPI_CACHE_DIR
    || join(process.env.CATALOG_CACHE_DIR || "./cache", "openapi");
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

function specPath(id) {
  return join(cacheDir(), `${id}.json`);
}

/** Generate a short deterministic ID from a name. */
export function makeId(name) {
  return createHash("sha256").update(name).digest("hex").slice(0, 8);
}

export function saveSpec(id, data) {
  writeFileSync(specPath(id), JSON.stringify(data, null, 2));
}

export function loadSpec(id) {
  const p = specPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function deleteSpec(id) {
  const p = specPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function listSpecs() {
  const dir = cacheDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const id = f.replace(".json", "");
        const data = loadSpec(id);
        if (!data) return null;
        return {
          id,
          name:      data.meta?.name ?? id,
          title:     data.parsed?.info?.title ?? "",
          version:   data.parsed?.info?.version ?? "",
          source:    data.meta?.source ?? "unknown",
          loadedAt:  data.meta?.loadedAt ?? "",
          endpoints: data.endpointCount ?? 0,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
