/**
 * Plugin Contract Test Framework
 * 
 * Validates plugin input/output schemas and provides
 * contract testing utilities for all plugins.
 */

import { z } from "zod";

/**
 * Validate a plugin's exported structure
 * @param {Object} plugin - The imported plugin module
 * @param {string} pluginName - Name of the plugin
 * @returns {Object} Validation result
 */
export function validatePluginContract(plugin, pluginName) {
  const errors = [];
  const warnings = [];

  // Check required exports
  if (!plugin.name) {
    errors.push(`Missing required export: name`);
  } else if (plugin.name !== pluginName) {
    errors.push(`Name mismatch: export "${plugin.name}" vs folder "${pluginName}"`);
  }

  if (!plugin.version) {
    warnings.push(`Missing export: version (defaults to "0.0.0")`);
  } else if (!/^\d+\.\d+\.\d+/.test(plugin.version)) {
    errors.push(`Invalid version format: "${plugin.version}" (expected semver)`);
  }

  if (typeof plugin.register !== "function") {
    errors.push(`Missing or invalid export: register (must be a function)`);
  }

  // Validate endpoints if provided
  if (plugin.endpoints) {
    if (!Array.isArray(plugin.endpoints)) {
      errors.push(`Invalid endpoints: must be an array`);
    } else {
      for (const endpoint of plugin.endpoints) {
        const endpointErrors = validateEndpoint(endpoint);
        errors.push(...endpointErrors.map(e => `Endpoint "${endpoint.path || 'unknown'}": ${e}`));
      }
    }
  }

  // Validate tools if provided
  if (plugin.tools) {
    if (!Array.isArray(plugin.tools)) {
      errors.push(`Invalid tools: must be an array`);
    } else {
      for (const tool of plugin.tools) {
        const toolErrors = validateTool(tool);
        errors.push(...toolErrors.map(e => `Tool "${tool.name || 'unknown'}": ${e}`));
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate endpoint definition
 */
function validateEndpoint(endpoint) {
  const errors = [];

  if (!endpoint.path) {
    errors.push("Missing path");
  } else if (typeof endpoint.path !== "string") {
    errors.push("Path must be a string");
  }

  if (!endpoint.method) {
    errors.push("Missing method");
  } else if (!["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(endpoint.method)) {
    errors.push(`Invalid method: "${endpoint.method}"`);
  }

  if (endpoint.scope && !["read", "write", "admin"].includes(endpoint.scope)) {
    errors.push(`Invalid scope: "${endpoint.scope}" (must be read|write|admin)`);
  }

  return errors;
}

/**
 * Validate tool definition
 */
function validateTool(tool) {
  const errors = [];

  if (!tool.name) {
    errors.push("Missing name");
  } else if (typeof tool.name !== "string") {
    errors.push("Name must be a string");
  }

  if (!tool.description) {
    errors.push(`Missing description`);
  }

  if (!tool.handler || typeof tool.handler !== "function") {
    errors.push(`Missing or invalid handler (must be a function)`);
  }

  if (tool.inputSchema) {
    const schemaErrors = validateJsonSchema(tool.inputSchema);
    errors.push(...schemaErrors.map(e => `inputSchema: ${e}`));
  }

  return errors;
}

/**
 * Basic JSON Schema validation
 */
function validateJsonSchema(schema) {
  const errors = [];

  if (!schema || typeof schema !== "object") {
    errors.push("Schema must be an object");
    return errors;
  }

  if (!schema.type) {
    errors.push("Missing type (should be 'object')");
  } else if (schema.type !== "object") {
    errors.push(`Invalid type: "${schema.type}" (should be 'object')`);
  }

  if (schema.properties && typeof schema.properties !== "object") {
    errors.push("properties must be an object");
  }

  if (schema.required && !Array.isArray(schema.required)) {
    errors.push("required must be an array");
  }

  return errors;
}

/**
 * Generate contract tests for a plugin
 * @param {string} pluginName - Name of the plugin
 * @param {Object} plugin - The plugin module
 * @returns {string} Test file content
 */
export function generateContractTests(pluginName, plugin) {
  const tests = [];

  // Generate endpoint tests
  if (plugin.endpoints) {
    for (const endpoint of plugin.endpoints) {
      tests.push(`
  describe("${endpoint.method} ${endpoint.path}", () => {
    it("should have valid endpoint definition", () => {
      expect(endpoint.path).toBeDefined();
      expect(endpoint.method).toBeDefined();
      expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(endpoint.method);
    });

    it("should respond with correct content type", async () => {
      // TODO: Implement endpoint contract test
      // const response = await request(app).${endpoint.method.toLowerCase()}("${endpoint.path}");
      // expect(response.headers["content-type"]).toMatch(/json/);
    });
  });`);
    }
  }

  // Generate tool tests
  if (plugin.tools) {
    for (const tool of plugin.tools) {
      tests.push(`
  describe("tool: ${tool.name}", () => {
    it("should have valid tool definition", () => {
      expect(tool.name).toBe("${tool.name}");
      expect(tool.description).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    });

    it("should return standardized response format", async () => {
      // TODO: Implement tool contract test
      // const result = await tool.handler({ /* valid args */ });
      // expect(result).toHaveProperty("ok");
    });
  });`);
    }
  }

  return `import { describe, it, expect } from "vitest";
import * as plugin from "../src/plugins/${pluginName}/index.js";

describe("${pluginName} - Contract Tests", () => {${tests.join("")}
});`;
}

/**
 * Validate plugin meta.json against schema
 */
export function validateMetaFile(meta, pluginName) {
  const errors = [];
  const warnings = [];

  const requiredFields = ["name", "version", "status", "owner"];
  for (const field of requiredFields) {
    if (!meta[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (meta.name && meta.name !== pluginName) {
    errors.push(`Name mismatch: meta "${meta.name}" vs folder "${pluginName}"`);
  }

  if (meta.version && !/^\d+\.\d+\.\d+/.test(meta.version)) {
    errors.push(`Invalid version format: ${meta.version}`);
  }

  if (meta.status && !["stable", "beta", "experimental"].includes(meta.status)) {
    errors.push(`Invalid status: ${meta.status}`);
  }

  if (meta.testLevel && !["none", "unit", "integration", "e2e"].includes(meta.testLevel)) {
    errors.push(`Invalid testLevel: ${meta.testLevel}`);
  }

  // Warnings for stable plugins
  if (meta.status === "stable") {
    if (meta.testLevel === "none") {
      warnings.push("Stable plugin should have testLevel >= unit");
    }
    if (!meta.resilience?.retry) {
      warnings.push("Stable plugin should implement retry logic");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
