import { createRequire } from "module";
import { join, dirname } from "path";
import { config } from "../../core/config.js";

const _require = createRequire(import.meta.url);

/**
 * @typedef {object} NodeSummary
 * @property {string}   type
 * @property {string}   displayName
 * @property {string}   name
 * @property {string[]} group
 * @property {string}   description
 * @property {number}   version
 * @property {object}   defaults
 * @property {string[]} inputs
 * @property {string[]} outputs
 * @property {number}   propertiesCount
 * @property {boolean}  credentialsRequired
 */

function trimProperty(p) {
  const out = {
    name: p.name,
    type: p.type,
    required: p.required ?? false,
    default: p.default ?? null,
  };
  if (p.description) out.description = p.description;
  if (Array.isArray(p.options) && p.options.length) {
    out.options = p.options
      .filter((o) => o && o.value !== undefined)
      .map((o) => ({ name: o.name ?? String(o.value), value: o.value }));
  }
  return out;
}

function trimCredential(c) {
  return { name: c.name, required: c.required ?? false };
}

/**
 * Normalize a raw n8n node descriptor into a NodeSummary.
 * Works for both /types/nodes.json and n8n-nodes-base descriptions.
 */
function normalize(raw) {
  const version =
    typeof raw.version === "number"
      ? raw.version
      : Array.isArray(raw.version)
      ? Math.max(...raw.version)
      : 1;

  const inputs = Array.isArray(raw.inputs)
    ? raw.inputs
    : typeof raw.inputs === "string"
    ? [raw.inputs]
    : ["main"];

  const outputs = Array.isArray(raw.outputs)
    ? raw.outputs
    : typeof raw.outputs === "string"
    ? [raw.outputs]
    : ["main"];

  // n8n-nodes-base package descriptions use short names ("telegram", "slack").
  // Workflows require the full prefixed type ("n8n-nodes-base.telegram").
  const shortName = raw.name ?? raw.type ?? "unknown";
  const fullType =
    shortName === "unknown" || shortName.includes(".")
      ? shortName
      : `n8n-nodes-base.${shortName}`;

  const node = {
    type: fullType,
    displayName: raw.displayName ?? raw.name ?? "Unknown",
    name: shortName,
    group: Array.isArray(raw.group) ? raw.group : [],
    description: raw.description ?? "",
    version,
    defaults: raw.defaults ?? {},
    inputs,
    outputs,
    propertiesCount: Array.isArray(raw.properties) ? raw.properties.length : 0,
    credentialsRequired:
      Array.isArray(raw.credentials) && raw.credentials.length > 0,
  };

  // Store trimmed details for /nodes/:type
  if (Array.isArray(raw.properties) && raw.properties.length) {
    node._properties = raw.properties.map(trimProperty);
  }
  if (Array.isArray(raw.credentials) && raw.credentials.length) {
    node._credentials = raw.credentials.map(trimCredential);
  }

  return node;
}

// ── Package-based source ──────────────────────────────────────────────────────

function getPackageInfo() {
  try {
    const pkgPath = _require.resolve("n8n-nodes-base/package.json");
    const pkg = _require(pkgPath);
    return { pkg, basePath: dirname(pkgPath) };
  } catch {
    return null;
  }
}

function extractFromModule(mod) {
  const results = [];
  const vals = typeof mod === "object" && mod !== null ? Object.values(mod) : [];

  for (const exported of vals) {
    if (typeof exported !== "function") continue;
    try {
      const instance = new exported();

      // Versioned node — check FIRST. These have a base description with no
      // properties; the real per-version descriptions live in nodeVersions.
      if (instance.nodeVersions && typeof instance.nodeVersions === "object") {
        const versions = Object.keys(instance.nodeVersions)
          .map(Number)
          .sort((a, b) => b - a);
        const latest = instance.nodeVersions[versions[0]];
        if (latest?.description?.name) {
          results.push(normalize(latest.description));
        }
        continue;
      }

      // Regular node: description with properties is directly on the instance
      if (instance.description?.name) {
        results.push(normalize(instance.description));
      }
    } catch {
      // Skip nodes that fail to instantiate
    }
  }

  return results;
}

/**
 * Load all node descriptors directly from the installed n8n-nodes-base package.
 * Result is meant to be cached to disk — this is slow (~30s) but runs once.
 */
export async function fetchFromPackage() {
  const info = getPackageInfo();
  if (!info) {
    return {
      ok: false,
      reason:
        "n8n-nodes-base is not installed. Run: npm install n8n-nodes-base",
    };
  }

  const { pkg, basePath } = info;
  const nodeFiles = pkg.n8n?.nodes ?? [];

  if (!nodeFiles.length) {
    return {
      ok: false,
      reason: "n8n-nodes-base/package.json has no n8n.nodes list",
    };
  }

  const nodes = [];
  let failed = 0;

  for (const relPath of nodeFiles) {
    const absPath = join(basePath, relPath);
    try {
      const mod = _require(absPath);
      const extracted = extractFromModule(mod);
      nodes.push(...extracted);
    } catch {
      failed++;
    }
  }

  if (!nodes.length) {
    return {
      ok: false,
      reason: `Loaded 0 nodes from n8n-nodes-base (${failed}/${nodeFiles.length} files failed)`,
    };
  }

  console.log(
    `[catalog] loaded ${nodes.length} nodes from n8n-nodes-base` +
      (failed ? ` (${failed} files skipped)` : "")
  );

  return {
    ok: true,
    nodes,
    rawSource: "n8n-nodes-base-package",
    updatedAt: new Date().toISOString(),
  };
}

// ── API-based source (fallback) ───────────────────────────────────────────────

/**
 * Fetch the node catalog from n8n's /types/nodes.json endpoint.
 * Requires session auth on most n8n versions — kept as fallback only.
 */
export async function fetchFromApi() {
  const url = `${config.n8n.baseUrl}/types/nodes.json`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return { ok: false, reason: `Network error reaching n8n: ${err.message}` };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `n8n returned HTTP ${res.status} for /types/nodes.json`,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to parse n8n response as JSON: ${err.message}`,
    };
  }

  const entries = Array.isArray(data) ? data : Object.values(data);
  if (!entries.length) {
    return { ok: false, reason: "n8n returned an empty node list" };
  }

  const nodes = entries.map(normalize);

  return {
    ok: true,
    nodes,
    rawSource: "n8n-api",
    updatedAt: new Date().toISOString(),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch catalog: tries n8n-nodes-base package first, falls back to n8n API.
 */
export async function fetchCatalog() {
  const result = await fetchFromPackage();
  if (result.ok) return result;

  console.warn(
    `[catalog] package source failed (${result.reason}), trying n8n API...`
  );
  return fetchFromApi();
}
