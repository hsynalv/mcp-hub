import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { Router } from "express";
import { fetchCatalog } from "./catalog.provider.js";
import { loadFromDisk, saveToDisk, isFresh } from "./catalog.store.js";
import { searchNodes, getNodeDetail } from "./catalog.search.js";
import { listExamples, getExample } from "./examples.js";
import {
  searchQuerySchema,
  nodeTypeParamSchema,
  examplesQuerySchema,
  workflowValidateBodySchema,
  validateWorkflow,
  applyWorkflowBodySchema,
  executeWorkflowBodySchema,
  getExecutionBodySchema,
} from "./validate.js";
import { applyWorkflow, executeWorkflow, getExecution } from "./write.js";
import { config } from "../../core/config.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit/index.js";

// ── Metadata ──────────────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "n8n",
  version: "1.1.0",
  description: "n8n workflow automation: node catalog, workflow validation, create/update/execute",
  status: PluginStatus.STABLE,
  risk: RiskLevel.HIGH, // Write operations deploy automation workflows
  capabilities: ["read", "write"],
  requires: ["N8N_BASE_URL", "N8N_API_KEY"],
  endpoints: [
    { method: "GET",  path: "/n8n/health",              description: "Plugin health",                                    scope: "read"  },
    { method: "POST", path: "/n8n/context",             description: "Node schemas + credentials + examples in one call", scope: "read"  },
    { method: "GET",  path: "/n8n/nodes/search",        description: "Search node catalog",                              scope: "read"  },
    { method: "GET",  path: "/n8n/nodes/:type",         description: "Full node schema",                                 scope: "read"  },
    { method: "GET",  path: "/n8n/examples",            description: "Workflow examples",                                scope: "read"  },
    { method: "POST", path: "/n8n/workflow/validate",   description: "Validate workflow JSON",                           scope: "read"  },
    { method: "POST", path: "/n8n/workflow/apply",      description: "Create or update workflow in n8n",                 scope: "write" },
    { method: "POST", path: "/n8n/workflow/execute",    description: "Trigger workflow execution",                       scope: "write" },
    { method: "POST", path: "/n8n/execution/get",       description: "Get execution record",                             scope: "read"  },
    { method: "GET",  path: "/n8n/catalog/status",      description: "Catalog cache status",                             scope: "read"  },
    { method: "POST", path: "/n8n/catalog/refresh",     description: "Rebuild node catalog",                             scope: "write" },
  ],
  examples: [
    "POST /n8n/context  body: {nodes: 'webhook,slack'}",
    "POST /n8n/workflow/apply  body: {workflowJson: {...}, mode: 'create'}",
  ],
});

// Flat exports for plugin loader compatibility
export const name         = metadata.name;
export const version      = metadata.version;
export const description  = metadata.description;
export const capabilities = metadata.capabilities;
export const requires     = metadata.requires;
export const endpoints    = metadata.endpoints;
export const examples     = metadata.examples;

// ── Helpers ───────────────────────────────────────────────────────────────────

const pluginError = createPluginErrorHandler("n8n");

// Map write operation error codes to HTTP status codes
const WRITE_ERROR_STATUS = {
  missing_api_key:       401,
  n8n_auth_error:        401,
  network_error:         502,
  n8n_api_not_supported: 502,
  n8n_validation_error:  422,
  n8n_server_error:      502,
  missing_workflow_id:   400,
  invalid_mode:          400,
};

function writeErrorStatus(error) {
  return WRITE_ERROR_STATUS[error] ?? 502;
}

function n8nAudit(req, action, details = {}) {
  return auditLog({
    plugin:    "n8n",
    action,
    userId:    req?.headers?.["x-user-id"] || "anonymous",
    projectId: req?.headers?.["x-project-id"] || null,
    details,
    risk:      RiskLevel.HIGH,
  });
}

/** Load catalog from disk or return 503 via the helper. */
function requireCatalog(res) {
  const catalog = loadFromDisk();
  if (!catalog) {
    res.status(503).json({ ok: false, error: "catalog_unavailable" });
    return null;
  }
  return catalog;
}

