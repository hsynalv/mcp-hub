import { createN8nClient } from "./n8n.client.js";
import { annotateWorkflow } from "./workflow.annotate.js";

/**
 * Apply a workflow to n8n (create / update / upsert).
 *
 * mode="create"  → POST /workflows          (id field stripped from payload)
 * mode="update"  → PUT /workflows/:id       (requires workflowJson.id)
 * mode="upsert"  → if id present: PUT first, fall back to POST on 404
 *                  if no id: POST directly
 *
 * Returns the structured result from createN8nClient().request().
 */
/**
 * Normalise a workflow payload before sending to n8n API.
 * n8n requires `settings` and `staticData` fields — add them if missing.
 */
function normalizePayload(workflowJson) {
  return {
    settings: {},
    staticData: null,
    ...workflowJson,
  };
}

export async function applyWorkflow(workflowJson, mode) {
  const client = createN8nClient();
  const id = workflowJson.id;

  // Enrich with sticky notes before sending
  const annotated = annotateWorkflow(workflowJson);

  if (mode === "create") {
    const { id: _omit, ...rest } = annotated;
    return client.request("POST", "/workflows", normalizePayload(rest));
  }

  if (mode === "update") {
    if (!id) {
      return {
        ok: false,
        error: "missing_workflow_id",
        message: 'workflowJson.id is required for mode="update"',
      };
    }
    // id goes in the URL — n8n rejects it in the body ("id is read-only")
    const { id: _omit, ...rest } = annotated;
    return client.request("PUT", `/workflows/${id}`, normalizePayload(rest));
  }

  if (mode === "upsert") {
    if (id) {
      const { id: _omit, ...rest } = annotated;
      const result = await client.request("PUT", `/workflows/${id}`, normalizePayload(rest));
      const is404 = !result.ok && result.details?.status === 404;
      if (!is404) return result;
    }
    const { id: _omit2, ...rest } = annotated;
    return client.request("POST", "/workflows", normalizePayload(rest));
  }

  return { ok: false, error: "invalid_mode", message: `Unknown mode: ${mode}` };
}

/**
 * Trigger a manual execution of a workflow.
 * POST /workflows/:id/run
 */
export async function executeWorkflow(workflowId, inputData) {
  const client = createN8nClient();
  const body = inputData ? { workflowData: { nodes: [], connections: {} }, runData: inputData } : {};
  return client.request("POST", `/workflows/${workflowId}/run`, body);
}

/**
 * Fetch an execution record by ID.
 * GET /executions/:id
 * Exposed as POST to allow a structured body { executionId } instead of a path param
 * (so the AI doesn't need to build URLs).
 */
export async function getExecution(executionId) {
  const client = createN8nClient();
  return client.request("GET", `/executions/${executionId}`);
}
