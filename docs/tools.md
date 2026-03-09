# Tool Discovery API

Central tool discovery system for MCP-Hub platform.

## Overview

The Tool Discovery API provides:
- **Tool Discovery** - Discover tools from all enabled plugins
- **Schema Normalization** - Standardize tool schemas across plugins
- **Tool Validation** - Validate tool definitions
- **Tool Registry** - Cache and query tools efficiently
- **Formatted Responses** - Agent/UI-friendly tool presentations

## Architecture

```
src/core/tools/
├── tool.types.js          # Type definitions
├── tool.discovery.js      # Tool discovery from plugins
├── tool.schema.js          # Schema normalization
├── tool.validation.js      # Tool validation
├── tool.registry.js       # Tool registry & caching
├── tool.presenter.js       # Response formatting
├── index.js               # Main exports
└── tools.test.js          # Test suite
```

## Tool Data Model

```javascript
{
  name: "shell.execute",       // Fully qualified name
  plugin: "shell",              // Plugin name
  tool: "execute",              // Tool short name
  description: "Execute command",
  category: "execution",       // Category
  status: "stable",             // experimental | beta | stable | deprecated
  enabled: true,                // From plugin status
  scopes: ["write"],            // Required scopes
  capabilities: ["execute", "shell"],
  inputSchema: {                // JSON Schema for input
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"]
  },
  outputSchema: { type: "object", properties: {} },
  riskLevel: "critical",        // low | medium | high | critical
  productionReady: true,
  supportsAudit: true,
  supportsPolicy: true,
  tags: ["system", "dangerous"],
  backend: "local",
  examples: [{ input: {}, output: {} }],
  notes: "Additional notes"
}
```

## Quick Start

### Basic Usage

```javascript
import {
  discoverAllTools,
  getTool,
  getToolRegistry,
  formatTool
} from "./core/tools/index.js";

// Discover all tools from enabled plugins
const tools = await discoverAllTools();

// Get specific tool
const tool = await getTool("shell.execute");

// Use registry for caching
const registry = getToolRegistry();
await registry.init();
const tool = registry.get("shell.execute");
```

## API Reference

### Discovery Functions

```javascript
import {
  discoverAllTools,
  getTool,
  getToolsByPlugin,
  getToolsByScope,
  getToolsByCapability,
  getToolsByCategory,
  searchTools,
  getToolStats,
} from "./core/tools/index.js";

// Get all tools from enabled plugins
const allTools = await discoverAllTools();

// Get single tool by name
const tool = await getTool("plugin.tool");

// Get tools by plugin
const pluginTools = await getToolsByPlugin("shell");

// Get tools by scope
const writeTools = await getToolsByScope("write");

// Get tools by capability
const dbTools = await getToolsByCapability("database");

// Get tools by category
const aiTools = await getToolsByCategory("ai");

// Search tools
const results = await searchTools("index");

// Get statistics
const stats = await getToolStats();
```

### Tool Registry

```javascript
import {
  ToolRegistry,
  createToolRegistry,
  getToolRegistry,
  setToolRegistry
} from "./core/tools/index.js";

// Create or get global registry
const registry = getToolRegistry();

// Initialize (discover all tools)
await registry.init();

// Query tools
const all = registry.getAll();
const tool = registry.get("shell.execute");
const filtered = registry.filter({ plugin: "shell", enabledOnly: true });

// Filter by various criteria
const byPlugin = registry.getByPlugin("rag");
const byScope = registry.getByScope("admin");
const byCapability = registry.getByCapability("execute");

// Search
const results = registry.search("index");

// Get categories
const categories = registry.getCategories();

// Get statistics
const stats = registry.getStats();

// Refresh cache
await registry.refresh();
```

### Schema Normalization

```javascript
import {
  normalizeTool,
  normalizeSchema,
  extractToolName,
  generateExampleFromSchema,
} from "./core/tools/index.js";

// Normalize raw tool from plugin
const normalized = normalizeTool(
  { name: "execute", description: "Run command" },
  { name: "shell", enabled: true, metadata: {} }
);

// Normalize schema
const schema = normalizeSchema({
  fields: { path: { type: "string" } },
  requiredFields: ["path"]
});

// Generate example from schema
const example = generateExampleFromSchema(schema);
```

### Validation

```javascript
import {
  validateTool,
  isValidTool,
  assertValidTool,
  validateMultipleTools
} from "./core/tools/index.js";

// Validate single tool
const result = validateTool(tool);
console.log(result.valid);   // true/false
console.log(result.errors);  // Error list
console.log(result.warnings); // Warning list

// Strict validation (recommended fields required)
const strict = validateTool(tool, { strict: true });

// Simple check
if (isValidTool(tool)) {
  // Process tool
}

// Assert (throws if invalid)
assertValidTool(tool, "Tool is invalid");

// Validate multiple
const batch = validateMultipleTools(tools);
console.log(`${batch.valid}/${batch.total} valid`);
```

### Formatting/Presentation

```javascript
import {
  formatTool,
  formatTools,
  formatToolForAgent,
  formatToolForUI,
  formatToolList,
  formatToolNotFound
} from "./core/tools/index.js";

// Standard format
const formatted = formatTool(tool);

// Compact (no schemas, no optional fields)
const compact = formatTool(tool, { compact: true });

// Without schemas
const noSchema = formatTool(tool, { includeSchema: false });

// Filter specific fields
const filtered = formatTool(tool, { fields: ["name", "description"] });

// Format for agent/client (minimal)
const agentFormat = formatToolForAgent(tool);

// Format for UI (rich)
const uiFormat = formatToolForUI(tool);

// Format list
const list = formatToolList(tools, pagination, options);

// Format error
const error = formatToolNotFound("missing.tool");
```

