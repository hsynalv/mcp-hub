/**
 * {{PLUGIN_NAME}} Plugin
 *
 * {{DESCRIPTION}}
 *
 * Uses the Plugin SDK for consistent tool registration, config, and audit.
 */

import { Router } from "express";
import {
  createMetadata,
  createTool,
  registerTools,
  ToolTags,
  createPluginErrorHandler,
  createAuditHelper,
  extractRequestContext,
  validateBodySync,
  loadPluginConfig,
  requireScope,
} from "../../core/plugin-sdk/index.js";
import { PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginName = "{{PLUGIN_NAME}}";
const handleError = createPluginErrorHandler(pluginName);
const audit = createAuditHelper(pluginName);

// Load plugin config from env (prefix: {{PLUGIN_NAME_UPPER}})
const config = loadPluginConfig("{{PLUGIN_NAME_UPPER}}", {
  enabled: true,
  timeoutMs: 10000,
});

export const metadata = createMetadata({
  name: pluginName,
  version: "1.0.0",
  description: "{{DESCRIPTION}}",
  status: PluginStatus.EXPERIMENTAL,
  riskLevel: RiskLevel.LOW,
  capabilities: ["read"],
  tags: ["{{PLUGIN_NAME}}"],
  endpoints: [
    { method: "GET", path: `/${pluginName}/health`, description: "Plugin health", scope: "read" },
  ],
});

export const tools = [
  createTool({
    name: "{{PLUGIN_NAME}}_hello",
    description: "Example tool that returns a greeting",
    inputSchema: {
      properties: {
        name: { type: "string", description: "Name to greet", default: "World" },
      },
    },
    handler: async (args, context = {}) => {
      const start = Date.now();
      const result = { message: `Hello, ${args.name || "World"}!` };
      await audit.log({
        operation: "hello",
        actor: context.actor,
        workspaceId: context.workspaceId,
        success: true,
        durationMs: Date.now() - start,
      });
      return { ok: true, data: result };
    },
    tags: [ToolTags.READ_ONLY],
  }),
];

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      plugin: pluginName,
      version: metadata.version,
      config: { enabled: config.enabled },
    });
  });

  app.use(`/${pluginName}`, router);

  registerTools(pluginName, tools);
}
