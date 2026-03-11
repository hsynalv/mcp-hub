/**
 * Minimal Notion API client with retry and rate-limit handling.
 * Docs: https://developers.notion.com/reference
 */

import { config } from "../../core/config.js";
import { withResilience } from "../../core/resilience.js";

const NOTION_VERSION = "2022-06-28";
const BASE_URL = "https://api.notion.com/v1";

function getApiKey() {
  return config.notion?.apiKey ?? process.env.NOTION_API_KEY ?? "";
}

function classifyError(status) {
  if (status === 401) return "notion_auth_error";
  if (status === 403) return "notion_forbidden";
  if (status === 404) return "notion_not_found";
  if (status === 400) return "notion_bad_request";
  if (status === 429) return "notion_rate_limited";
  return "notion_api_error";
}

/**
 * Raw single request to Notion API (no retry).
 */
async function _notionRequest(method, path, body, apiKey) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 429) {
    // Rate limited — let resilience layer handle retry after delay
    const retryAfter = parseInt(res.headers.get("Retry-After") || "1", 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    throw Object.assign(new Error("notion_rate_limited"), { retryable: true });
  }

  if (!res.ok) {
    return {
      ok: false,
      error: classifyError(res.status),
      details: { status: res.status, message: json.message ?? JSON.stringify(json) },
    };
  }

  return { ok: true, data: json };
}

/**
 * Make an authenticated request to the Notion API with automatic retry.
 *
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path  e.g. "/pages", "/databases/abc123/query"
 * @param {object|null} body
 * @returns {Promise<{ ok: boolean, data?: object, error?: string, details?: object }>}
 */
export async function notionRequest(method, path, body = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_api_key", message: "NOTION_API_KEY is not set" };
  }

  try {
    return await withResilience("notion-api", () => _notionRequest(method, path, body, apiKey), {
      circuit: { failureThreshold: 10, resetTimeoutMs: 60000 },
      retry: { maxAttempts: 3, backoffMs: 500 },
    });
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      details: { message: err.message },
    };
  }
}
