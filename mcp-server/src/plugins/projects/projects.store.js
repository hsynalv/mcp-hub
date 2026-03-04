/**
 * Projects store — JSON file storage for multi-project, multi-env configs.
 * Stored at: {CATALOG_CACHE_DIR}/projects.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveTemplate } from "../secrets/secrets.store.js";

function storePath() {
  const dir = process.env.CATALOG_CACHE_DIR || "./cache";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "projects.json");
}

function load() {
  const p = storePath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function save(data) {
  writeFileSync(storePath(), JSON.stringify(data, null, 2));
}

export function listProjects() {
  const all = load();
  return Object.entries(all).map(([key, project]) => ({
    key,
    name:     project.name,
    envs:     Object.keys(project.envs ?? {}),
    createdAt: project.createdAt,
  }));
}

export function getProject(name) {
  const all = load();
  return all[name] ?? null;
}

/**
 * Get a resolved env config — secret refs in values are resolved,
 * but only for non-sensitive display fields (like URLs, IDs).
 * Secret values themselves are never returned.
 */
export function getProjectEnv(name, env) {
  const project = getProject(name);
  if (!project) return null;

  const envConfig = project.envs?.[env];
  if (!envConfig) return null;

  // Resolve secret refs in string values (for URLs, IDs)
  // but mark refs that point to actual secrets as [RESOLVED]
  const resolved = {};
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string" && v.includes("{{secret:")) {
      // For display, mark as resolved without revealing value
      const hasValue = resolveTemplate(v) !== v;
      resolved[k] = hasValue ? `[RESOLVED:${v}]` : v;
    } else {
      resolved[k] = v;
    }
  }

  return {
    project:  name,
    env,
    config:   resolved,
    rawConfig: envConfig, // Include raw for server-side use
  };
}

export function createProject(key, name) {
  const all = load();
  if (all[key]) throw new Error(`Project "${key}" already exists`);

  all[key] = {
    name,
    envs:      {},
    createdAt: new Date().toISOString(),
  };
  save(all);
  return all[key];
}

export function upsertProjectEnv(projectKey, env, config) {
  const all = load();
  if (!all[projectKey]) throw new Error(`Project "${projectKey}" not found`);

  all[projectKey].envs ??= {};
  all[projectKey].envs[env] = {
    ...all[projectKey].envs[env],
    ...config,
  };
  all[projectKey].updatedAt = new Date().toISOString();
  save(all);
  return all[projectKey].envs[env];
}

export function deleteProject(key) {
  const all = load();
  if (!all[key]) return false;
  delete all[key];
  save(all);
  return true;
}
