import { Router } from "express";
import { z } from "zod";
import { fetchWorkflowList, fetchWorkflowById, createWorkflow, updateWorkflow, activateWorkflow } from "./workflows.client.js";
import { fetchCredentials } from "../n8n-credentials/credentials.client.js";
import { config } from "../../core/config.js";
import {
  loadListFromDisk,
  saveListToDisk,
  isListFresh,
  loadWorkflowFromDisk,
  saveWorkflowToDisk,
  isWorkflowFresh,
} from "./workflows.store.js";
import { ToolTags } from "../../core/tool-registry.js";

export const name = "n8n-workflows";
export const version = "1.0.0";
export const description = "n8n workflow management - list, create, update, activate";
export const capabilities = ["read", "write"];
export const requires = ["N8N_API_KEY"];
export const endpoints = [
  { method: "GET",  path: "/n8n/workflows",              description: "List all workflows",                    scope: "read" },
  { method: "GET",  path: "/n8n/workflows/:id",          description: "Get full workflow JSON",                 scope: "read" },
  { method: "POST", path: "/n8n/workflows/search",       description: "Search by name or node type",           scope: "read" },
  { method: "POST", path: "/n8n/workflows/create",        description: "Create a new workflow",                 scope: "write" },
  { method: "PUT",  path: "/n8n/workflows/:id",          description: "Update an existing workflow",           scope: "write" },
  { method: "POST", path: "/n8n/workflows/:id/activate",   description: "Activate a workflow",                   scope: "write" },
  { method: "POST", path: "/n8n/workflows/:id/deactivate", description: "Deactivate a workflow",                 scope: "write" },
];

const workflowIdSchema = z.object({
  id: z.string().min(1).max(100),
});

const searchBodySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    nodeType: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.q || d.nodeType, {
    message: "At least one of q or nodeType must be provided",
  });

function errStatus(error) {
  if (error === "missing_api_key" || error === "n8n_auth_error") return 401;
  return 502;
}

/**
 * Return fresh list cache or refresh from n8n.
 * Falls back to stale cache if n8n is unreachable.
 */
async function getOrRefreshList() {
  const cached = loadListFromDisk();
  if (cached && isListFresh(cached)) {
    return { ok: true, items: cached.items };
  }

  const result = await fetchWorkflowList();
  if (!result.ok) {
    if (cached) return { ok: true, items: cached.items, stale: true };
    return result;
  }

  saveListToDisk(result.data);
  return { ok: true, items: result.data };
}

