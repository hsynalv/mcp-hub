/**
 * Secret store — Phase 1: .env-backed references with workspace isolation and audit logging.
 *
 * Secrets are NEVER stored by value in this layer.
 * The store keeps a registry of known secret names (with metadata)
 * so the API can list them without exposing values.
 *
 * Phase 2 (future): AES-256 encrypted JSON file for runtime-registered secrets.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// In-memory audit log for secrets operations (values never logged)
const auditLog = [];
const MAX_AUDIT_LOG_SIZE = 1000;

/**
 * Generate correlation ID for tracing
 */
export function generateCorrelationId() {
  return `sec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Add audit entry - NEVER logs secret values
 */
export function auditEntry(entry) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation: entry.operation,
    secretName: entry.secretName,
    // NEVER log: entry.value, entry.previousValue, entry.newValue
    actor: entry.actor || null,
    workspaceId: entry.workspaceId || null,
    projectId: entry.projectId || null,
    correlationId: entry.correlationId || null,
    durationMs: entry.durationMs || null,
    allowed: entry.allowed,
    reason: entry.reason || null,
    error: entry.error || null,
  };

  auditLog.unshift(logEntry);
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.pop();
  }

  // Console log for visibility (value never included)
  const status = entry.allowed ? "ALLOWED" : "DENIED";
  console.log(`[secrets-audit] ${status} | ${entry.operation} | ${entry.secretName} | ${entry.reason || "ok"}`);

  return logEntry;
}

/**
 * Get recent audit log entries
 */
export function getAuditLogEntries(limit = 100) {
  return auditLog.slice(0, Math.min(limit, MAX_AUDIT_LOG_SIZE));
}

/**
 * Get registry path with optional workspace isolation
 * Format: <base_cache>/secrets-registry[-<workspaceId>].json
 */
function getRegistryPath(workspaceId = null) {
  const baseDir = join(
    process.cwd(),
    process.env.CATALOG_CACHE_DIR || "./cache"
  );

  // If workspace isolation enabled and workspaceId provided
  if (process.env.SECRETS_WORKSPACE_ISOLATION === "true" && workspaceId) {
    // Sanitize workspaceId to prevent traversal
    const sanitizedWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitizedWorkspace) {
      throw new Error("Invalid workspaceId");
    }
    return join(baseDir, `secrets-registry-${sanitizedWorkspace}.json`);
  }

  return join(baseDir, "secrets-registry.json");
}

/**
 * Extract workspace context
 */
export function extractWorkspaceContext(context = {}) {
  // If strict mode and no workspace, deny
  if (process.env.SECRETS_WORKSPACE_STRICT === "true" && !context.workspaceId) {
    throw new Error("workspaceId required in strict mode");
  }
  return context.workspaceId || null;
}

/**
 * Load the registry from disk.
 * Registry format: { [name]: { name, description, createdAt, source, workspaceId } }
 */
function loadRegistry(workspaceId = null) {
  const registryPath = getRegistryPath(workspaceId);
  if (!existsSync(registryPath)) return {};
  try {
    return JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return {};
  }
}

function saveRegistry(registry, workspaceId = null) {
  const registryPath = getRegistryPath(workspaceId);
  const dir = join(process.cwd(), process.env.CATALOG_CACHE_DIR || "./cache");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
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
export function listSecrets(context = {}) {
  const workspaceId = extractWorkspaceContext(context);
  const registry = loadRegistry(workspaceId);
  return Object.values(registry).map(({ name, description, createdAt, source, workspaceId: wsId }) => ({
    name,
    description: description ?? "",
    createdAt,
    source,
    workspaceId: wsId || null,
    hasValue: resolveSecret(name) !== null,
  }));
}

/** Register a secret name (does NOT store the value — only the name/metadata). */
export function registerSecret(name, description = "", context = {}) {
  if (!name || typeof name !== "string" || !/^[A-Z0-9_]+$/.test(name)) {
    throw new Error("Secret name must be UPPER_SNAKE_CASE");
  }

  const workspaceId = extractWorkspaceContext(context);
  const registry = loadRegistry(workspaceId);
  registry[name] = {
    name,
    description,
    createdAt: new Date().toISOString(),
    source: "env",
    workspaceId,
  };
  saveRegistry(registry, workspaceId);
  return { name, description, source: "env", workspaceId, createdAt: registry[name].createdAt };
}

/** Remove a secret from the registry. Does not affect process.env. */
export function unregisterSecret(name, context = {}) {
  const workspaceId = extractWorkspaceContext(context);
  const registry = loadRegistry(workspaceId);
  const existed = !!registry[name];
  delete registry[name];
  if (existed) saveRegistry(registry, workspaceId);
  return existed;
}
