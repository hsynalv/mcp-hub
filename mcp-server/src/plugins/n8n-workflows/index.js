import { Router } from "express";
import { z } from "zod";
import { fetchWorkflowList, fetchWorkflowById } from "./workflows.client.js";
import {
  loadListFromDisk,
  saveListToDisk,
  isListFresh,
  loadWorkflowFromDisk,
  saveWorkflowToDisk,
  isWorkflowFresh,
} from "./workflows.store.js";

export const name = "n8n-workflows";
export const version = "1.0.0";
export const description = "n8n workflow list, detail, and search";

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

  app.use("/n8n/workflows", router);
}
