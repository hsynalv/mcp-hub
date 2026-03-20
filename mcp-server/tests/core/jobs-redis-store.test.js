/**
 * Redis job store schema: cancelled set, queue lrem, getStats, list filters.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RedisJobStore } from "../../src/core/jobs.redis.js";

/** Minimal ioredis-shaped fake for RedisJobStore unit tests. */
class FakeRedis {
  constructor() {
    /** @type {Map<string, Record<string, string>>} */
    this.hashes = new Map();
    /** @type {Map<string, string[]>} */
    this.lists = new Map();
    /** @type {Map<string, Set<string>>} */
    this.sets = new Map();
    /** @type {Map<string, Map<string, number>>} */
    this.zsets = new Map();
  }

  _list(k) {
    if (!this.lists.has(k)) this.lists.set(k, []);
    return this.lists.get(k);
  }

  _set(k) {
    if (!this.sets.has(k)) this.sets.set(k, new Set());
    return this.sets.get(k);
  }

  _z(k) {
    if (!this.zsets.has(k)) this.zsets.set(k, new Map());
    return this.zsets.get(k);
  }

  on() {}

  async hset(key, ...rest) {
    const base = { ...(this.hashes.get(key) || {}) };
    if (rest.length === 1 && typeof rest[0] === "object" && rest[0] !== null && !Array.isArray(rest[0])) {
      Object.assign(base, rest[0]);
    } else {
      for (let i = 0; i < rest.length; i += 2) {
        base[String(rest[i])] = String(rest[i + 1]);
      }
    }
    this.hashes.set(key, base);
    return Object.keys(base).length;
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async del(key) {
    if (!this.hashes.has(key)) return 0;
    this.hashes.delete(key);
    return 1;
  }

  async lrem(key, count, value) {
    const list = this._list(key);
    if (count === 0) {
      const next = list.filter((x) => x !== value);
      const n = list.length - next.length;
      this.lists.set(key, next);
      return n;
    }
    let removed = 0;
    const next = [];
    for (const x of list) {
      if (x === value && removed < Math.abs(count)) {
        removed++;
      } else {
        next.push(x);
      }
    }
    this.lists.set(key, next);
    return removed;
  }

  async rpush(key, val) {
    const list = this._list(key);
    list.push(val);
    return list.length;
  }

  async lpop(key) {
    const list = this._list(key);
    return list.shift() ?? null;
  }

  async llen(key) {
    return this._list(key).length;
  }

  async lrange(key, start, stop) {
    const list = this._list(key);
    if (stop === -1) return list.slice(start);
    return list.slice(start, stop + 1);
  }

  async lpush(key, ...vals) {
    const list = this._list(key);
    for (let i = vals.length - 1; i >= 0; i--) list.unshift(vals[i]);
    return list.length;
  }

  async ltrim(key, start, stop) {
    const list = this._list(key);
    const end = stop < 0 ? list.length + stop : stop;
    this.lists.set(key, list.slice(start, end + 1));
    return "OK";
  }

  async sadd(key, ...members) {
    const s = this._set(key);
    let a = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        a++;
      }
    }
    return a;
  }

  async srem(key, ...members) {
    const s = this._set(key);
    let n = 0;
    for (const m of members) {
      if (s.delete(m)) n++;
    }
    return n;
  }

  async smembers(key) {
    return [...this._set(key)];
  }

  async scard(key) {
    return this._set(key).size;
  }

  async zadd(key, score, member) {
    this._z(key).set(member, score);
    return 1;
  }

  async zcard(key) {
    return this._z(key).size;
  }

  async zrevrange(key, start, stop) {
    const zm = this._z(key);
    const sorted = [...zm.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    if (stop < 0) return sorted.slice(start);
    return sorted.slice(start, stop + 1);
  }

  async zrangebyscore(key, min, max) {
    const zm = this._z(key);
    return [...zm.entries()].filter(([, sc]) => sc >= min && sc <= max).map(([m]) => m);
  }

  async zremrangebyscore(key, min, max) {
    const zm = this._z(key);
    let removed = 0;
    for (const [m, sc] of [...zm.entries()]) {
      if (sc >= min && sc <= max) {
        zm.delete(m);
        removed++;
      }
    }
    return removed;
  }

  async zrem(key, ...members) {
    const zm = this._z(key);
    let n = 0;
    for (const m of members) {
      if (zm.delete(m)) n++;
    }
    return n;
  }

  async expire() {
    return 1;
  }

  async publish() {
    return 0;
  }

  async disconnect() {}
}

