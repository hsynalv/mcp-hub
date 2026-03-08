/**
 * Configuration Schema Validation
 * 
 * Validates environment variables at startup using Zod.
 * Fail-fast approach: exits if required config is missing/invalid.
 */

import { z } from "zod";

/**
 * Core configuration schema
 */
export const ConfigSchema = z.object({
  // Server
  port: z.number().int().min(1).max(65535).default(8787),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),

  // Auth
  auth: z.object({
    readKey: z.string().min(1, "HUB_READ_KEY is required"),
    writeKey: z.string().min(1, "HUB_WRITE_KEY is required"),
    adminKey: z.string().min(1, "HUB_ADMIN_KEY is required"),
  }),

  // Audit
  audit: z.object({
    logToFile: z.boolean().default(false),
  }),

  // n8n
  n8n: z.object({
    baseUrl: z.string().url().default("http://n8n:5678"),
    apiBase: z.string().default("/api/v1"),
    apiKey: z.string().optional(),
    allowWrite: z.boolean().default(false),
  }),

  // Catalog
  catalog: z.object({
    cacheDir: z.string().default("./cache"),
    ttlHours: z.number().int().default(24),
  }),

  // Notion
  notion: z.object({
    apiKey: z.string().min(1, "NOTION_API_KEY is required"),
    rootPageId: z.string().optional(),
    projectsDbId: z.string().optional(),
    tasksDbId: z.string().optional(),
  }),

  // HTTP
  http: z.object({
    allowedDomains: z.string().optional(),
    blockedDomains: z.string().optional(),
    maxResponseSizeKb: z.number().int().default(512),
    defaultTimeoutMs: z.number().int().default(10000),
    rateLimitRpm: z.number().int().default(60),
    cacheTtlSeconds: z.number().int().default(300),
  }),

  // OpenAPI
  openapi: z.object({
    cacheDir: z.string().default("./cache/openapi"),
  }),

  // Sentry
  sentry: z.object({
    dsn: z.string().optional(),
  }),

  // File Storage
  fileStorage: z.object({
    localRoot: z.string().default("./cache/files"),
    maxFileSizeMb: z.number().int().default(50),
  }),

  // Database
  database: z.object({
    mssqlConnectionString: z.string().optional(),
    pgConnectionString: z.string().optional(),
    mongodbUri: z.string().optional(),
  }),

  // Plugins
  plugins: z.object({
    enableN8n: z.boolean().default(true),
    enableN8nCredentials: z.boolean().default(true),
    enableN8nWorkflows: z.boolean().default(true),
    strictLoading: z.boolean().default(false),
  }),

  // Redis
  redis: z.object({
    url: z.string().optional(),
    enabled: z.boolean().default(false),
    keyPrefix: z.string().default("mcp-hub:"),
    ttlSeconds: z.number().int().default(86400),
  }),
});

/**
 * Validate configuration object
 * @param {Object} rawConfig - Raw configuration from process.env
 * @returns {Object} Validated config
 */
export function validateConfig(rawConfig) {
  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map((e) => {
      return `  - ${e.path.join(".")}: ${e.message}`;
    }).join("\n");

    console.error("\n❌ Configuration validation failed:");
    console.error(errors);
    console.error("\nPlease check your .env file and ensure all required variables are set.\n");
    process.exit(1);
  }

  return result.data;
}

/**
 * Sanitize config for logging (mask secrets)
 * @param {Object} config - Validated config
 * @returns {Object} Sanitized config
 */
export function sanitizeConfig(config) {
  const sensitiveKeys = [
    /key/i,
    /token/i,
    /secret/i,
    /password/i,
    /apiKey/i,
    /connectionString/i,
    /uri/i,
    /dsn/i,
  ];

  function maskValue(key, value) {
    if (typeof value !== "string" || !value) return value;
    if (sensitiveKeys.some((pattern) => pattern.test(key))) {
      if (value.length <= 8) return "***";
      return value.slice(0, 4) + "..." + value.slice(-4);
    }
    return value;
  }

  function sanitizeObject(obj, path = "") {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = path ? `${path}.${key}` : key;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = sanitizeObject(value, fullKey);
      } else {
        sanitized[key] = maskValue(key, value);
      }
    }
    return sanitized;
  }

  return sanitizeObject(config);
}

/**
 * Log startup configuration (sanitized)
 * @param {Object} config - Validated config
 */
export function logStartupConfig(config) {
  const sanitized = sanitizeConfig(config);
  
  console.log("\n✅ Configuration loaded successfully");
  console.log("📋 Server Configuration:");
  console.log(`   Port: ${sanitized.port}`);
  console.log(`   Environment: ${sanitized.nodeEnv}`);
  console.log(`   Redis: ${config.redis.enabled ? "enabled" : "disabled"}`);
  
  console.log("\n🔐 Auth Keys:");
  console.log(`   Read Key: ${sanitized.auth.readKey}`);
  console.log(`   Write Key: ${sanitized.auth.writeKey}`);
  console.log(`   Admin Key: ${sanitized.auth.adminKey}`);
  
  if (config.notion.apiKey) {
    console.log("\n📝 Notion: enabled");
  }
  if (config.n8n.apiKey) {
    console.log("🔗 n8n: enabled");
  }
  if (config.redis.enabled) {
    console.log("📦 Redis: enabled");
  }
  
  console.log("");
}
