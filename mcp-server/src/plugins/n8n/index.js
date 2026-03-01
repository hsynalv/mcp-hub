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

export const name = "n8n";
export const version = "1.0.0";
export const description = "n8n node catalog and workflow support";

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
      return res.status(404).json({ ok: false, error: "node_not_found" });
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