## REST API Endpoints

### Setup

```javascript
import { Router } from "express";
import {
  getToolRegistry,
  formatTool,
  formatToolList,
  formatToolNotFound,
  createResponse
} from "./core/tools/index.js";

const router = Router();
const registry = getToolRegistry();
await registry.init();

// GET /tools
router.get("/tools", (req, res) => {
  const { plugin, scope, capability, category, compact } = req.query;

  let tools = registry.getAll();

  // Apply filters
  if (plugin) tools = tools.filter(t => t.plugin === plugin);
  if (scope) tools = tools.filter(t => t.scopes.includes(scope));
  if (capability) tools = tools.filter(t => t.capabilities.includes(capability));
  if (category) tools = tools.filter(t => t.category === category);

  const formatted = formatToolList(tools, null, { compact: compact === "true" });
  res.json(createResponse(formatted));
});

// GET /tools/:name
router.get("/tools/:name", (req, res) => {
  const tool = registry.get(req.params.name);

  if (!tool) {
    return res.status(404).json(formatToolNotFound(req.params.name));
  }

  res.json(createResponse({ tool: formatTool(tool) }));
});

// GET /tools/schema/:name
router.get("/tools/schema/:name", (req, res) => {
  const tool = registry.get(req.params.name);

  if (!tool) {
    return res.status(404).json(formatToolNotFound(req.params.name));
  }

  res.json(createResponse({
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema
  }));
});

// GET /tools/plugin/:plugin
router.get("/tools/plugin/:plugin", (req, res) => {
  const tools = registry.getByPlugin(req.params.plugin);
  res.json(createResponse(formatToolList(tools)));
});

// GET /tools/scopes/:scope
router.get("/tools/scopes/:scope", (req, res) => {
  const tools = registry.getByScope(req.params.scope);
  res.json(createResponse(formatToolList(tools)));
});

// GET /tools/capabilities/:capability
router.get("/tools/capabilities/:capability", (req, res) => {
  const tools = registry.getByCapability(req.params.capability);
  res.json(createResponse(formatToolList(tools)));
});

// GET /tools/stats
router.get("/tools/stats", (req, res) => {
  const stats = registry.getStats();
  res.json(createResponse({ stats }));
});
```

## Plugin Integration

### Plugin Tool Export

```javascript
// In plugin index.js
export const tools = [
  {
    name: "execute",
    description: "Execute shell command",
    scopes: ["write", "admin"],
    capabilities: ["execute", "shell"],
    category: "execution",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        timeout: { type: "number", default: 30000 }
      },
      required: ["command"]
    },
    outputSchema: {
      type: "object",
      properties: {
        stdout: { type: "string" },
        stderr: { type: "string" },
        exitCode: { type: "number" }
      }
    },
    examples: [
      { input: { command: "ls -la" }, output: { stdout: "...", exitCode: 0 } }
    ],
    tags: ["system", "dangerous"]
  }
];
```

### Discovery

Tools are automatically discovered from enabled plugins. Disabled plugin tools are excluded.

```javascript
// Tools from disabled plugins are not included
const tools = await discoverAllTools();
// Only returns tools from enabled plugins
```

### Manual Refresh

```javascript
// If plugin status changes, refresh registry
await registry.refresh();
```

## Schema Normalization

### Input Formats

The system accepts various schema formats and normalizes them:

```javascript
// Standard JSON Schema
{ type: "object", properties: {} }

// Plugin shorthand
{ fields: {}, requiredFields: [] }

// Simplified
{ input: {}, output: {}, parameters: {} }

// All normalized to:
{
  type: "object",
  description: "",
  properties: {},
  required: [],
  examples: null
}
```

## Validation Rules

### Required Fields
- `name` - Fully qualified tool name
- `plugin` - Plugin name

### Recommended Fields
- `description` - Tool description (10+ chars recommended)
- `scopes` - Required scopes array

### Status Values
- `experimental` - Early development
- `beta` - Testing phase
- `stable` - Production ready
- `deprecated` - No longer recommended

### Warnings
- Missing recommended fields
- Short description (< 10 chars)
- `productionReady: true` with `status: experimental`
- Invalid schema format

### Errors
- Missing required fields
- Invalid status value
- Non-array scopes/capabilities/tags
- Invalid schema object

## Testing

### Run Tests

```bash
npm test src/core/tools/tools.test.js
```

### Test Coverage

- Tool schema normalization
- Tool validation (valid/invalid cases)
- Tool registry operations
- Tool formatting/presentation
- Discovery from plugins
- Filtering and search

## Best Practices

1. **Always use fully qualified names** - `plugin.tool` format
2. **Provide descriptions** - Clear, 10+ characters
3. **Define schemas** - For input validation and agent understanding
4. **Set appropriate scopes** - Match required permissions
5. **Tag tools** - For better discoverability
6. **Set correct status** - Match actual maturity
7. **Use categories** - Group related tools
8. **Include examples** - Help agents understand usage

## Troubleshooting

### Tools Not Showing
- Check plugin is enabled
- Verify tool export in plugin
- Check `discoverAllTools()` filters

### Invalid Tool Errors
- Run `validateTool(tool)` to see issues
- Check required fields: `name`, `plugin`
- Verify name format: `plugin.tool`

### Schema Issues
- Use `normalizeSchema()` to see normalized form
- Check schema has valid `type` field
- Ensure `properties` is an object

## Future Enhancements

### Planned
- Persistent tool cache (Redis)
- Tool versioning
- Tool dependencies
- Tool ratings/usage stats
- Advanced search (fuzzy, semantic)

### Extension Points
- Custom tool providers
- Tool middleware/hooks
- Dynamic tool registration

---

For more details, see the test suite: `src/core/tools/tools.test.js`
