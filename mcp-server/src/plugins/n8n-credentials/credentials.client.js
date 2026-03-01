import { config } from "../../core/config.js";

const TIMEOUT_MS = 15_000;

function classifyHttpError(status) {
  if (status === 404 || status === 405) return "n8n_api_not_supported";
  if (status === 401 || status === 403) return "n8n_auth_error";
  if (status >= 400 && status < 500) return "n8n_validation_error";
  return "n8n_server_error";
}

async function apiRequest(path) {
  const { baseUrl, apiBase, apiKey } = config.n8n;

  if (!apiKey) {
    return {
      ok: false,
      error: "missing_api_key",
      message: "N8N_API_KEY is not configured — set it in environment variables",
    };
  }

  const url = `${baseUrl}${apiBase}${path}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: "network_error", message: err.message };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body
  }

  if (!res.ok) {
    return {
      ok: false,
      error: classifyHttpError(res.status),
      details: {
        status: res.status,
        message: data?.message ?? data?.error ?? res.statusText,
      },
    };
  }

  return { ok: true, data };
}

/**
 * Fetch all credentials from n8n (handles pagination).
 * Returns ONLY { id, name, type } — never secrets/tokens/passwords.
 */
export async function fetchCredentials() {
  const items = [];
  let cursor = null;

  do {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const result = await apiRequest(`/credentials${qs}`);
    if (!result.ok) return result;

    const { data } = result;
    const page = Array.isArray(data) ? data : (data?.data ?? []);

    for (const item of page) {
      // Explicitly project only safe fields — never include item.data
      items.push({ id: item.id, name: item.name, type: item.type });
    }

    cursor = data?.nextCursor ?? null;
  } while (cursor);

  // Deduplicate by id
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return { ok: true, data: unique };
}
