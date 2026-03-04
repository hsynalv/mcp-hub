/**
 * Caching module — unified cache interface with TTL support.
 *
 * PR-7: Caching standard — tek library
 * - In-memory LRU cache with TTL
 * - Used by plugins for external API caching
 * - Configurable max size and default TTL
 */

const DEFAULT_TTL_MS = 60_000; // 1 minute
const DEFAULT_MAX_SIZE = 1000;

class Cache {
  constructor(options = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL_MS;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.store = new Map();
    this.accessOrder = [];
  }

  _makeKey(key) {
    return typeof key === "string" ? key : JSON.stringify(key);
  }

  _touch(key) {
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  _evictIfNeeded() {
    while (this.store.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      this.store.delete(oldest);
    }
  }

  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  get(key) {
    const k = this._makeKey(key);
    const entry = this.store.get(k);

    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.delete(k);
      return undefined;
    }

    this._touch(k);
    return entry.value;
  }

  set(key, value, ttlMs) {
    const k = this._makeKey(key);

    this._evictIfNeeded();

    const entry = {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttl),
    };

    this.store.set(k, entry);
    this._touch(k);
    return this;
  }

  delete(key) {
    const k = this._makeKey(key);
    this.store.delete(k);
    const idx = this.accessOrder.indexOf(k);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
    }
    return this;
  }

  has(key) {
    const k = this._makeKey(key);
    const entry = this.store.get(k);

    if (!entry) return false;
    if (this._isExpired(entry)) {
      this.delete(k);
      return false;
    }

    return true;
  }

  clear() {
    this.store.clear();
    this.accessOrder = [];
  }

  size() {
    // Clean expired entries first
    for (const [k, entry] of this.store.entries()) {
      if (this._isExpired(entry)) {
        this.delete(k);
      }
    }
    return this.store.size;
  }

  stats() {
    return {
      size: this.size(),
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }
}

// Global cache instances for different use cases
const caches = new Map();

export function getCache(name, options) {
  if (!caches.has(name)) {
    caches.set(name, new Cache(options));
  }
  return caches.get(name);
}

export function createCache(options) {
  return new Cache(options);
}

export function clearAllCaches() {
  for (const cache of caches.values()) {
    cache.clear();
  }
  caches.clear();
}

export { Cache };
