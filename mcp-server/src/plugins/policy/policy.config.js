/**
 * Policy configuration loader
 * Loads policy.json with default values
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DEFAULT_CONFIG = {
  destructive_requires_approval: true,
  write_requires_approval: false,
};

let cachedConfig = null;

export function loadPolicyConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = process.env.POLICY_CONFIG_PATH || join(process.cwd(), "policy.json");

  if (!existsSync(configPath)) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  try {
    const fileContent = readFileSync(configPath, "utf8");
    const userConfig = JSON.parse(fileContent);
    cachedConfig = { ...DEFAULT_CONFIG, ...userConfig };
    return cachedConfig;
  } catch (err) {
    console.warn(`[policy.config] Failed to load policy.json: ${err.message}. Using defaults.`);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

export function clearPolicyConfigCache() {
  cachedConfig = null;
}
