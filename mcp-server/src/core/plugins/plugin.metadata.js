/**
 * Plugin Metadata Standard
 *
 * Defines the common metadata structure that all plugins must follow.
 * This enables consistent plugin discovery, documentation, and governance.
 */

import { PluginStatus, RiskLevel } from "./plugin.status.js";

/**
 * Required metadata fields for all plugins
 */
export const REQUIRED_METADATA_FIELDS = [
  "name",
  "version",
  "description",
  "status",
];

/**
 * Optional but recommended metadata fields
 */
export const RECOMMENDED_METADATA_FIELDS = [
  "productionReady",
  "scopes",
  "capabilities",
  "requiresAuth",
  "supportsAudit",
  "supportsPolicy",
  "supportsWorkspaceIsolation",
  "hasTests",
  "hasDocs",
  "owner",
  "tags",
  "riskLevel",
  "dependencies",
  "backends",
  "providers",
  "notes",
  "repository",
  "documentationUrl",
  "testCoverage",
  "since",
];

/**
 * All valid metadata fields
 */
export const ALL_METADATA_FIELDS = [
  ...REQUIRED_METADATA_FIELDS,
  ...RECOMMENDED_METADATA_FIELDS,
];

/**
 * Valid scope values
 */
export const VALID_SCOPES = ["read", "write", "admin"];

/**
 * Common capability values
 */
export const COMMON_CAPABILITIES = [
  "read",
  "write",
  "delete",
  "execute",
  "shell",
  "database",
  "file",
  "secret",
  "llm",
  "rag",
  "http",
  "cache",
  "queue",
  "event",
];

/**
 * Default metadata values
 */
export const DEFAULT_METADATA = {
  status: PluginStatus.EXPERIMENTAL,
  productionReady: false,
  scopes: ["read"],
  capabilities: [],
  requiresAuth: true,
  supportsAudit: false,
  supportsPolicy: false,
  supportsWorkspaceIsolation: false,
  hasTests: false,
  hasDocs: false,
  owner: null,
  tags: [],
  riskLevel: RiskLevel.LOW,
  dependencies: [],
  backends: [],
  providers: [],
  notes: "",
  testCoverage: 0,
};

/**
 * Create a plugin metadata object with defaults applied
 * @param {Object} overrides - Metadata overrides
 * @returns {Object} Complete metadata object
 */
export function createMetadata(overrides = {}) {
  return {
    ...DEFAULT_METADATA,
    ...overrides,
    // Ensure arrays are properly initialized
    scopes: overrides.scopes || DEFAULT_METADATA.scopes,
    capabilities: overrides.capabilities || DEFAULT_METADATA.capabilities,
    tags: overrides.tags || DEFAULT_METADATA.tags,
    dependencies: overrides.dependencies || DEFAULT_METADATA.dependencies,
    backends: overrides.backends || DEFAULT_METADATA.backends,
    providers: overrides.providers || DEFAULT_METADATA.providers,
  };
}

/**
 * Plugin metadata schema for validation
 * Each field has type and validation rules
 */
export const METADATA_SCHEMA = {
  name: {
    type: "string",
    required: true,
    pattern: /^[a-z0-9-]+$/,
    description: "Plugin identifier (kebab-case)",
  },
  version: {
    type: "string",
    required: true,
    pattern: /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/,
    description: "Semantic version (semver)",
  },
  description: {
    type: "string",
    required: true,
    minLength: 10,
    maxLength: 500,
    description: "Human-readable description",
  },
  status: {
    type: "string",
    required: true,
    enum: Object.values(PluginStatus),
    description: "Maturity status",
  },
  productionReady: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin is production-ready",
  },
  scopes: {
    type: "array",
    required: false,
    items: { type: "string", enum: VALID_SCOPES },
    default: ["read"],
    description: "Required permission scopes",
  },
  capabilities: {
    type: "array",
    required: false,
    items: { type: "string" },
    default: [],
    description: "Plugin capabilities",
  },
  requiresAuth: {
    type: "boolean",
    required: false,
    default: true,
    description: "Whether authentication is required",
  },
  supportsAudit: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin supports audit logging",
  },
  supportsPolicy: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin integrates with policy system",
  },
  supportsWorkspaceIsolation: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin supports workspace isolation",
  },
  hasTests: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin has tests",
  },
  hasDocs: {
    type: "boolean",
    required: false,
    default: false,
    description: "Whether plugin has documentation",
  },
  owner: {
    type: "string",
    required: false,
    description: "Plugin owner/team",
  },
  tags: {
    type: "array",
    required: false,
    items: { type: "string" },
    default: [],
    description: "Categorization tags",
  },
  riskLevel: {
    type: "string",
    required: false,
    enum: Object.values(RiskLevel),
    default: RiskLevel.LOW,
    description: "Risk level",
  },
  dependencies: {
    type: "array",
    required: false,
    items: { type: "string" },
    default: [],
    description: "Plugin dependencies",
  },
  backends: {
    type: "array",
    required: false,
    items: { type: "string" },
    default: [],
    description: "Supported backends (e.g., 'redis', 'postgres')",
  },
  providers: {
    type: "array",
    required: false,
    items: { type: "string" },
    default: [],
    description: "Supported providers (e.g., 'openai', 'aws')",
  },
  notes: {
    type: "string",
    required: false,
    default: "",
    description: "Additional notes",
  },
  repository: {
    type: "string",
    required: false,
    description: "Repository URL",
  },
  documentationUrl: {
    type: "string",
    required: false,
    description: "Documentation URL",
  },
  testCoverage: {
    type: "number",
    required: false,
    min: 0,
    max: 100,
    default: 0,
    description: "Test coverage percentage",
  },
  since: {
    type: "string",
    required: false,
    description: "Version when plugin was added",
  },
};

