/**
 * Fail-closed startup checks for security-related environment (production).
 */

import { getSecurityRuntime, hubKeysConfigured } from "./resolve-runtime-security.js";

/**
 * Call from createServer() before binding routes. No-op in test.
 */
export function validateSecurityConfigOrExit() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return;
  }

  const rt = getSecurityRuntime();

  if (rt.isProduction && rt.allowOpenHub) {
    console.error(
      "\n❌ Security: HUB_ALLOW_OPEN_HUB cannot be enabled when NODE_ENV=production.\n"
    );
    process.exit(1);
  }

  if (rt.isProduction && !hubKeysConfigured() && !process.env.OAUTH_INTROSPECTION_ENDPOINT?.trim()) {
    console.error(
      "\n❌ Security: production requires HUB_READ_KEY/HUB_WRITE_KEY/HUB_ADMIN_KEY and/or OAUTH_INTROSPECTION_ENDPOINT.\n"
    );
    process.exit(1);
  }

  if (rt.isProduction && process.env.HUB_AUTH_ENABLED === "false") {
    console.error(
      "\n❌ Security: HUB_AUTH_ENABLED=false is not allowed in production (fail-closed hub HTTP/STDIO).\n"
    );
    process.exit(1);
  }
}