export function register(app) {
  const router = Router();

  // ── GET /n8n/workflows ────────────────────────────────────────────────────
  // Lightweight list: [{ id, name, active, updatedAt }]
  router.get("/", async (req, res) => {
    const result = await getOrRefreshList();
    if (!result.ok) return res.status(errStatus(result.error)).json(result);
    res.json(result.items);
  });

  // ── GET /n8n/workflows/:id ────────────────────────────────────────────────
  // Full workflow JSON — used as template/context by AI
  router.get("/:id", async (req, res) => {
    const parsed = workflowIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_id", issues: parsed.error.issues });
    }

    const { id } = parsed.data;

    // Serve from cache if fresh
    const cached = loadWorkflowFromDisk(id);
    if (cached && isWorkflowFresh(cached)) {
      return res.json(cached.workflow);
    }

    const result = await fetchWorkflowById(id);
    if (!result.ok) {
      // Fall back to stale cache if available
      if (cached) return res.json(cached.workflow);
      return res.status(errStatus(result.error)).json(result);
    }

    saveWorkflowToDisk(id, result.data);
    res.json(result.data);
  });

  // ── POST /n8n/workflows/search ────────────────────────────────────────────
  // Body: { q?: string, nodeType?: string }
  //
  // q only     → fast name search on list (no extra API calls)
  // nodeType   → searches only already-cached workflows to avoid timeout;
  //              uncached workflows are counted and reported separately
  router.post("/search", async (req, res) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }

    const { q, nodeType } = parsed.data;

    const listResult = await getOrRefreshList();
    if (!listResult.ok) {
      return res.status(errStatus(listResult.error)).json(listResult);
    }

    // Name filter (applied regardless of nodeType)
    const nameFiltered = listResult.items.filter(
      (wf) => !q || wf.name.toLowerCase().includes(q.toLowerCase())
    );

    // Name-only search — return immediately
    if (!nodeType) {
      return res.json(
        nameFiltered.map((wf) => ({ ...wf, matches: { nodes: 0 } }))
      );
    }

    // nodeType search — only look inside cached workflows.
    // Tip: call GET /n8n/workflows/:id to populate cache for uncached workflows.
    const results = [];
    let uncachedCount = 0;

    for (const wf of nameFiltered) {
      const cachedWf = loadWorkflowFromDisk(wf.id);
      if (!cachedWf) {
        uncachedCount++;
        continue;
      }

      const nodes = cachedWf.workflow?.nodes ?? [];
      const nodeMatches = nodes.filter((n) => n.type === nodeType).length;
      if (nodeMatches > 0) {
        results.push({ ...wf, matches: { nodes: nodeMatches } });
      }
    }

    const response = { results };
    if (uncachedCount > 0) {
      response.note = `${uncachedCount} workflow(s) not in cache — call GET /n8n/workflows/:id to cache them before searching by nodeType`;
    }

    res.json(response);
  });

  // ── POST /n8n/workflows/create ─────────────────────────────────────────────
  // Create a new workflow with validation
  router.post("/create", async (req, res) => {
    const { workflow_description, workflow_json, explanation } = req.body || {};

    if (!explanation) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_explanation", message: "explanation is required" },
      });
    }

    const workflowData = workflow_json;

    // If workflow_json not provided, try to generate from description (placeholder)
    if (!workflowData && workflow_description) {
      return res.status(400).json({
        ok: false,
        error: { code: "workflow_json_required", message: "workflow_json is required. Use AI to generate valid n8n workflow JSON from the description." },
      });
    }

    // Validate workflow JSON
    const validation = validateWorkflow(workflowData);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_workflow", message: validation.error },
      });
    }

    // Create the workflow
    const result = await createWorkflow(workflowData);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    // Build workflow URL
    const { baseUrl } = config.n8n;
    const workflowUrl = `${baseUrl}/workflow/${result.data.id}`;

    res.json({
      ok: true,
      data: {
        workflow_id: result.data.id,
        workflow_url: workflowUrl,
        activation_status: result.data.active ?? false,
        name: result.data.name,
        explanation,
      },
    });
  });

  // ── PUT /n8n/workflows/:id ─────────────────────────────────────────────────
  // Update an existing workflow
  router.put("/:id", async (req, res) => {
    const parsed = workflowIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_id", issues: parsed.error.issues });
    }

    const { workflow_json, explanation } = req.body || {};
    if (!explanation) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_explanation", message: "explanation is required" },
      });
    }

    if (!workflow_json) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_workflow_json", message: "workflow_json is required" },
      });
    }

    // Validate workflow JSON
    const validation = validateWorkflow(workflow_json);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_workflow", message: validation.error },
      });
    }

    const result = await updateWorkflow(parsed.data.id, workflow_json);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    res.json({
      ok: true,
      data: {
        workflow_id: result.data.id,
        name: result.data.name,
        active: result.data.active,
        explanation,
      },
    });
  });

  // ── POST /n8n/workflows/:id/activate ──────────────────────────────────────
  // Activate a workflow
  router.post("/:id/activate", async (req, res) => {
    const parsed = workflowIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_id", issues: parsed.error.issues });
    }

    const { explanation } = req.body || {};
    if (!explanation) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_explanation", message: "explanation is required" },
      });
    }

    const result = await activateWorkflow(parsed.data.id, true);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    res.json({
      ok: true,
      data: {
        workflow_id: parsed.data.id,
        activation_status: true,
        explanation,
      },
    });
  });

  // ── POST /n8n/workflows/:id/deactivate ────────────────────────────────────
  // Deactivate a workflow
  router.post("/:id/deactivate", async (req, res) => {
    const parsed = workflowIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_id", issues: parsed.error.issues });
    }

    const { explanation } = req.body || {};
    if (!explanation) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_explanation", message: "explanation is required" },
      });
    }

    const result = await activateWorkflow(parsed.data.id, false);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    res.json({
      ok: true,
      data: {
        workflow_id: parsed.data.id,
        activation_status: false,
        explanation,
      },
    });
  });

  app.use("/n8n/workflows", router);
}

// ─── Workflow Validation ───────────────────────────────────────────────────

