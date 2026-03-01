/**
 * n8n Workflow Write - Create/Update workflows via n8n REST API
 * GATED by ALLOW_N8N_WRITE=true
 * NO LLM - just HTTP proxy to n8n API
 */

const ALLOW_WRITE = process.env.ALLOW_N8N_WRITE === "true";
const N8N_BASE_URL = process.env.N8N_BASE_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY;

export function isWriteEnabled() {
  return ALLOW_WRITE && N8N_API_KEY;
}

export async function createWorkflow(workflowData) {
  if (!isWriteEnabled()) {
    throw new Error("Workflow write is disabled. Set ALLOW_N8N_WRITE=true and N8N_API_KEY.");
  }
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify(workflowData),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`n8n API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function updateWorkflow(workflowId, workflowData) {
  if (!isWriteEnabled()) {
    throw new Error("Workflow write is disabled. Set ALLOW_N8N_WRITE=true and N8N_API_KEY.");
  }
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify(workflowData),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`n8n API error ${res.status}: ${err}`);
  }
  return res.json();
}
