import { config } from "../../core/config.js";

const TIMEOUT_MS = 15_000;

/**
 * Classify a non-2xx HTTP status into a structured error code.
 * 404/405 → n8n_api_not_supported (endpoint doesn't exist in this n8n version)
 * 401/403 → n8n_auth_error
 * 4xx     → n8n_validation_error
 * 5xx     → n8n_server_error
 */
function classifyHttpError(status) {
  if (status === 404 || status === 405) return "n8n_api_not_supported";
  if (status === 401 || status === 403) return "n8n_auth_error";
  if (status >= 400 && status < 500)    return "n8n_validation_error";
  return "n8n_server_error";
}

/**
 * Create an n8n REST API client.
 *
 * All methods return a structured result — never throw.
 *
 * Success: { ok: true, status: number, data: object }
 * Failure: { ok: false, error: string, message?: string, details?: object }
 *
 * Error codes:
 *   missing_api_key       – N8N_API_KEY not configured
 *   network_error         – fetch threw (unreachable, timeout, etc.)
 *   n8n_api_not_supported – HTTP 404/405 (endpoint unknown in this n8n version)
 *   n8n_auth_error        – HTTP 401/403
 *   n8n_validation_error  – HTTP 4xx
 *   n8n_server_error      – HTTP 5xx
 */
export function createN8nClient() {
  const { baseUrl, apiBase, apiKey } = config.n8n;

  async function request(method, path, body) {
    if (!apiKey) {
      return {
        ok: false,
        error: "missing_api_key",
        message: "N8N_API_KEY is not configured — set it in environment variables",
      };
    }

    const url = `${baseUrl}${apiBase}${path}`;
    const headers = {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
    };

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        error: "network_error",
        message: err.message,
      };
    }

    // Try to parse body regardless of status (n8n includes error details in body)
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON body — leave data as null
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

    return { ok: true, status: res.status, data };
  }

  return { request };
}