function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object") {
    return { valid: false, error: "Workflow must be an object" };
  }

  if (!workflow.name || typeof workflow.name !== "string") {
    return { valid: false, error: "Workflow must have a name (string)" };
  }

  if (!Array.isArray(workflow.nodes)) {
    return { valid: false, error: "Workflow must have a nodes array" };
  }

  if (workflow.nodes.length === 0) {
    return { valid: false, error: "Workflow must have at least one node" };
  }

  for (const node of workflow.nodes) {
    if (!node.id || !node.type) {
      return { valid: false, error: "Each node must have an id and type" };
    }
  }

  return { valid: true };
}

// ─── MCP Tools ────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "n8n_list_credentials",
    description: "List available n8n credentials for workflow connections",
    inputSchema: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Explain why you need to list credentials",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY],
    handler: async ({ explanation }) => {
      const result = await fetchCredentials();
      if (!result.ok) {
        return { ok: false, error: result.error, message: result.message };
      }
      return {
        ok: true,
        data: {
          credentials: result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "n8n_list_workflows",
    description: "List all n8n workflows",
    inputSchema: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Explain why you need to list workflows",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY],
    handler: async ({ explanation }) => {
      const result = await fetchWorkflowList();
      if (!result.ok) {
        return { ok: false, error: result.error, message: result.message };
      }
      return {
        ok: true,
        data: {
          workflows: result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "n8n_create_workflow",
    description: "Create a workflow in n8n from JSON",
    inputSchema: {
      type: "object",
      properties: {
        workflow_description: {
          type: "string",
          description: "Description of what the workflow should do",
        },
        workflow_json: {
          type: "object",
          description: "Valid n8n workflow JSON with nodes and connections",
        },
        explanation: {
          type: "string",
          description: "Explain why you are creating this workflow",
        },
      },
      required: ["workflow_json", "explanation"],
    },
    tags: [ToolTags.WRITE],
    handler: async ({ workflow_json, explanation }) => {
      // Validate
      const validation = validateWorkflow(workflow_json);
      if (!validation.valid) {
        return { ok: false, error: { code: "invalid_workflow", message: validation.error } };
      }

      // Create
      const result = await createWorkflow(workflow_json);
      if (!result.ok) {
        return { ok: false, error: result.error, message: result.message, details: result.details };
      }

      const { baseUrl } = config.n8n;
      return {
        ok: true,
        data: {
          workflow_id: result.data.id,
          workflow_url: `${baseUrl}/workflow/${result.data.id}`,
          activation_status: result.data.active ?? false,
          name: result.data.name,
          explanation,
        },
      };
    },
  },
  {
    name: "n8n_update_workflow",
    description: "Update an existing n8n workflow",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "ID of the workflow to update",
        },
        workflow_json: {
          type: "object",
          description: "Updated workflow JSON",
        },
        explanation: {
          type: "string",
          description: "Explain why you are updating this workflow",
        },
      },
      required: ["workflow_id", "workflow_json", "explanation"],
    },
    tags: [ToolTags.WRITE],
    handler: async ({ workflow_id, workflow_json, explanation }) => {
      const validation = validateWorkflow(workflow_json);
      if (!validation.valid) {
        return { ok: false, error: { code: "invalid_workflow", message: validation.error } };
      }

      const result = await updateWorkflow(workflow_id, workflow_json);
      if (!result.ok) {
        return { ok: false, error: result.error, message: result.message, details: result.details };
      }

      return {
        ok: true,
        data: {
          workflow_id: result.data.id,
          name: result.data.name,
          active: result.data.active,
          explanation,
        },
      };
    },
  },
  {
    name: "n8n_activate_workflow",
    description: "Activate or deactivate an n8n workflow",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "ID of the workflow",
        },
        active: {
          type: "boolean",
          description: "True to activate, false to deactivate",
        },
        explanation: {
          type: "string",
          description: "Explain why you are changing activation status",
        },
      },
      required: ["workflow_id", "active", "explanation"],
    },
    tags: [ToolTags.WRITE],
    handler: async ({ workflow_id, active, explanation }) => {
      const result = await activateWorkflow(workflow_id, active);
      if (!result.ok) {
        return { ok: false, error: result.error, message: result.message, details: result.details };
      }

      return {
        ok: true,
        data: {
          workflow_id,
          activation_status: active,
          explanation,
        },
      };
    },
  },
];
