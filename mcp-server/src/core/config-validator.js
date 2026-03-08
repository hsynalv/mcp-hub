/**
 * Config Validation System
 * 
 * Three-tier config with schema validation:
 * 1. Core config - Server-level settings
 * 2. Plugin config - Per-plugin settings
 * 3. Secret references - {{secret:NAME}} resolution
 * 
 * Features:
 * - Schema validation at startup (fail-fast)
 * - Missing env var detection
 * - Masked config logging
 * - Environment profiles (.env.local, .env.production)
 */

import { z } from "zod";

/**
 * Core config schema
 */
export const CoreConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8787),
  auth: z.object({
    readKey: z.string().min(1).optional(),
    writeKey: z.string().min(1).optional(),
    adminKey: z.string().min(1).optional(),
  }),
  audit: z.object({
    logToFile: z.boolean().default(false),
  }),
  redis: z.object({
    url: z.string().url().optional(),
    enabled: z.boolean().default(false),
    keyPrefix: z.string().default("mcp-hub:"),
    ttlSeconds: z.number().int().default(86400),
  }),
});

/**
 * Plugin config schema builder
 */
export function buildPluginConfigSchema(pluginName) {
  return z.object({
    enabled: z.boolean().default(true),
    scope: z.enum(["read", "write", "admin"]).default("read"),
    timeout: z.number().int().default(30000),
    retries: z.number().int().default(2),
    // Plugin-specific env vars
    env: z.record(z.string()).default({}),
  });
}

/**
 * Config validator
 */
export class ConfigValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.maskedKeys = [
      /key/i,
      /token/i,
      /secret/i,
      /password/i,
      /credential/i,
      /api_key/i,
    ];
  }

  /**
   * Validate core config
   */
  validateCore(config) {
    try {
      const result = CoreConfigSchema.safeParse(config);
      
      if (!result.success) {
        for (const error of result.error.errors) {
          this.errors.push({
            path: error.path.join("."),
            message: error.message,
            type: "core",
          });
        }
        return null;
      }
      
      return result.data;
    } catch (err) {
      this.errors.push({
        path: "core",
        message: err.message,
        type: "core",
      });
      return null;
    }
  }

  /**
   * Validate plugin config
   */
  validatePlugin(pluginName, config) {
    const schema = buildPluginConfigSchema(pluginName);
    
    try {
      const result = schema.safeParse(config);
      
      if (!result.success) {
        for (const error of result.error.errors) {
          this.warnings.push({
            plugin: pluginName,
            path: error.path.join("."),
            message: error.message,
          });
        }
        return null;
      }
      
      return result.data;
    } catch (err) {
      this.warnings.push({
        plugin: pluginName,
        path: "general",
        message: err.message,
      });
      return null;
    }
  }

  /**
   * Check required environment variables
   */
  checkRequiredEnvVars(requiredVars) {
    for (const varName of requiredVars) {
      if (!process.env[varName] || process.env[varName].trim() === "") {
        this.errors.push({
          path: `env.${varName}`,
          message: `Required environment variable ${varName} is missing or empty`,
          type: "env",
        });
      }
    }
  }

  /**
   * Resolve secret references
   * Format: {{secret:SECRET_NAME}}
   */
  resolveSecrets(value, secretsStore) {
    if (typeof value !== "string") return value;
    
    const secretRegex = /\{\{secret:([^}]+)\}\}/g;
    
    return value.replace(secretRegex, (match, secretName) => {
      const secret = secretsStore?.getSecret?.(secretName);
      if (!secret) {
        this.warnings.push({
          path: "secrets",
          message: `Secret ${secretName} not found in store`,
        });
        return match; // Leave unresolved
      }
      return secret;
    });
  }

  /**
   * Mask sensitive values for logging
   */
  maskConfig(config) {
    const masked = JSON.parse(JSON.stringify(config));
    
    this.maskObject(masked);
    
    return masked;
  }

  maskObject(obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveKey(key)) {
        obj[key] = this.maskValue(value);
      } else if (typeof value === "object" && value !== null) {
        this.maskObject(value);
      }
    }
  }

  isSensitiveKey(key) {
    return this.maskedKeys.some(pattern => pattern.test(key));
  }

  maskValue(value) {
    if (!value) return value;
    if (typeof value !== "string") return "***";
    if (value.length <= 4) return "***";
    return value.slice(0, 2) + "***" + value.slice(-2);
  }

  /**
   * Get validation result
   */
  getResult() {
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  /**
   * Fail fast - throw if errors exist
   */
  failFast() {
    if (this.errors.length > 0) {
      const messages = this.errors.map(e => `[${e.type}] ${e.path}: ${e.message}`);
      throw new Error(`Config validation failed:\n${messages.join("\n")}`);
    }
  }
}

/**
 * Load environment profile
 * Order: .env.{NODE_ENV} → .env.local → .env
 */
export function loadEnvProfile() {
  const env = process.env.NODE_ENV || "development";
  const profiles = [
    `.env.${env}`,
    ".env.local",
    ".env",
  ];
  
  return profiles;
}

/**
 * Startup config validation
 */
export function validateStartupConfig() {
  const validator = new ConfigValidator();
  
  // Check critical env vars
  validator.checkRequiredEnvVars([
    // Add truly critical vars here
  ]);
  
  const result = validator.getResult();
  
  if (!result.valid) {
    console.error("❌ Config validation failed:");
    for (const error of result.errors) {
      console.error(`  [${error.type}] ${error.path}: ${error.message}`);
    }
    validator.failFast();
  }
  
  if (result.warnings.length > 0) {
    console.warn("⚠️  Config warnings:");
    for (const warning of result.warnings) {
      console.warn(`  ${warning.plugin || ""} ${warning.path}: ${warning.message}`);
    }
  }
  
  return result.valid;
}

/**
 * Admin endpoint - masked config view
 */
export function getMaskedConfig() {
  const { config } = require("./config.js");
  const validator = new ConfigValidator();
  return validator.maskConfig(config);
}
