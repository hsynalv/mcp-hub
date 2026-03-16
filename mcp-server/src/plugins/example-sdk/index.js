/**
 * Example SDK Plugin
 *
 * Minimal example demonstrating Plugin SDK best practices.
 * Use this as a reference when building new plugins.
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
import { z } from "zod";

const pluginName = "example-sdk";
const handleError = createPluginErrorHandler(pluginName);
const audit = createAuditHelper(pluginName);

// Config from env (prefix: EXAMPLE_SDK)
const config = loadPluginConfig("EXAMPLE_SDK", {
  enabled: true,
  maxItems: 100,
  timeoutMs: 5000,
});

export const metadata = createMetadata({
  name: pluginName,
  version: "1.0.0",
  description: "Example plugin demonstrating Plugin SDK patterns",
  status: PluginStatus.EXPERIMENTAL,
  riskLevel: RiskLevel.LOW,
  capabilities: ["read", "write"],
  tags: ["example", "sdk", "demo"],
  endpoints: [
    { method: "GET", path: "/example-sdk/health", description: "Plugin health", scope: "read" },
    { method: "POST", path: "/example-sdk/echo", description: "Echo input (validated)", scope: "read" },
  ],
});

const echoSchema = z.object({
  message: z.string().min(1).max(500),
  repeat: z.number().int().min(1).max(10).optional().default(1),
});

export const tools = [
  createTool({
    name: "example_sdk_hello",
    description: "Returns a greeting. Demonstrates createTool and audit.",
    inputSchema: {
      properties: {
        name: { type: "string", description: "Name to greet", default: "World" },
      },
    },
    handler: async (args, context = {}) => {
      const start = Date.now();
      const message = `Hello, ${args.name || "World"}!`;
      await audit.log({
        operation: "hello",
        actor: context.actor,
        workspaceId: context.workspaceId,
        success: true,
        durationMs: Date.now() - start,
      });
      return { ok: true, data: { message } };
    },
    tags: [ToolTags.READ_ONLY],
  }),
  createTool({
    name: "example_sdk_echo",
    description: "Echoes a message N times. Demonstrates validation.",
    inputSchema: {
      properties: {
        message: { type: "string", description: "Message to echo" },
        repeat: { type: "number", description: "Times to repeat (1-10)", default: 1 },
      },
      required: ["message"],
    },
    handler: async (args) => {
      const parsed = echoSchema.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: { code: "validation_error", details: parsed.error.flatten() } };
      }
      const { message, repeat } = parsed.data;
      const result = Array(repeat).fill(message).join(" ");
      return { ok: true, data: { echoed: result } };
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
      config: { enabled: config.enabled, maxItems: config.maxItems },
    });
  });

  router.post("/echo", requireScope("read"), (req, res) => {
    const data = validateBodySync(echoSchema, req.body, res, pluginName);
    if (!data) return;

    const context = extractRequestContext(req);
    const result = Array(data.repeat).fill(data.message).join(" ");
    res.json({ ok: true, data: { echoed: result, actor: context.actor } });
  });

  app.use(`/${pluginName}`, router);

  registerTools(pluginName, tools);
}
