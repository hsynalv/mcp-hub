/**
 * Minimal Notion API client with resilience (retry + circuit breaker).
 * Docs: https://developers.notion.com/reference
 */

import { config } from "../../core/config.js";
import { withRetry, getCircuitBreaker } from "../../core/resilience.js";
import { isRetryableError } from "../../core/error-categories.js";

const NOTION_VERSION = "2022-06-28";
const BASE_URL = "https://api.notion.com/v1";

function getApiKey() {
  return config.notion?.apiKey ?? process.env.NOTION_API_KEY ?? "";
}

const notionCircuit = getCircuitBreaker("notion", {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

/**
 * Make an authenticated request to the Notion API with resilience.
 */
export async function notionRequest(method, path, body = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_api_key", message: "NOTION_API_KEY is not set" };
  }

  return notionCircuit.execute(async () => {
    return withRetry(
      async () => {
        const result = await notionRequestInternal(method, path, body);
        if (!result.ok) {
          // Convert to error for retry logic
          const error = new Error(result.error || "Notion API error");
          error.status = result.details?.status;
          error.details = result.details;
          throw error;
        }
        return result;
      },
      {
        maxAttempts: 3,
        backoffMs: 1000,
        retryableError: (err) => {
          // Don't retry auth errors
          if (err.status === 401 || err.status === 403) return false;
          // Don't retry 404s
          if (err.status === 404) return false;
          // Retry rate limits and server errors
          return isRetryableError(err);
        },
      }
    );
  }).catch((err) => {
    // Convert circuit/retry errors back to our format
    if (err.name === "CircuitBreakerError") {
      return {
        ok: false,
        error: "notion_circuit_open",
        details: { message: err.message },
      };
    }
    return {
      ok: false,
      error: "notion_error",
      details: { message: err.message },
    };
  });
}

/**
 * Internal Notion request without retry logic.
 */
async function notionRequestInternal(method, path, body = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_api_key", message: "NOTION_API_KEY is not set" };
  }

  const url = `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: classifyError(res.status),
        details: { status: res.status, message: json.message ?? JSON.stringify(json) },
      };
    }

    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      details: { message: err.message },
    };
  }
}

function classifyError(status) {
  if (status === 401) return "notion_auth_error";
  if (status === 403) return "notion_forbidden";
  if (status === 404) return "notion_not_found";
  if (status === 400) return "notion_bad_request";
  if (status === 429) return "notion_rate_limited";
  return "notion_api_error";
}
