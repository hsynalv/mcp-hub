#!/usr/bin/env node

/**
 * Plugin CLI - Scaffold new plugins
 * 
 * Usage: npm run create-plugin <name>
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const pluginName = process.argv[2];

if (!pluginName) {
  console.error("Usage: npm run create-plugin <name>");
  process.exit(1);
}

const pluginDir = join("src", "plugins", pluginName);

// Create directory
mkdirSync(pluginDir, { recursive: true });

// index.js template
const indexTemplate = `import { ToolTags } from "../../core/tool-registry.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";

const pluginError = createPluginErrorHandler("${pluginName}");

export const name = "${pluginName}";
export const version = "1.0.0";
export const description = "${pluginName} plugin description";
export const capabilities = ["read"];

export const endpoints = [
  {
    path: "/${pluginName}/resource",
    method: "GET",
    description: "List resources",
    scope: "read",
  },
];

export const tools = [
  {
    name: "${pluginName}_example",
    description: "Example tool for ${pluginName}",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        param: { type: "string" },
      },
      required: ["param"],
    },
    handler: async ({ param }, context) => {
      return {
        ok: true,
        data: { result: param },
        meta: { correlationId: context.correlationId },
      };
    },
  },
];

export function register(app, ctx) {
  app.get("/${pluginName}/resource", async (req, res) => {
    try {
      const data = await getResources(ctx);
      res.json({ ok: true, data });
    } catch (err) {
      throw pluginError.wrap(err, "getResources");
    }
  });
}

async function getResources(ctx) {
  return [{ id: 1, name: "Resource 1" }];
}
`;

// plugin.meta.json template
const metaTemplate = `{
  "name": "${pluginName}",
  "version": "1.0.0",
  "status": "experimental",
  "owner": "your-github-username",
  "description": "${pluginName} plugin description",
  "requiresAuth": false,
  "supportsJobs": false,
  "supportsStreaming": false,
  "testLevel": "none",
  "resilience": {
    "retry": false,
    "timeout": 30000,
    "circuitBreaker": false
  },
  "security": {
    "scope": "read",
    "dangerousCombinations": [],
    "requiresApproval": false
  },
  "documentation": {
    "readme": true,
    "examples": false,
    "apiReference": false
  },
  "envVars": []
}
`;

// README.md template
const readmeTemplate = `# ${pluginName}

${pluginName} plugin description.

## Purpose

Brief explanation of what this plugin does.

## Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| \`/${pluginName}/resource\` | GET | read | List resources |

## MCP Tools

| Tool | Description | Required Params |
|------|-------------|-----------------|
| \`${pluginName}_example\` | Example tool | param |

## Configuration

### Environment Variables

_No environment variables required_

## Example Usage

### HTTP API

\`\`\`bash
curl http://localhost:8787/${pluginName}/resource \\
  -H "Authorization: Bearer \${API_KEY}"
\`\`\`

### MCP Tool

\`\`\`json
{
  "tool": "${pluginName}_example",
  "params": { "param": "value" }
}
\`\`\`

## See Also

- [Plugin Development Guide](../../docs/plugin-sdk-standard.md)
`;

// Write files
writeFileSync(join(pluginDir, "index.js"), indexTemplate);
writeFileSync(join(pluginDir, "plugin.meta.json"), metaTemplate);
writeFileSync(join(pluginDir, "README.md"), readmeTemplate);

console.log(\`✅ Plugin "${pluginName}" created in ${pluginDir}/\`);
console.log("");
console.log("Next steps:");
console.log(\`  1. Edit ${pluginDir}/plugin.meta.json\`);
console.log(\`  2. Implement logic in ${pluginDir}/index.js\`);
console.log(\`  3. Add tests in tests/plugins/${pluginName}.test.js\`);
console.log("  4. Update root README maturity matrix");
`;

writeFileSync(
  "/Users/beyazskorsky/server/mcp-hub/mcp-server/scripts/create-plugin.js",
  cliTemplate
);

console.log("✅ CLI tool created: scripts/create-plugin.js");
console.log("Add to package.json scripts:");
console.log('  "create-plugin": "node scripts/create-plugin.js"');