function baseJob(id) {
  const now = new Date().toISOString();
  return {
    id,
    type: "test.job",
    state: "queued",
    payload: {},
    context: { workspaceId: "w", invokeSource: "internal" },
    progress: 0,
    logs: [],
    result: null,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

describe("RedisJobStore schema / stats", () => {
  let redis;
  let store;

  beforeEach(() => {
    redis = new FakeRedis();
    store = new RedisJobStore({ redis, keyPrefix: "ut:" });
  });

  it("cancel queued job: cancelled count matches, failed excludes cancellations", async () => {
    const j = baseJob("c-q");
    await store.enqueue(j);
    expect((await store.getStats()).queued).toBe(1);
    expect((await store.getStats()).cancelled).toBe(0);

    await store.markCancelled(j.id);
    const s = await store.getStats();
    expect(s.queued).toBe(0);
    expect(s.cancelled).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.running).toBe(0);
  });

  it("cancel running job: same stats semantics", async () => {
    const j = baseJob("c-r");
    await store.enqueue(j);
    const started = new Date().toISOString();
    await store.set(j.id, { ...j, state: "running", startedAt: started });
    await redis.sadd("ut:jobs:running", j.id);
    await store.removeFromQueue(j.id);
    expect((await store.getStats()).queued).toBe(0);
    expect((await store.getStats()).running).toBe(1);

    await store.markCancelled(j.id);
    const s = await store.getStats();
    expect(s.running).toBe(0);
    expect(s.cancelled).toBe(1);
    expect(s.failed).toBe(0);
  });

  it("orphan-style markFailed: failed not cancelled", async () => {
    const j = baseJob("f-1");
    await store.enqueue(j);
    await store.set(j.id, { ...j, state: "running", startedAt: new Date().toISOString() });
    await redis.sadd("ut:jobs:running", j.id);
    await store.removeFromQueue(j.id);

    await store.markFailed(j.id, "boom");
    const s = await store.getStats();
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(0);
    expect(s.running).toBe(0);
  });

  it("removeFromQueue drops queued length when job starts", async () => {
    const j = baseJob("run-1");
    await store.enqueue(j);
    expect((await store.getStats()).queued).toBe(1);
    await store.removeFromQueue(j.id);
    expect((await store.getStats()).queued).toBe(0);
  });

  it("list state=failed returns only failed hash state", async () => {
    const a = baseJob("fa");
    const b = baseJob("fb");
    await store.enqueue(a);
    await store.enqueue(b);
    await store.markFailed(a.id, "e1");
    await store.markCancelled(b.id);

    const failedList = await store.list({ state: "failed", limit: 20 });
    expect(failedList.every((x) => x.state === "failed")).toBe(true);
    expect(failedList.some((x) => x.id === a.id)).toBe(true);

    const cancelledList = await store.list({ state: "cancelled", limit: 20 });
    expect(cancelledList.every((x) => x.state === "cancelled")).toBe(true);
    expect(cancelledList.some((x) => x.id === b.id)).toBe(true);
  });

  it("cleanupOldJobs drops pruned failed ids from cancelled set", async () => {
    const j = baseJob("old");
    const ancient = 1000;
    await store.markCancelled(j.id);
    const zm = redis.zsets.get("ut:jobs:failed");
    zm.set(j.id, ancient);

    await store.cleanupOldJobs(0.000001);

    expect(redis.sets.get("ut:jobs:cancelled")?.has(j.id)).toBeFalsy();
    expect((await store.getStats()).cancelled).toBe(0);
  });
});
