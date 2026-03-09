/**
 * Core Plugin Infrastructure
 *
 * Centralized plugin management system providing:
 * - Metadata standard
 * - Status/maturity tracking
 * - Contract validation
 * - Discovery and loading
 *
 * @module core/plugins
 */

// Status and maturity
export {
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

// Metadata
export {
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

// Contract
export {
  REQUIRED_PLUGIN_EXPORTS,
  OPTIONAL_PLUGIN_EXPORTS,
  ALL_PLUGIN_EXPORTS,
  PLUGIN_CONTRACT_SCHEMA,
  REGISTRATION_CONTEXT_SCHEMA,
  validatePluginContract,
  hasPluginExport,
  getPluginCapabilitiesFromExports,
  wrapPluginRegistration,
  PLUGIN_LOADER_INTERFACE,
  PLUGIN_DISCOVERY_INTERFACE,
  createPluginStub,
  PLUGIN_CONTRACT_VERSION,
  isCompatibleContractVersion,
} from "./plugin.contract.js";

// Validation
export {
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
