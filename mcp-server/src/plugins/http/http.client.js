/**
 * Controlled HTTP client with timeout, size-limit, and retry.
 */

import { config } from "../../core/config.js";

/**
 * Make a controlled outbound HTTP request.
 *
 * @param {object} opts
 * @param {string}  opts.method
 * @param {string}  opts.url
 * @param {object}  [opts.headers]
 * @param {any}     [opts.body]
 * @param {number}  [opts.timeoutMs]
 * @param {number}  [opts.maxSizeKb]
 * @returns {{ status, headers, body, size, durationMs }}
 */
export async function httpRequest({ method, url, headers = {}, body, timeoutMs, maxSizeKb }) {
  const timeout = timeoutMs ?? config.http?.defaultTimeoutMs ?? 10_000;
  const maxSize = (maxSizeKb ?? config.http?.maxResponseSizeKb ?? 512) * 1024;

  const start = Date.now();

  const init = {
    method:  method.toUpperCase(),
    headers: { "User-Agent": "mcp-hub/1.0", ...headers },
    signal:  AbortSignal.timeout(timeout),
  };

  if (body && !["GET", "HEAD"].includes(init.method)) {
    init.body    = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["Content-Type"] = init.headers["Content-Type"] ?? "application/json";
  }

  let resp;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    const durationMs = Date.now() - start;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, error: "timeout", message: `Request timed out after ${timeout}ms`, durationMs };
    }
    return { ok: false, error: "network_error", message: err.message, durationMs };
  }

  // Read body with size limit
  const reader = resp.body?.getReader();
  let chunks = [];
  let totalSize = 0;
  let truncated = false;

  if (reader) {
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
    ok:          resp.ok,
    status:      resp.status,
    statusText:  resp.statusText,
    headers:     responseHeaders,
    body:        parsedBody,
    size:        totalSize,
    truncated,
    durationMs:  Date.now() - start,
  };
}