/**
 * Check if metadata has a specific capability
 * @param {Object} metadata
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(metadata, capability) {
  return metadata.capabilities?.includes(capability) || false;
}

/**
 * Check if metadata has a specific scope
 * @param {Object} metadata
 * @param {string} scope
 * @returns {boolean}
 */
export function hasScope(metadata, scope) {
  return metadata.scopes?.includes(scope) || false;
}

/**
 * Check if metadata has a specific tag
 * @param {Object} metadata
 * @param {string} tag
 * @returns {boolean}
 */
export function hasTag(metadata, tag) {
  return metadata.tags?.includes(tag) || false;
}

/**
 * Add a capability to metadata
 * @param {Object} metadata
 * @param {string} capability
 * @returns {Object} Updated metadata
 */
export function addCapability(metadata, capability) {
  if (!metadata.capabilities) {
    metadata.capabilities = [];
  }
  if (!metadata.capabilities.includes(capability)) {
    metadata.capabilities.push(capability);
  }
  return metadata;
}

/**
 * Add a scope to metadata
 * @param {Object} metadata
 * @param {string} scope
 * @returns {Object} Updated metadata
 */
export function addScope(metadata, scope) {
  if (!metadata.scopes) {
    metadata.scopes = [];
  }
  if (!metadata.scopes.includes(scope)) {
    metadata.scopes.push(scope);
  }
  return metadata;
}

/**
 * Add a tag to metadata
 * @param {Object} metadata
 * @param {string} tag
 * @returns {Object} Updated metadata
 */
export function addTag(metadata, tag) {
  if (!metadata.tags) {
    metadata.tags = [];
  }
  if (!metadata.tags.includes(tag)) {
    metadata.tags.push(tag);
  }
  return metadata;
}

/**
 * Get metadata summary for display/logging
 * @param {Object} metadata
 * @returns {Object} Summarized metadata
 */
export function getMetadataSummary(metadata) {
  return {
    name: metadata.name,
    version: metadata.version,
    status: metadata.status,
    productionReady: metadata.productionReady,
    scopes: metadata.scopes,
    capabilities: metadata.capabilities?.slice(0, 5), // Limit to first 5
    riskLevel: metadata.riskLevel,
  };
}

/**
 * Format metadata for documentation
 * @param {Object} metadata
 * @returns {string} Markdown formatted
 */
export function formatMetadataForDocs(metadata) {
  const lines = [
    `## ${metadata.name}`,
    "",
    `- **Version**: ${metadata.version}`,
    `- **Status**: ${metadata.status}`,
    `- **Production Ready**: ${metadata.productionReady ? "Yes" : "No"}`,
    `- **Risk Level**: ${metadata.riskLevel}`,
    "",
    metadata.description,
    "",
  ];

  if (metadata.capabilities?.length > 0) {
    lines.push("### Capabilities");
    lines.push("");
    for (const cap of metadata.capabilities) {
      lines.push(`- ${cap}`);
    }
    lines.push("");
  }

  if (metadata.scopes?.length > 0) {
    lines.push("### Required Scopes");
    lines.push("");
    for (const scope of metadata.scopes) {
      lines.push(`- ${scope}`);
    }
    lines.push("");
  }

  if (metadata.tags?.length > 0) {
    lines.push("### Tags");
    lines.push("");
    lines.push(metadata.tags.join(", "));
    lines.push("");
  }

  if (metadata.notes) {
    lines.push("### Notes");
    lines.push("");
    lines.push(metadata.notes);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Compare two metadata versions
 * @param {Object} current - Current metadata
 * @param {Object} previous - Previous metadata
 * @returns {{changed: boolean, changes: string[]}}
 */
export function diffMetadata(current, previous) {
  const changes = [];

  // Check version
  if (current.version !== previous.version) {
    changes.push(`version: ${previous.version} -> ${current.version}`);
  }

  // Check status
  if (current.status !== previous.status) {
    changes.push(`status: ${previous.status} -> ${current.status}`);
  }

  // Check productionReady
  if (current.productionReady !== previous.productionReady) {
    changes.push(`productionReady: ${previous.productionReady} -> ${current.productionReady}`);
  }

  // Check capabilities (added)
  const addedCaps = current.capabilities?.filter(
    c => !previous.capabilities?.includes(c)
  ) || [];
  if (addedCaps.length > 0) {
    changes.push(`added capabilities: ${addedCaps.join(", ")}`);
  }

  // Check capabilities (removed)
  const removedCaps = previous.capabilities?.filter(
    c => !current.capabilities?.includes(c)
  ) || [];
  if (removedCaps.length > 0) {
    changes.push(`removed capabilities: ${removedCaps.join(", ")}`);
  }

  return {
    changed: changes.length > 0,
    changes,
  };
}
