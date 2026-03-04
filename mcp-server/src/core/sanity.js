/**
 * Startup sanity checks
 * PR-10: Deployment hardening — secure defaults
 *
 * Validates critical environment configuration at boot time.
 */

import { config } from "./config.js";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";

const CRITICAL_ENV_VARS = [
  { name: "NODE_ENV", required: false, allowed: ["development", "production", "test"] },
];

const SECURITY_WARNINGS = [
  { name: "HUB_ADMIN_KEY", message: "Running without admin API key authentication" },
  { name: "HUB_WRITE_KEY", message: "Running without write API key authentication" },
  { name: "HUB_READ_KEY", message: "Running without read API key authentication" },
];

/**
 * Run startup sanity checks.
 * Returns { ok: boolean, errors: string[], warnings: string[] }
 */
export function runStartupChecks() {
  const errors = [];
  const warnings = [];

  // Check Node version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (majorVersion < 18) {
    errors.push(`Node.js version ${nodeVersion} is too old. Minimum required: 18.x`);
  }

  // Check critical environment variables
  for (const env of CRITICAL_ENV_VARS) {
    const value = process.env[env.name];
    if (env.required && !value) {
      errors.push(`Missing required environment variable: ${env.name}`);
    }
    if (value && env.allowed && !env.allowed.includes(value)) {
      errors.push(`Invalid value for ${env.name}: "${value}". Allowed: ${env.allowed.join(", ")}`);
    }
  }

  // Security warnings (open mode)
  for (const check of SECURITY_WARNINGS) {
    if (!process.env[check.name]) {
      warnings.push(check.message);
    }
  }

  // Check port configuration
  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port configuration: ${config.port}`);
  }

  // Check cache directory writable (if file logging enabled)
  if (process.env.AUDIT_LOG_FILE === "true") {
    try {
      const cacheDir = process.env.CATALOG_CACHE_DIR || "./cache";
      const testFile = `${cacheDir}/.write-test`;
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(testFile, "");
      unlinkSync(testFile);
    } catch (err) {
      warnings.push(`Cache directory may not be writable: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print startup status and exit if critical errors found.
 */
export async function validateStartup() {
  const result = runStartupChecks();

  console.log("[startup] Running sanity checks...");

  if (result.errors.length > 0) {
    console.error("[startup] CRITICAL ERRORS:");
    for (const error of result.errors) {
      console.error(`  ❌ ${error}`);
    }
    console.error("[startup] Server will not start due to configuration errors.");
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn("[startup] WARNINGS:");
    for (const warning of result.warnings) {
      console.warn(`  ⚠️  ${warning}`);
    }
  }

  console.log("[startup] ✅ All sanity checks passed");
  return true;
}
