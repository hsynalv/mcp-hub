/**
 * Minimal GitHub REST API v3 client.
 * Docs: https://docs.github.com/en/rest
 *
 * Supports both classic and fine-grained personal access tokens.
 * Works with public repos without a token; private repos require GITHUB_TOKEN.
 */

import { withResilience } from "../../core/resilience.js";

const BASE_URL = "https://api.github.com";

function getToken() {
  return process.env.GITHUB_TOKEN ?? "";
}

function buildHeaders() {
  const token = getToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcp-hub/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function classifyError(status) {
  if (status === 401) return "github_auth_error";
  if (status === 403) return "github_forbidden";
  if (status === 404) return "github_not_found";
  if (status === 422) return "github_validation_error";
  if (status === 429) return "github_rate_limited";
  return "github_api_error";
}

/**
 * Extract rate limit info from GitHub response headers.
 */
function extractRateLimit(headers) {
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset     = headers.get("X-RateLimit-Reset");
  const limit     = headers.get("X-RateLimit-Limit");
  return {
    limit:     limit     ? Number(limit)     : null,
    remaining: remaining ? Number(remaining) : null,
    resetAt:   reset     ? new Date(Number(reset) * 1000).toISOString() : null,
  };
}

/**
 * Low-level GitHub request (no resilience wrapping).
 * Handles rate-limit 403/429 by throwing "rate_limited" so withResilience retries.
 */
async function _githubRequest(method, path, body = null) {
  const headers = buildHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const rateLimit = extractRateLimit(res.headers);

  // 204 No Content
  if (res.status === 204) return { ok: true, data: null, rateLimit };

  const json = await res.json().catch(() => ({}));

  // Rate-limited — throw so the resilience layer can retry after a delay
  if (res.status === 429 || (res.status === 403 && rateLimit.remaining === 0)) {
    const resetMs = rateLimit.resetAt
      ? new Date(rateLimit.resetAt).getTime() - Date.now()
      : 60_000;
    await new Promise(r => setTimeout(r, Math.min(resetMs, 60_000)));
    throw new Error("rate_limited");
  }

  if (!res.ok) {
    return {
      ok: false,
      error: classifyError(res.status),
      rateLimit,
      details: {
        status: res.status,
        message: json.message ?? JSON.stringify(json),
      },
    };
  }

  return { ok: true, data: json, rateLimit };
}

/**
 * Make a request to the GitHub API with retry + circuit breaker.
 *
 * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path  e.g. "/repos/owner/repo"
 * @param {object|null} body
 * @returns {Promise<{ ok: boolean, data?: any, rateLimit?: object, error?: string, details?: object }>}
 */
export async function githubRequest(method, path, body = null) {
  try {
    return await withResilience("github-api", () => _githubRequest(method, path, body), {
      circuit: { failureThreshold: 10, resetTimeoutMs: 60_000 },
      retry: { maxAttempts: 3, backoffMs: 1_000 },
    });
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      details: { message: err.message },
    };
  }
}

/**
 * Paginate a GitHub list endpoint automatically (up to maxItems).
 * Follows Link headers for cursor-based pagination.
 */
export async function githubPaginate(path, maxItems = 100) {
  const headers = buildHeaders();
  const perPage = Math.min(maxItems, 100);
  let url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}per_page=${perPage}`;
  const allItems = [];
  let lastRateLimit = null;

  while (url && allItems.length < maxItems) {
    try {
      const res = await fetch(url, { headers });
      lastRateLimit = extractRateLimit(res.headers);

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return {
          ok: false,
          error: classifyError(res.status),
          rateLimit: lastRateLimit,
          details: { status: res.status, message: json.message },
        };
      }

      const json = await res.json();
      allItems.push(...(Array.isArray(json) ? json : []));

      // Follow Link: <url>; rel="next"
      const link = res.headers.get("Link") ?? "";
      const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && allItems.length < maxItems ? next : null;
    } catch (err) {
      return { ok: false, error: "network_error", details: { message: err.message } };
    }
  }

  return { ok: true, data: allItems.slice(0, maxItems), rateLimit: lastRateLimit };
}

// ── Pull Request Functions ──────────────────────────────────────────────────

export async function createPullRequest(owner, repo, prData) {
  return githubRequest("POST", `/repos/${owner}/${repo}/pulls`, prData);
}

export async function listPullRequests(owner, repo, options = {}) {
  const state = options.state || "open";
  return githubPaginate(`/repos/${owner}/${repo}/pulls?state=${state}`, options.limit || 30);
}

export async function getPullRequest(owner, repo, number) {
  return githubRequest("GET", `/repos/${owner}/${repo}/pulls/${number}`);
}

export async function createPRComment(owner, repo, number, body) {
  return githubRequest("POST", `/repos/${owner}/${repo}/issues/${number}/comments`, { body });
}

export async function createBranch(owner, repo, branch, baseRef) {
  const baseResult = await githubRequest("GET", `/repos/${owner}/${repo}/git/ref/heads/${baseRef}`);
  if (!baseResult.ok) return baseResult;

  const sha = baseResult.data.object.sha;
  return githubRequest("POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha,
  });
}

export async function getFileContent(owner, repo, filePath, branch) {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  return githubRequest("GET", `/repos/${owner}/${repo}/contents/${filePath}${ref}`);
}
