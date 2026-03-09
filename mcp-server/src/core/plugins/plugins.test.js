/**
 * Plugin System Tests
 *
 * Tests for the core plugin infrastructure including metadata, status, contract, and validation.
 */

import { describe, it, expect } from "vitest";
import {
  PluginStatus,
  VALID_STATUSES,
  isValidStatus,
  getProductionReadyStatuses,
  isProductionReadyStatus,
  getStatusDisplayName,
  getStatusEmoji,
  STATUS_TRANSITIONS,
  isValidStatusTransition,
  PRODUCTION_READY_CRITERIA,
  validateProductionReadiness,
  RiskLevel,
  inferRiskLevel,
  STATUS_METADATA,
} from "./plugin.status.js";
import {
  REQUIRED_METADATA_FIELDS,
  RECOMMENDED_METADATA_FIELDS,
  ALL_METADATA_FIELDS,
  VALID_SCOPES,
  COMMON_CAPABILITIES,
  DEFAULT_METADATA,
  createMetadata,
  METADATA_SCHEMA,
  hasCapability,
  hasScope,
  hasTag,
  addCapability,
  addScope,
  addTag,
  getMetadataSummary,
  formatMetadataForDocs,
  diffMetadata,
} from "./plugin.metadata.js";
import {
  REQUIRED_PLUGIN_EXPORTS,
  OPTIONAL_PLUGIN_EXPORTS,
  ALL_PLUGIN_EXPORTS,
  PLUGIN_CONTRACT_SCHEMA,
  validatePluginContract,
  hasPluginExport,
  getPluginCapabilitiesFromExports,
  createPluginStub,
  PLUGIN_CONTRACT_VERSION,
  isCompatibleContractVersion,
} from "./plugin.contract.js";
import {
  ValidationSeverity,
  validateMetadata,
  isValidMetadata,
  validatePlugin,
  validateMultiplePlugins,
  createValidationReporter,
  VALIDATION_CONFIGS,
  getValidationConfig,
  validateForEnvironment,
  assertValidPlugin,
  checkCompatibility,
} from "./plugin.validation.js";