/** Gate write routes — returns false and sends 403 if write is disabled. */
function requireWrite(res) {
  if (!config.n8n.allowWrite) {
    res.status(403).json({
      ok: false,
      error: "write_disabled",
      message: "Set ALLOW_N8N_WRITE=true to enable workflow write operations",
    });
    return false;
  }
  return true;
}

export function register(app) {
  const router = Router();

  // ── Health ───────────────────────────────────────────────────────────────

  router.get("/health", (_req, res) => {
    const apiKeyOk  = !!config.n8n.apiKey;
    const baseUrlOk = !!config.n8n.baseUrl;
    const catalog   = loadFromDisk();
    const catalogOk = !!catalog;
    const fresh     = catalogOk && isFresh(catalog, config.catalog.ttlHours);

    const healthy = apiKeyOk && baseUrlOk;
    res.status(healthy ? 200 : 503).json({
      ok:      healthy,
      status:  healthy ? "healthy" : "degraded",
      plugin:  name,
      version,
      checks: {
        apiKey:     apiKeyOk  ? "configured" : "missing N8N_API_KEY",
        baseUrl:    baseUrlOk ? "configured" : "missing N8N_BASE_URL",
        catalog:    catalogOk ? `loaded (${catalog.nodes?.length ?? 0} nodes)` : "not built — POST /n8n/catalog/refresh",
        catalogFresh: fresh   ? "yes" : "stale",
        writeEnabled: config.n8n.allowWrite ? "yes" : "no (set ALLOW_N8N_WRITE=true)",
      },
    });
  });

  // ── Context (single-call bootstrap for AI agents) ────────────────────────
  //
  // GET  /n8n/context?nodes=webhook,telegram
  // POST /n8n/context  body: { "nodes": "webhook,telegram" }
  //                    body: { "nodes": ["webhook","telegram"] }  (array also accepted)
  //
  // Returns everything the AI needs to build a workflow in ONE request:
  //   - Full detail for each requested node type
  //   - All available credentials (id + name + type only)
  //   - Relevant examples (matched by node name keywords)
  //
  // Reduces typical AI iteration from 6+ calls to 1.

  function handleContext(req, res) {
    const catalog = requireCatalog(res);
    if (!catalog) return;

    // Accept nodes from query string (GET) OR request body (POST)
    const rawNodes =
      req.query.nodes ??          // GET  ?nodes=webhook,telegram
      req.body?.nodes ??          // POST { "nodes": "webhook,telegram" }
      "";

    // Accept both comma-separated string and array
    const nodeNames = (
      Array.isArray(rawNodes)
        ? rawNodes
        : String(rawNodes).split(",")
    )
      .map((s) => s.trim())
      .filter(Boolean);

    if (!nodeNames.length) {
      return res.status(400).json({
        error: "invalid_query",
        message: 'Send POST body { "nodes": "webhook,slack,gmail" } or GET ?nodes=webhook,slack,gmail',
      });
    }

    // Resolve each node name → detail (same fuzzy matching as /nodes/:type)
    const nodes = {};
    const notFound = [];
    for (const name of nodeNames) {
      const result = getNodeDetail(catalog.nodes, name);
      if (!result) {
        notFound.push(name);
      } else if (result.ok === false) {
        // node found but no properties; include summary only
        nodes[name] = { _note: result.error };
      } else {
        nodes[result.node.type] = result.node;
      }
    }

    // Load credentials from n8n-credentials plugin cache if available (no secrets)
    let credentials = [];
    try {
      const credPath = resolve(
        join(config.catalog.cacheDir, "n8n-credentials", "credentials.json")
      );
      if (existsSync(credPath)) {
        const raw = JSON.parse(readFileSync(credPath, "utf8"));
        credentials = raw.items ?? [];
      }
    } catch {
      // credentials unavailable — continue without them
    }

    // Match relevant examples by node name keywords in intent or description
    const allExamples = listExamples();
    const lowerNames = nodeNames.map((n) => n.toLowerCase().replace(/^[a-z0-9-]+\./, ""));
    const relevantExamples = allExamples.filter((ex) =>
      lowerNames.some(
        (name) =>
          ex.intent.toLowerCase().includes(name) ||
          ex.description.toLowerCase().includes(name)
      )
    );

    res.json({
      nodes,
      credentials,
      examples: relevantExamples,
      ...(notFound.length ? { notFound } : {}),
    });
  }

  router.get("/context", handleContext);
  router.post("/context", handleContext);

  // ── Catalog management ───────────────────────────────────────────────────

  router.get("/catalog/status", (req, res) => {
    const cached = loadFromDisk();
    if (!cached) {
      return res.json({ ok: false, updatedAt: null, source: null, count: 0, fresh: false });
    }
    res.json({
      ok: true,
      updatedAt: cached.updatedAt,
      source: cached.rawSource ?? null,
      count: cached.nodes?.length ?? 0,
      fresh: isFresh(cached, config.catalog.ttlHours),
    });
  });

  router.post("/catalog/refresh", async (req, res) => {
    const result = await fetchCatalog();
    if (!result.ok) {
      return res.status(502).json({ ok: false, reason: result.reason });
    }
    saveToDisk(result);
    res.json({
      ok: true,
      updatedAt: result.updatedAt,
      source: result.rawSource,
      count: result.nodes.length,
    });
  });

  // ── Node search ──────────────────────────────────────────────────────────

  router.get("/nodes/search", (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    }

    const catalog = requireCatalog(res);
    if (!catalog) return;

    res.json(searchNodes(catalog.nodes, parsed.data));
  });

  // ── Node detail ──────────────────────────────────────────────────────────

  router.get("/nodes/:type", (req, res) => {
    const parsed = nodeTypeParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_type", issues: parsed.error.issues });
    }

    const catalog = requireCatalog(res);
    if (!catalog) return;

    const result = getNodeDetail(catalog.nodes, parsed.data.type);
    if (!result) {
      // Help the AI understand what went wrong and how to recover
      const suggestion = catalog.nodes
        .filter((n) =>
          n.type.toLowerCase().includes(parsed.data.type.toLowerCase()) ||
          n.displayName.toLowerCase().includes(parsed.data.type.toLowerCase())
        )
        .slice(0, 5)
        .map((n) => ({ type: n.type, displayName: n.displayName }));

      return res.status(404).json({
        ok: false,
        error: "node_not_found",
        searched: parsed.data.type,
        hint: "Use the exact 'type' field from search_nodes results. Example: n8n-nodes-base.slack",
        suggestions: suggestion.length ? suggestion : undefined,
      });
    }

    res.json(result);
  });

  // ── Examples ─────────────────────────────────────────────────────────────

  router.get("/examples", (req, res) => {
    const parsed = examplesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    }

    const { intent } = parsed.data;

    if (!intent) {
      return res.json(listExamples());
    }

    const example = getExample(intent);
    if (!example) {
      return res.status(404).json({
        error: "example_not_found",
        intent,
        available: listExamples().map((e) => e.intent),
      });
    }

    res.json(example);
  });

  // ── Workflow validation ───────────────────────────────────────────────────

  router.post("/workflow/validate", (req, res) => {
    const parsed = workflowValidateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    res.json(validateWorkflow(parsed.data.workflowJson));
  });

  // ── Write operations (gated by ALLOW_N8N_WRITE) ──────────────────────────

  router.post("/workflow/apply", async (req, res) => {
    if (!requireWrite(res)) return;
    const parsed = applyWorkflowBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { workflowJson, mode } = parsed.data;
    const result = await applyWorkflow(workflowJson, mode);
    if (!result.ok) return res.status(writeErrorStatus(result.error)).json(result);

    await n8nAudit(req, "apply_workflow", {
      mode,
      workflowName: workflowJson.name,
      workflowId:   result.data?.id,
      nodeCount:    workflowJson.nodes?.length ?? 0,
    });

    res.json({ ok: true, workflow: result.data });
  });

  router.post("/workflow/execute", async (req, res) => {
    if (!requireWrite(res)) return;
    const parsed = executeWorkflowBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { workflowId, inputData } = parsed.data;
    const result = await executeWorkflow(workflowId, inputData);
    if (!result.ok) return res.status(writeErrorStatus(result.error)).json(result);

    await n8nAudit(req, "execute_workflow", { workflowId, executionId: result.data?.id });

    res.json({ ok: true, execution: result.data });
  });

  router.post("/execution/get", async (req, res) => {
    if (!requireWrite(res)) return;
    const parsed = getExecutionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const result = await getExecution(parsed.data.executionId);
    if (!result.ok) return res.status(writeErrorStatus(result.error)).json(result);
    res.json({ ok: true, execution: result.data });
  });

  app.use("/n8n", router);
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "n8n_get_context",
    description: "Get everything needed to build an n8n workflow in ONE call: full node schemas, available credentials, and relevant examples. Always call this first before generating workflow JSON.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        nodes: {
          oneOf: [
            { type: "string", description: "Comma-separated node names, e.g. 'webhook,slack,gmail'" },
            { type: "array",  items: { type: "string" }, description: "Array of node names" },
          ],
          description: "Node types to fetch schemas for",
        },
      },
      required: ["nodes"],
    },
    handler: async (args) => {
      const catalog = loadFromDisk();
      if (!catalog) {
        return { ok: false, error: { code: "catalog_unavailable", message: "Catalog not built. Run n8n_refresh_catalog first." } };
      }

      const nodeNames = (Array.isArray(args.nodes) ? args.nodes : String(args.nodes).split(","))
        .map(s => s.trim()).filter(Boolean);

      const nodes     = {};
      const notFound  = [];
      for (const name of nodeNames) {
        const result = getNodeDetail(catalog.nodes, name);
        if (!result)              notFound.push(name);
        else if (!result.ok)      nodes[name] = { _note: result.error };
        else                      nodes[result.node.type] = result.node;
      }

      const allExamples   = listExamples();
      const lowerNames    = nodeNames.map(n => n.toLowerCase().replace(/^[a-z0-9-]+\./, ""));
      const relevantExamples = allExamples.filter(ex =>
        lowerNames.some(n => ex.intent.toLowerCase().includes(n) || ex.description.toLowerCase().includes(n))
      );

      return { ok: true, nodes, examples: relevantExamples, ...(notFound.length ? { notFound } : {}) };
    },
  },
  {
    name: "n8n_search_nodes",
    description: "Search the n8n node catalog by keyword or category. Use this to discover available node types before building a workflow.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        q:     { type: "string",  description: "Search keyword (e.g. 'email', 'http', 'slack')" },
        group: { type: "string",  description: "Filter by group (e.g. 'trigger', 'transform')" },
        limit: { type: "number",  description: "Max results (default: 20, max: 100)" },
      },
    },
    handler: async (args) => {
      const catalog = loadFromDisk();
      if (!catalog) {
        return { ok: false, error: { code: "catalog_unavailable", message: "Catalog not built. Run n8n_refresh_catalog first." } };
      }
      return { ok: true, ...searchNodes(catalog.nodes, { q: args.q, group: args.group, limit: args.limit ?? 20 }) };
    },
  },
  {
    name: "n8n_get_node",
    description: "Get the full schema and property definitions for a specific n8n node type. Use after n8n_search_nodes to get exact parameter names.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Node type, e.g. 'n8n-nodes-base.slack' or just 'slack'" },
      },
      required: ["type"],
    },
    handler: async (args) => {
      const catalog = loadFromDisk();
      if (!catalog) {
        return { ok: false, error: { code: "catalog_unavailable", message: "Catalog not built. Run n8n_refresh_catalog first." } };
      }
      const result = getNodeDetail(catalog.nodes, args.type);
      if (!result) {
        const suggestions = catalog.nodes
          .filter(n => n.type.toLowerCase().includes(args.type.toLowerCase()) || n.displayName.toLowerCase().includes(args.type.toLowerCase()))
          .slice(0, 5)
          .map(n => ({ type: n.type, displayName: n.displayName }));
        return { ok: false, error: { code: "node_not_found", searched: args.type, suggestions } };
      }
      return result;
    },
  },
  {
    name: "n8n_validate_workflow",
    description: "Validate a workflow JSON before applying it to n8n. Checks for structural errors (missing nodes, broken connections, orphans) and returns warnings. Always validate before n8n_apply_workflow.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        workflowJson: { type: "object", description: "The n8n workflow JSON to validate" },
      },
      required: ["workflowJson"],
    },
    handler: async (args) => {
      return validateWorkflow(args.workflowJson);
    },
  },
  {
    name: "n8n_apply_workflow",
    description: "Create or update a workflow in n8n. Always validate with n8n_validate_workflow first. Requires ALLOW_N8N_WRITE=true on the server.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        workflowJson: { type: "object", description: "The workflow JSON to apply" },
        mode: {
          type: "string",
          enum: ["create", "update", "upsert"],
          description: "'create': always new, 'update': update existing (requires workflowJson.id), 'upsert': update if id present else create",
        },
      },
      required: ["workflowJson", "mode"],
    },
    handler: async (args) => {
      if (!config.n8n.allowWrite) {
        return { ok: false, error: { code: "write_disabled", message: "Set ALLOW_N8N_WRITE=true to enable workflow write operations" } };
      }

      // Validate before applying
      const validation = validateWorkflow(args.workflowJson);
      if (!validation.ok) {
        return { ok: false, error: { code: "validation_failed", errors: validation.errors } };
      }

      const result = await applyWorkflow(args.workflowJson, args.mode);
      if (!result.ok) return result;

      await auditLog({
        plugin:  "n8n",
        action:  "apply_workflow",
        userId:  "mcp-agent",
        details: { mode: args.mode, workflowName: args.workflowJson.name, workflowId: result.data?.id },
        risk:    RiskLevel.HIGH,
      });

      return { ok: true, workflow: result.data };
    },
  },
  {
    name: "n8n_execute_workflow",
    description: "Trigger a manual execution of an existing n8n workflow by ID. Requires ALLOW_N8N_WRITE=true.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "The n8n workflow ID to execute" },
        inputData:  { type: "object", description: "Optional input data for the workflow" },
      },
      required: ["workflowId"],
    },
    handler: async (args) => {
      if (!config.n8n.allowWrite) {
        return { ok: false, error: { code: "write_disabled", message: "Set ALLOW_N8N_WRITE=true to enable workflow execution" } };
      }
      const result = await executeWorkflow(args.workflowId, args.inputData);
      if (!result.ok) return result;

      await auditLog({
        plugin:  "n8n",
        action:  "execute_workflow",
        userId:  "mcp-agent",
        details: { workflowId: args.workflowId, executionId: result.data?.id },
        risk:    RiskLevel.HIGH,
      });

      return { ok: true, execution: result.data };
    },
  },
  {
    name: "n8n_get_execution",
    description: "Fetch the result and status of an n8n workflow execution by execution ID.",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        executionId: { type: "string", description: "The execution ID returned by n8n_execute_workflow" },
      },
      required: ["executionId"],
    },
    handler: async (args) => {
      const result = await getExecution(args.executionId);
      if (!result.ok) return result;
      return { ok: true, execution: result.data };
    },
  },
  {
    name: "n8n_list_examples",
    description: "List available n8n workflow examples. Use these as starting templates or to understand common patterns.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Filter by intent keyword (optional)" },
      },
    },
    handler: async (args) => {
      if (args.intent) {
        const example = getExample(args.intent);
        if (!example) {
          return {
            ok: false,
            error: { code: "not_found", intent: args.intent, available: listExamples().map(e => e.intent) },
          };
        }
        return { ok: true, example };
      }
      return { ok: true, examples: listExamples() };
    },
  },
  {
    name: "n8n_refresh_catalog",
    description: "Rebuild the n8n node catalog from the installed n8n-nodes-base package. Run this once on setup or after upgrading n8n.",
    tags: [ToolTags.WRITE],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const result = await fetchCatalog();
      if (!result.ok) return { ok: false, error: { code: "catalog_fetch_failed", reason: result.reason } };
      saveToDisk(result);
      return { ok: true, nodeCount: result.nodes.length, source: result.rawSource, updatedAt: result.updatedAt };
    },
  },
];
