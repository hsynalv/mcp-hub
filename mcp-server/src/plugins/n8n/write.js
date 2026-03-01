import { createN8nClient } from "./n8n.client.js";

/**
 * Apply a workflow to n8n (create / update / upsert).
 *
 * mode="create"  → POST /workflows          (id field stripped from payload)
 * mode="update"  → PATCH /workflows/:id     (requires workflowJson.id)
 * mode="upsert"  → if id present: PATCH first, fall back to POST on 404
 *                  if no id: POST directly
 *
 * Returns the structured result from createN8nClient().request().
 */
export async function applyWorkflow(workflowJson, mode) {
  const client = createN8nClient();
  const id = workflowJson.id;

  if (mode === "create") {
    const { id: _omit, ...payload } = workflowJson;
    return client.request("POST", "/workflows", payload);
  }

  if (mode === "update") {
    if (!id) {
      return {
        ok: false,
        error: "missing_workflow_id",
        message: 'workflowJson.id is required for mode="update"',
      };
    }
    return client.request("PATCH", `/workflows/${id}`, workflowJson);
  }

  if (mode === "upsert") {
    if (id) {
      const result = await client.request("PATCH", `/workflows/${id}`, workflowJson);
      // Only fall back to create on a genuine 404 (workflow doesn't exist yet)
      const is404 = !result.ok && result.details?.status === 404;
      if (!is404) return result;
    }
    const { id: _omit, ...payload } = workflowJson;
    return client.request("POST", "/workflows", payload);
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
