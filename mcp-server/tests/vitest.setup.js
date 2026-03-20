/**
 * Vitest global setup — explicit dev/test overrides (production defaults stay fail-closed in app code).
 * Do not delete HUB_* keys here: tests that import src/core/config.js need valid auth.* placeholders.
 * MCP tests that run without Bearer clear keys in their own beforeAll (see workspace-context / integration).
 */
process.env.NODE_ENV ??= "test";

/** Opt-in anonymous principal when hub keys are absent (per-test files may also set this after clearing keys). */
process.env.HUB_ALLOW_OPEN_HUB ??= "true";

/** Most tests are not multi-tenant */
process.env.HUB_REQUIRE_TENANT_ID ??= "false";

/** Strict workspace registry off in unit tests unless overridden */
process.env.HUB_STRICT_WORKSPACE ??= "false";

/** Single flag for REST guard + tool policy missing evaluator (replaces scattered defaults) */
process.env.POLICY_ALLOW_MISSING_EVALUATOR ??= "true";
