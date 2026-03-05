/**
 * Minimal GitHub REST API v3 client.
 * Docs: https://docs.github.com/en/rest
 *
 * Supports both classic and fine-grained personal access tokens.
 * Works with public repos without a token; private repos require GITHUB_TOKEN.
 */

import { withResilience, withRetry, getCircuitBreaker } from "../../core/resilience.js";
import { isRetryableError } from "../../core/error-categories.js";

const BASE_URL = "https://api.github.com";

function getToken() {
  return process.env.GITHUB_TOKEN ?? "";
}

/**
 * Make a request to the GitHub API.
 *
 * @param {"GET"|"POST"|"PATCH"} method
 * @param {string} path  e.g. "/repos/owner/repo"
 * @param {object|null} body
 * @returns {Promise<{ ok: boolean, data?: any, error?: string, details?: object }>}
 */
export async function githubRequest(method, path, body = null) {
  return githubRequestWithResilience(method, path, body);
}

async function githubRequestInternal(method, path, body = null) {
  const token = getToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcp-hub/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // 204 No Content
    if (res.status === 204) return { ok: true, data: null };

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: classifyError(res.status),
        details: {
          status: res.status,
          message: json.message ?? JSON.stringify(json),
        },
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

/**
 * Paginate a GitHub list endpoint automatically (up to maxPages).
 * GitHub returns Link headers for cursor-based pagination.
 */
/**
 * Paginate with resilience
 */
async function githubPaginateWithResilience(path, maxItems = 100) {
  const circuit = getCircuitBreaker("github", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  });

  return circuit.execute(async () => {
    return withRetry(
      async () => {
        const result = await githubPaginateInternal(path, maxItems);
        if (!result.ok) {
          const error = new Error(result.error || "GitHub pagination error");
          error.status = result.details?.status;
          throw error;
        }
        return result;
      },
      {
        maxAttempts: 3,
        backoffMs: 1000,
        retryableError: (err) => {
          if (err.status === 401 || err.status === 403) return false;
          return isRetryableError(err);
        },
      }
    );
  });
}

export async function githubPaginate(path, maxItems = 100) {
  return githubPaginateWithResilience(path, maxItems);
}

async function githubPaginateInternal(path, maxItems = 100) {
  const token = getToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcp-hub/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const perPage = Math.min(maxItems, 100);
  let url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}per_page=${perPage}`;
  const allItems = [];

  while (url && allItems.length < maxItems) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return {
          ok: false,
          error: classifyError(res.status),
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

  return { ok: true, data: allItems.slice(0, maxItems) };
}

function classifyError(status) {
  if (status === 401) return "github_auth_error";
  if (status === 403) return "github_forbidden";
  if (status === 404) return "github_not_found";
  if (status === 422) return "github_validation_error";
  if (status === 429) return "github_rate_limited";
  return "github_api_error";
}

// ── Pull Request Functions ──────────────────────────────────────────────────

/**
 * Create a pull request
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {Object} prData - PR data
 * @returns {Promise<Object>}
 */
export async function createPullRequest(owner, repo, prData) {
  const path = `/repos/${owner}/${repo}/pulls`;
  return githubRequest("POST", path, prData);
}

/**
 * List pull requests
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {Object} options - Query options
 * @returns {Promise<Object>}
 */
export async function listPullRequests(owner, repo, options = {}) {
  const state = options.state || "open";
  const path = `/repos/${owner}/${repo}/pulls?state=${state}`;
  return githubPaginate(path, options.limit || 30);
}

/**
 * Get a single pull request
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {number} number - PR number
 * @returns {Promise<Object>}
 */
export async function getPullRequest(owner, repo, number) {
  const path = `/repos/${owner}/${repo}/pulls/${number}`;
  return githubRequest("GET", path);
}

/**
 * Create PR comment
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {number} number - PR number
 * @param {string} body - Comment body
 * @returns {Promise<Object>}
 */
export async function createPRComment(owner, repo, number, body) {
  const path = `/repos/${owner}/${repo}/issues/${number}/comments`;
  return githubRequest("POST", path, { body });
}

/**
 * Create a branch
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} branch - New branch name
 * @param {string} baseRef - Base ref (branch or SHA)
 * @returns {Promise<Object>}
 */
export async function createBranch(owner, repo, branch, baseRef) {
  // First get the base ref SHA
  const basePath = `/repos/${owner}/${repo}/git/ref/heads/${baseRef}`;
  const baseResult = await githubRequest("GET", basePath);

  if (!baseResult.ok) return baseResult;

  const sha = baseResult.data.object.sha;

  // Create the new reference
  const refPath = `/repos/${owner}/${repo}/git/refs`;
  return githubRequest("POST", refPath, {
    ref: `refs/heads/${branch}`,
    sha,
  });
}
