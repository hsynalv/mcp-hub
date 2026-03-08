/**
 * Controlled HTTP client with timeout, size-limit, redirect safety, and retry.
 */

import { config } from "../../core/config.js";
import { validateUrlSafety } from "./security.js";
import { isDomainAllowed } from "./policy.js";

const MAX_REDIRECTS = config.http?.maxRedirects ?? 5;
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

/**
 * Validate redirect URL against security policies
 * @param {string} url - Redirect target URL
 * @returns {{allowed: boolean, reason?: string}}
 */
function validateRedirect(url) {
  // Check URL is valid and not private/internal
  const ssrfCheck = validateUrlSafety(url);
  if (!ssrfCheck.allowed) {
    return { allowed: false, reason: `ssrf_${ssrfCheck.reason}` };
  }

  // Check domain is in allowlist
  if (!isDomainAllowed(url)) {
    return { allowed: false, reason: "redirect_domain_not_allowed" };
  }

  return { allowed: true };
}

/**
 * Make a controlled outbound HTTP request with redirect safety.
 *
 * @param {object} opts
 * @param {string}  opts.method
 * @param {string}  opts.url
 * @param {object}  [opts.headers]
 * @param {any}     [opts.body]
 * @param {number}  [opts.timeoutMs]
 * @param {number}  [opts.maxSizeKb]
 * @param {number}  [opts.maxRedirects]
 * @returns {{ status, headers, body, size, durationMs, redirects?: number, redirectError?: string }}
 */
export async function httpRequest({
  method,
  url,
  headers = {},
  body,
  timeoutMs,
  maxSizeKb,
  maxRedirects = MAX_REDIRECTS,
}) {
  const timeout = timeoutMs ?? config.http?.defaultTimeoutMs ?? 10_000;
  const maxSize = (maxSizeKb ?? config.http?.maxResponseSizeKb ?? 512) * 1024;

  const start = Date.now();
  let currentUrl = url;
  let redirectCount = 0;
  const redirectChain = [];

  while (redirectCount <= maxRedirects) {
    const init = {
      method: redirectCount === 0 ? method.toUpperCase() : "GET", // Redirects usually become GET
      headers: { "User-Agent": "mcp-hub/1.0", ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: "manual", // Handle redirects manually for security
    };

    // Don't send body on redirects (except 307/308 which preserve method/body)
    if (body && redirectCount === 0 && !["GET", "HEAD"].includes(init.method)) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      init.headers["Content-Type"] = init.headers["Content-Type"] ?? "application/json";
    }

    let resp;
    try {
      resp = await fetch(currentUrl, init);
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return {
          ok: false,
          error: "timeout",
          message: `Request timed out after ${timeout}ms`,
          durationMs,
          redirects: redirectCount,
          redirectChain,
        };
      }
      return {
        ok: false,
        error: "network_error",
        message: err.message,
        durationMs,
        redirects: redirectCount,
        redirectChain,
      };
    }

    // Check if this is a redirect
    if (REDIRECT_STATUS_CODES.includes(resp.status)) {
      const location = resp.headers.get("location");
      if (!location) {
        return {
          ok: false,
          error: "redirect_error",
          message: `Redirect response ${resp.status} missing Location header`,
          status: resp.status,
          durationMs: Date.now() - start,
          redirects: redirectCount,
          redirectChain,
        };
      }

      redirectCount++;

      // Check redirect limit
      if (redirectCount > maxRedirects) {
        return {
          ok: false,
          error: "redirect_limit_exceeded",
          message: `Maximum redirects (${maxRedirects}) exceeded`,
          status: resp.status,
          durationMs: Date.now() - start,
          redirects: redirectCount,
          redirectChain: [...redirectChain, location],
        };
      }

      // Resolve relative URLs
      // eslint-disable-next-line no-undef
      const resolvedUrl = new URL(location, currentUrl).toString();

      // Validate redirect target
      const redirectCheck = validateRedirect(resolvedUrl);
      if (!redirectCheck.allowed) {
        return {
          ok: false,
          error: "redirect_blocked",
          message: `Redirect blocked: ${redirectCheck.reason}`,
          redirectUrl: resolvedUrl,
          status: resp.status,
          durationMs: Date.now() - start,
          redirects: redirectCount,
          redirectChain: [...redirectChain, location],
        };
      }

      // Check for redirect loops
      if (redirectChain.includes(resolvedUrl)) {
        return {
          ok: false,
          error: "redirect_loop",
          message: "Redirect loop detected",
          redirectUrl: resolvedUrl,
          status: resp.status,
          durationMs: Date.now() - start,
          redirects: redirectCount,
          redirectChain: [...redirectChain, location],
        };
      }

      redirectChain.push(resolvedUrl);
      currentUrl = resolvedUrl;

      // For 307/308, preserve method and body
      if ([307, 308].includes(resp.status)) {
        // Continue with same method and body
      } else {
        // 301/302/303 typically become GET without body
        body = null;
      }

      continue; // Follow the redirect
    }

    // Not a redirect - read body with size limit
    const reader = resp.body?.getReader();
    const chunks = [];
    let totalSize = 0;
    let truncated = false;

    if (reader) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.byteLength;
        if (totalSize > maxSize) {
          truncated = true;
          reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }

    const raw = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

    // Try to parse JSON
    let parsedBody;
    const ct = resp.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      try { parsedBody = JSON.parse(raw); } catch { parsedBody = raw; }
    } else {
      parsedBody = raw;
    }

    const responseHeaders = {};
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      headers: responseHeaders,
      body: parsedBody,
      size: totalSize,
      truncated,
      durationMs: Date.now() - start,
      redirects: redirectCount,
      redirectChain: redirectCount > 0 ? redirectChain : undefined,
    };
  }

  // Should not reach here, but just in case
  return {
    ok: false,
    error: "redirect_limit_exceeded",
    message: `Maximum redirects (${maxRedirects}) exceeded`,
    durationMs: Date.now() - start,
    redirects: redirectCount,
    redirectChain,
  };
}
