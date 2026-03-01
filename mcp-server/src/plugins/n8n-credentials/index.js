import { Router } from "express";
import { z } from "zod";
import { fetchCredentials } from "./credentials.client.js";
import { loadFromDisk, saveToDisk, isFresh } from "./credentials.store.js";

export const name = "n8n-credentials";
export const version = "1.0.0";
export const description = "n8n credential metadata — id/name/type only, no secrets";

const typeParamSchema = z.object({
  type: z.string().min(1).max(100),
});

/**
 * Return HTTP status for a given error code.
 */
function errStatus(error) {
  if (error === "missing_api_key" || error === "n8n_auth_error") return 401;
  return 502;
}

/**
 * Return fresh cache or refresh from n8n.
 * Falls back to stale cache if n8n is unavailable.
 */
async function getOrRefresh() {
  const cached = loadFromDisk();
  if (cached && isFresh(cached)) {
    return { ok: true, items: cached.items, updatedAt: cached.updatedAt };
  }

  const result = await fetchCredentials();
  if (!result.ok) {
    // Fall back to stale cache rather than returning an error
    if (cached) {
      return { ok: true, items: cached.items, updatedAt: cached.updatedAt, stale: true };
    }
    return result;
  }

  saveToDisk(result.data);
  const saved = loadFromDisk();
  return { ok: true, items: result.data, updatedAt: saved.updatedAt };
}

export function register(app) {
  const router = Router();

  // ── GET /credentials ──────────────────────────────────────────────────────
  // Returns all credentials as [{ id, name, type }]
  router.get("/", async (req, res) => {
    const result = await getOrRefresh();
    if (!result.ok) return res.status(errStatus(result.error)).json(result);
    res.json(result.items);
  });

  // ── GET /credentials/:type ────────────────────────────────────────────────
  // Returns credentials filtered by type (e.g. slackApi, gmailOAuth2)
  router.get("/:type", async (req, res) => {
    const parsed = typeParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_type", issues: parsed.error.issues });
    }

    const result = await getOrRefresh();
    if (!result.ok) return res.status(errStatus(result.error)).json(result);

    const filtered = result.items.filter((c) => c.type === parsed.data.type);
    res.json(filtered);
  });

  // ── POST /credentials/refresh ─────────────────────────────────────────────
  // Force-fetches from n8n and writes cache regardless of TTL
  router.post("/refresh", async (req, res) => {
    const result = await fetchCredentials();
    if (!result.ok) return res.status(errStatus(result.error)).json(result);

    saveToDisk(result.data);
    const saved = loadFromDisk();
    res.json({ ok: true, count: result.data.length, updatedAt: saved.updatedAt });
  });

  app.use("/credentials", router);
}