describe("Plugin System", () => {
  describe("PluginStatus", () => {
    it("should have correct status values", () => {
      expect(PluginStatus.EXPERIMENTAL).toBe("experimental");
      expect(PluginStatus.BETA).toBe("beta");
      expect(PluginStatus.STABLE).toBe("stable");
      expect(PluginStatus.DEPRECATED).toBe("deprecated");
      expect(PluginStatus.SUNSET).toBe("sunset");
    });

    it("should validate status correctly", () => {
      expect(isValidStatus("stable")).toBe(true);
      expect(isValidStatus("experimental")).toBe(true);
      expect(isValidStatus("invalid")).toBe(false);
    });

    it("should identify production-ready statuses", () => {
      expect(isProductionReadyStatus("stable")).toBe(true);
      expect(isProductionReadyStatus("beta")).toBe(false);
      expect(isProductionReadyStatus("experimental")).toBe(false);
    });

    it("should provide display names", () => {
      expect(getStatusDisplayName("stable")).toBe("Stable");
      expect(getStatusDisplayName("experimental")).toBe("Experimental");
    });

    it("should provide emojis", () => {
      expect(getStatusEmoji("stable")).toBe("✅");
      expect(getStatusEmoji("experimental")).toBe("🔬");
    });

    it("should validate status transitions", () => {
      expect(isValidStatusTransition("experimental", "beta")).toBe(true);
      expect(isValidStatusTransition("experimental", "stable")).toBe(false);
      expect(isValidStatusTransition("beta", "stable")).toBe(true);
      expect(isValidStatusTransition("stable", "deprecated")).toBe(true);
      expect(isValidStatusTransition("deprecated", "sunset")).toBe(true);
    });

    it("should validate production readiness", () => {
      const valid = {
        status: PluginStatus.STABLE,
        hasTests: true,
        hasDocs: true,
        supportsAudit: true,
        supportsPolicy: true,
      };
      expect(validateProductionReadiness(valid).ready).toBe(true);

      const invalid = {
        status: PluginStatus.EXPERIMENTAL,
        hasTests: false,
      };
      expect(validateProductionReadiness(invalid).ready).toBe(false);
    });
  });

  describe("RiskLevel", () => {
    it("should have correct risk levels", () => {
      expect(RiskLevel.LOW).toBe("low");
      expect(RiskLevel.MEDIUM).toBe("medium");
      expect(RiskLevel.HIGH).toBe("high");
      expect(RiskLevel.CRITICAL).toBe("critical");
    });

    it("should infer risk level from capabilities", () => {
      expect(inferRiskLevel({ capabilities: ["execute", "shell"] })).toBe(RiskLevel.CRITICAL);
      expect(inferRiskLevel({ capabilities: ["write", "delete"] })).toBe(RiskLevel.HIGH);
      expect(inferRiskLevel({ capabilities: ["read"] })).toBe(RiskLevel.MEDIUM);
      expect(inferRiskLevel({ capabilities: [] })).toBe(RiskLevel.LOW);
    });
  });

  describe("createMetadata", () => {
    it("should create metadata with defaults", () => {
      const meta = createMetadata({
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin",
        status: PluginStatus.BETA,
      });

      expect(meta.name).toBe("test-plugin");
      expect(meta.version).toBe("1.0.0");
      expect(meta.description).toBe("Test plugin");
      expect(meta.status).toBe(PluginStatus.BETA);
      expect(meta.productionReady).toBe(false);
      expect(meta.scopes).toEqual(["read"]);
      expect(meta.capabilities).toEqual([]);
      expect(meta.riskLevel).toBe(RiskLevel.LOW);
    });

    it("should override defaults with provided values", () => {
      const meta = createMetadata({
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin",
        status: PluginStatus.STABLE,
        productionReady: true,
        scopes: ["read", "write"],
        capabilities: ["read", "write"],
        riskLevel: RiskLevel.HIGH,
      });

      expect(meta.productionReady).toBe(true);
      expect(meta.scopes).toEqual(["read", "write"]);
      expect(meta.capabilities).toEqual(["read", "write"]);
      expect(meta.riskLevel).toBe(RiskLevel.HIGH);
    });
  });

  describe("metadata helpers", () => {
    it("should check capabilities", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        capabilities: ["read", "write"],
      });

      expect(hasCapability(meta, "read")).toBe(true);
      expect(hasCapability(meta, "execute")).toBe(false);
    });

    it("should check scopes", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        scopes: ["read", "admin"],
      });

      expect(hasScope(meta, "read")).toBe(true);
      expect(hasScope(meta, "write")).toBe(false);
    });

    it("should check tags", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        tags: ["security", "important"],
      });

      expect(hasTag(meta, "security")).toBe(true);
      expect(hasTag(meta, "unused")).toBe(false);
    });

    it("should add capabilities", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
      });

      addCapability(meta, "new-cap");
      expect(hasCapability(meta, "new-cap")).toBe(true);
    });

    it("should add scopes", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
      });

      addScope(meta, "admin");
      expect(hasScope(meta, "admin")).toBe(true);
    });

    it("should add tags", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
      });

      addTag(meta, "tag1");
      expect(hasTag(meta, "tag1")).toBe(true);
    });

    it("should generate metadata summary", () => {
      const meta = createMetadata({
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin",
        status: PluginStatus.STABLE,
        productionReady: true,
        scopes: ["read"],
        capabilities: ["read", "write"],
      });

      const summary = getMetadataSummary(meta);
      expect(summary.name).toBe("test-plugin");
      expect(summary.status).toBe(PluginStatus.STABLE);
      expect(summary.productionReady).toBe(true);
    });

    it("should format metadata for docs", () => {
      const meta = createMetadata({
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin description",
        capabilities: ["read", "write"],
      });

      const docs = formatMetadataForDocs(meta);
      expect(docs).toContain("## test-plugin");
      expect(docs).toContain("Test plugin description");
    });

    it("should diff metadata versions", () => {
      const current = createMetadata({
        name: "test",
        version: "1.1.0",
        description: "Test",
        status: PluginStatus.STABLE,
        capabilities: ["read", "write", "new"],
      });

      const previous = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.BETA,
        capabilities: ["read", "write"],
      });

      const diff = diffMetadata(current, previous);
      expect(diff.changed).toBe(true);
      expect(diff.changes).toContain("version: 1.0.0 -> 1.1.0");
      expect(diff.changes).toContain("status: beta -> stable");
      expect(diff.changes).toContain("added capabilities: new");
    });
  });

  describe("validateMetadata", () => {
    it("should validate valid metadata", () => {
      const meta = createMetadata({
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin description",
        status: PluginStatus.STABLE,
      });

      const result = validateMetadata(meta, { checkRecommended: false });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject missing required fields", () => {
      const meta = {};

      const result = validateMetadata(meta, { checkRecommended: false });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should detect invalid version format", () => {
      const meta = {
        name: "test",
        version: "invalid-version",
        description: "Test plugin",
        status: PluginStatus.BETA,
      };

      const result = validateMetadata(meta);
      expect(result.valid).toBe(false);
    });

    it("should warn about experimental plugins marked productionReady", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.EXPERIMENTAL,
        productionReady: true,
      });

      const result = validateMetadata(meta);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should warn stable plugins without tests", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.STABLE,
        hasTests: false,
      });

      const result = validateMetadata(meta);
      expect(result.warnings.some(w => w.includes("tests"))).toBe(true);
    });
  });

  describe("validatePluginContract", () => {
    it("should validate correct plugin exports", () => {
      const plugin = {
        metadata: { name: "test", version: "1.0.0" },
        register: () => {},
      };

      const result = validatePluginContract(plugin);
      expect(result.valid).toBe(true);
    });

    it("should reject missing required exports", () => {
      const plugin = {
        metadata: { name: "test" },
      };

      const result = validatePluginContract(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required export: register");
    });

    it("should reject wrong export types", () => {
      const plugin = {
        metadata: "not an object",
        register: () => {},
      };

      const result = validatePluginContract(plugin);
      expect(result.valid).toBe(false);
    });
  });

  describe("createPluginStub", () => {
    it("should create valid plugin stub", () => {
      const stub = createPluginStub();
      expect(stub.metadata).toBeDefined();
      expect(stub.register).toBeDefined();

      const validation = validatePlugin(stub);
      expect(validation.valid).toBe(true);
    });

    it("should allow overriding properties", () => {
      const stub = createPluginStub({
        metadata: { name: "custom" },
        tools: [],
      });

      expect(stub.metadata.name).toBe("custom");
      expect(stub.tools).toBeDefined();
    });
  });

  describe("validateMultiplePlugins", () => {
    it("should validate multiple plugins", () => {
      const plugins = [
        { name: "valid", exports: createPluginStub() },
        { name: "invalid", exports: {} },
      ];

      const result = validateMultiplePlugins(plugins);
      expect(result.valid).toBe(false);
      expect(result.summary.total).toBe(2);
      expect(result.summary.valid).toBe(1);
      expect(result.summary.errors).toBe(1);
    });
  });

  describe("createValidationReporter", () => {
    it("should format validation results", () => {
      const result = {
        valid: false,
        errors: ["Error 1", "Error 2"],
        warnings: ["Warning 1"],
        info: ["Info 1"],
      };

      const reporter = createValidationReporter(result);
      const output = reporter.toString();

      expect(output).toContain("Validation Result: ❌ INVALID");
      expect(output).toContain("Error 1");
      expect(output).toContain("Warning 1");
      expect(reporter.exitCode).toBe(1);
    });

    it("should format as markdown", () => {
      const result = {
        valid: false,
        errors: ["Error 1"],
        warnings: ["Warning 1"],
      };

      const reporter = createValidationReporter(result);
      const output = reporter.toMarkdown();

      expect(output).toContain("### Errors");
      expect(output).toContain("### Warnings");
    });
  });

  describe("checkCompatibility", () => {
    it("should approve compatible plugins", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.STABLE,
      });

      const result = checkCompatibility(meta, "1.0.0");
      expect(result.compatible).toBe(true);
    });

    it("should reject deprecated plugins", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.DEPRECATED,
      });

      const result = checkCompatibility(meta);
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain("deprecated");
    });

    it("should reject sunset plugins", () => {
      const meta = createMetadata({
        name: "test",
        version: "1.0.0",
        description: "Test",
        status: PluginStatus.SUNSET,
      });

      const result = checkCompatibility(meta);
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain("sunset");
    });
  });

  describe("contract version", () => {
    it("should have valid contract version", () => {
      expect(PLUGIN_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should check version compatibility", () => {
      expect(isCompatibleContractVersion("1.0.0")).toBe(true);
      expect(isCompatibleContractVersion("1.1.0")).toBe(true);
      expect(isCompatibleContractVersion("2.0.0")).toBe(false);
    });
  });

  describe("validation configs", () => {
    it("should have validation configs for all environments", () => {
      expect(VALIDATION_CONFIGS.ci).toBeDefined();
      expect(VALIDATION_CONFIGS.development).toBeDefined();
      expect(VALIDATION_CONFIGS.startup).toBeDefined();
      expect(VALIDATION_CONFIGS.production).toBeDefined();
    });

    it("should get config for environment", () => {
      const config = getValidationConfig("ci");
      expect(config.strict).toBe(true);
      expect(config.checkRecommended).toBe(true);
    });

    it("should use development config as default", () => {
      const config = getValidationConfig("unknown");
      expect(config).toEqual(VALIDATION_CONFIGS.development);
    });
  });
});
