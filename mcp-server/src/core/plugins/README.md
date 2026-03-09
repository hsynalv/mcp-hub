# Core Plugin Infrastructure

Centralized plugin management system providing standardized metadata, status tracking, contract validation, and discovery mechanisms.

## Overview

The plugin infrastructure ensures all plugins follow a consistent structure, enabling:
- **Plugin Discovery** - Find and list available plugins
- **Maturity Tracking** - Monitor plugin status and production readiness
- **Contract Validation** - Verify plugins implement required exports
- **Documentation Sync** - Keep docs aligned with plugin metadata

## Architecture

```
src/core/plugins/
├── plugin.status.js       # Status/maturity enum and helpers
├── plugin.metadata.js     # Metadata standard and utilities
├── plugin.contract.js     # Contract validation
├── plugin.validation.js   # Validation layer
├── index.js               # Main exports
└── plugins.test.js        # Test suite
```

## Quick Start

### Creating Plugin Metadata

```javascript
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

export const metadata = createMetadata({
  name: "my-plugin",
  version: "1.0.0",
  description: "My awesome plugin",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "custom"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: false,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "my-team",
  tags: ["feature", "utility"],
  since: "1.0.0",
});
```

### Status Levels

| Status | Emoji | Production Ready | Description |
|--------|-------|------------------|-------------|
| `experimental` | 🔬 | No | Early development, unstable |
| `beta` | 🧪 | No | Functional, testing phase |
| `stable` | ✅ | Yes | Production ready |
| `deprecated` | ⚠️ | No | No longer recommended |
| `sunset` | 🌅 | No | Removed from platform |

### Risk Levels

| Level | Use Case |
|-------|----------|
| `low` | Read-only operations |
| `medium` | Standard read/write |
| `high` | Data modification, secrets |
| `critical` | Shell execution, system access |

## Required Plugin Exports

Every plugin must export:

```javascript
// Required
export const metadata = createMetadata({...});
export function register(app) { ... }

// Optional but recommended
export const tools = [...];           // MCP tools
export const health = () => {...};    // Health check
export const endpoints = [...];       // API endpoints
export const cleanup = () => {...};   // Cleanup on shutdown
```

## Validation

### Validate Single Plugin

```javascript
import { validatePlugin } from "../../core/plugins/index.js";

const result = validatePlugin(pluginExports);
if (!result.valid) {
  console.error("Validation errors:", result.errors);
}
```

### Validate for Environment

```javascript
import { validateForEnvironment } from "../../core/plugins/index.js";

// CI - strict validation
const ciResult = validateForEnvironment(plugin, "ci");

// Development - lenient
const devResult = validateForEnvironment(plugin, "development");

// Production - strict
const prodResult = validateForEnvironment(plugin, "production");
```

### Batch Validation

```javascript
import { validateMultiplePlugins } from "../../core/plugins/index.js";

const plugins = [
  { name: "plugin-a", exports: pluginA },
  { name: "plugin-b", exports: pluginB },
];

const result = validateMultiplePlugins(plugins);
console.log(`Valid: ${result.summary.valid}/${result.summary.total}`);
```

## Metadata Utilities

### Check Capabilities

```javascript
import { hasCapability, addCapability } from "../../core/plugins/index.js";

// Check
if (hasCapability(metadata, "write")) {
  // Allow write operations
}

// Add
addCapability(metadata, "new-feature");
```

### Check Scopes

```javascript
import { hasScope, addScope } from "../../core/plugins/index.js";

// Check
if (hasScope(metadata, "admin")) {
  // Allow admin operations
}

// Add
addScope(metadata, "write");
```

### Format for Documentation

```javascript
import { formatMetadataForDocs } from "../../core/plugins/index.js";

const docs = formatMetadataForDocs(metadata);
// Returns markdown-formatted documentation
```

### Compare Versions

```javascript
import { diffMetadata } from "../../core/plugins/index.js";

const diff = diffMetadata(currentVersion, previousVersion);
if (diff.changed) {
  console.log("Changes:", diff.changes);
}
```

## Production Readiness

### Criteria

A plugin is production-ready when:
- Status is `stable`
- `hasTests: true`
- `hasDocs: true`
- `supportsAudit: true`
- `supportsPolicy: true` (if applicable)
- Not deprecated or sunset

### Check Programmatically

```javascript
import { validateProductionReadiness } from "../../core/plugins/index.js";

const { ready, reasons } = validateProductionReadiness(metadata);
if (!ready) {
  console.log("Not production ready:", reasons);
}
```

## Maturity Matrix Sync

Plugins should maintain consistency between their metadata and the [Plugin Maturity Matrix](../../docs/plugin-maturity-matrix.md).

| Metadata Field | Matrix Column |
|----------------|---------------|
| `status` | Status |
| `productionReady` | Auth (implies) |
| `hasTests` | Tests |
| `hasDocs` | Docs |

## Migration Guide

### Adding Metadata to Existing Plugin

1. Import the metadata utilities:
```javascript
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
```

2. Define metadata after imports:
```javascript
export const metadata = createMetadata({
  name: "your-plugin-name",
  version: "1.0.0",
  description: "Clear description of what your plugin does",
  status: PluginStatus.BETA, // or STABLE, EXPERIMENTAL
  productionReady: false,
  scopes: ["read"], // adjust based on plugin capabilities
  capabilities: ["read", "custom-feature"],
  requiresAuth: true,
  supportsAudit: false,
  supportsPolicy: false,
  hasTests: false,
  hasDocs: true,
  riskLevel: RiskLevel.LOW,
});
```

3. Ensure `register` function is exported:
```javascript
export function register(app) {
  // Your plugin registration logic
}
```

4. Update the maturity matrix to match

## Best Practices

1. **Start with accurate status** - Don't mark `stable` until truly production-ready
2. **Set correct risk level** - Use `inferRiskLevel()` to auto-detect from capabilities
3. **Keep metadata updated** - Update version, status, and flags as plugin evolves
4. **Use validation in CI** - Run `validateForEnvironment(plugin, "ci")` in pipelines
5. **Document capabilities** - List all capabilities in metadata for discoverability

## API Reference

See individual module files for detailed JSDoc documentation:
- `plugin.status.js` - Status enum and helpers
- `plugin.metadata.js` - Metadata creation and utilities
- `plugin.contract.js` - Contract validation
- `plugin.validation.js` - Validation framework

## Testing

Run plugin system tests:

```bash
npm test src/core/plugins/plugins.test.js
```

The test suite covers:
- Status/maturity validation
- Metadata creation and utilities
- Contract validation
- Production readiness checks
- Batch validation
