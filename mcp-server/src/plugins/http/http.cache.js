/**
 * Simple in-memory TTL cache for HTTP responses.
 * Key = method + url + body hash.
 */

import { createHash } from "crypto";

const cache = new Map(); // key → { body, status, headers, cachedAt, ttl }

function makeKey(method, url, body) {
  const bodyStr = body ? JSON.stringify(body) : "";
  return createHash("sha256").update(`${method}:${url}:${bodyStr}`).digest("hex").slice(0, 16);
}

export function getFromCache(method, url, body) {
  const key = makeKey(method, url, body);
  const entry = cache.get(key);
  if (!entry) return null;

  const ageMs = Date.now() - entry.cachedAt;
  if (ageMs > entry.ttl * 1000) {
    cache.delete(key);
    return null;
  }

  return { ...entry, ageSeconds: Math.floor(ageMs / 1000) };
}

export function setInCache(method, url, body, data, ttlSeconds) {
  const key = makeKey(method, url, body);
  cache.set(key, {
    ...data,
    cachedAt: Date.now(),
    ttl:      ttlSeconds,
  });
  return key;
}

export function clearCache() {
  const count = cache.size;
  cache.clear();
  return count;
}

export function getCacheStats() {
  const now = Date.now();
  let fresh = 0, stale = 0;

  for (const entry of cache.values()) {
    if (now - entry.cachedAt < entry.ttl * 1000) fresh++;
    else stale++;
  }

  return { total: cache.size, fresh, stale };
}
