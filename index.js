#!/usr/bin/env node
/**
 * n8n MCP Server - HTTP only, NO stdio
 * Knowledge + optional apply for n8n workflows
 * NO LLM calls - AI runs inside n8n
 */

import "dotenv/config";
import { registerPlugin } from "./src/plugins/registry.js";
import { n8nPlugin } from "./src/plugins/n8n/index.js";
import app from "./src/server.js";

// Register plugins
registerPlugin("n8n", n8nPlugin);

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`n8n MCP server listening on http://localhost:${PORT}`);
  console.log(`  GET  /tools           - List tools`);
  console.log(`  POST /tools/call      - Call tool`);
  console.log(`  GET  /resources       - List resources`);
  console.log(`  GET  /resources/read?uri=... - Read resource`);
  console.log(`  GET  /health          - Health check`);
  if (process.env.ALLOW_N8N_WRITE === "true") {
    console.log(`  [WRITE] n8n_create_workflow, n8n_update_workflow enabled`);
  }
});
