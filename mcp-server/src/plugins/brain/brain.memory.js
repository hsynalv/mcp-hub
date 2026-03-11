/**
 * Brain Memory Layer
 * Manages episodic memories, user profile, project registry,
 * session working memory, and file-system snapshots in Redis.
 *
 * All keys are namespaced by BRAIN_NAMESPACE (default "default")
 * so multiple users or environments can coexist in the same Redis instance.
 */

import { randomUUID } from "crypto";
import { getRedis } from "../../core/redis.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const NS              = process.env.BRAIN_NAMESPACE || process.env.BRAIN_USER_ID || "default";
const MEM_TTL_SECONDS = parseInt(process.env.BRAIN_MEM_TTL_DAYS    || "365", 10) * 86_400;
const SES_TTL_SECONDS = parseInt(process.env.BRAIN_SESSION_TTL_HOURS || "24", 10) * 3_600;

// Importance half-life in days: importance decays to 50 % after this many days.
// Set to 0 to disable decay entirely.
export const IMPORTANCE_HALF_LIFE_DAYS = parseInt(
  process.env.BRAIN_IMPORTANCE_HALF_LIFE_DAYS || "180", 10,
);

// ── Key helpers ───────────────────────────────────────────────────────────────

export const NAMESPACE    = NS;
const PROFILE_KEY         = `brain:${NS}:profile`;
const MEM_INDEX_KEY       = `brain:${NS}:mem:index`;      // Redis Set of all memory IDs
const PROJECT_INDEX_KEY   = `brain:${NS}:project:index`; // Redis Set of all project slugs
const FS_SNAPSHOT_KEY     = `brain:${NS}:fs:snapshot`;

export const memKey     = (id)   => `brain:${NS}:mem:${id}`;
export const projectKey = (slug) => `brain:${NS}:project:${slug}`;
export const sessionKey = (id)   => `brain:${NS}:session:${id}`;

const THOUGHTS_LIST_KEY = `brain:${NS}:thoughts`;
const THOUGHTS_MAX      = 10;
const THOUGHTS_TTL_SEC  = 3600; // 1 hour

// ── Importance decay ──────────────────────────────────────────────────────────

/**
 * Apply temporal decay to an importance score.
 * After IMPORTANCE_HALF_LIFE_DAYS the score halves, but never drops below 30 %
 * of its original value (high-importance memories stay relevant).
 */
export function decayedImportance(importance, createdAt) {
  if (!IMPORTANCE_HALF_LIFE_DAYS) return importance;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  const decay   = Math.pow(0.5, ageDays / IMPORTANCE_HALF_LIFE_DAYS);
  return importance * (0.3 + 0.7 * decay);
}

/**
 * Compute a combined ranking score for recall.
 * semanticScore:  0–1 from RAG cosine similarity (already incorporates text relevance)
 * importance:     0–1 original user/agent score
 * createdAt:      ISO string for recency calculation
 */
export function recallScore(semanticScore, importance, createdAt) {
  const ageMs  = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / 86_400_000;
  const recency = Math.exp(-ageDays / 90); // ~0 after ~270 days
  return semanticScore * 0.5 + importance * 0.3 + recency * 0.2;
}

// ── User Profile ──────────────────────────────────────────────────────────────

export async function getProfile() {
  return (await getRedis().hgetall(PROFILE_KEY)) ?? {};
}

export async function updateProfile(fields) {
  if (!fields || Object.keys(fields).length === 0) return getProfile();
  await getRedis().hset(PROFILE_KEY, ...Object.entries(fields).flat());
  return getRedis().hgetall(PROFILE_KEY);
}

// ── Episodic Memories ─────────────────────────────────────────────────────────

/**
 * Persist a new memory entry.
 * Memory types: fact | decision | preference | event | project_note
 */
export async function addMemory({
  content,
  type       = "fact",
  tags       = [],
  projectId  = null,
  importance = 0.5,
  confidence = 1.0,
  source     = "user",
}) {
  const r   = getRedis();
  const id  = randomUUID();
  const now = new Date().toISOString();

  const mem = {
    id,
    content,
    type,
    tags:       Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean),
    projectId:  projectId || null,
    importance: Math.max(0, Math.min(1, parseFloat(importance) || 0.5)),
    confidence: Math.max(0, Math.min(1, parseFloat(confidence) || 1.0)),
    source,
    createdAt:  now,
    updatedAt:  now,
  };

  await r.setex(memKey(id), MEM_TTL_SECONDS, JSON.stringify(mem));
  await r.sadd(MEM_INDEX_KEY, id);
  return mem;
}

/** Fetch a single memory by ID. Returns null if missing or expired. */
export async function getMemory(id) {
  const raw = await getRedis().get(memKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Update specific fields of an existing memory.
 * Resets the TTL on the updated entry.
 */
export async function updateMemory(id, fields) {
  const r        = getRedis();
  const existing = await getMemory(id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...fields,
    id,               // id is immutable
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    importance: fields.importance !== undefined
      ? Math.max(0, Math.min(1, parseFloat(fields.importance) || existing.importance))
      : existing.importance,
    confidence: fields.confidence !== undefined
      ? Math.max(0, Math.min(1, parseFloat(fields.confidence) || existing.confidence))
      : existing.confidence,
  };

  await r.setex(memKey(id), MEM_TTL_SECONDS, JSON.stringify(updated));
  return updated;
}

/** Delete a memory entry and remove it from the index. */
export async function deleteMemory(id) {
  await getRedis().del(memKey(id));
  await getRedis().srem(MEM_INDEX_KEY, id);
  return { deleted: true, id };
}

/**
 * List memories with optional filters and pagination.
 * Automatically cleans up expired (TTL-evicted) index entries.
 *
 * @param {{ type?, projectId?, tags?, limit?, offset? }} opts
 */
export async function listMemories({
  type, projectId, tags,
  limit  = 50,
  offset = 0,
} = {}) {
  const r   = getRedis();
  const ids = await r.smembers(MEM_INDEX_KEY);

  const mems = [];
  for (const id of ids) {
    const raw = await r.get(memKey(id));
    if (!raw) {
      await r.srem(MEM_INDEX_KEY, id); // clean stale index entry
      continue;
    }
    let m;
    try { m = JSON.parse(raw); } catch { continue; }

    if (type      && m.type      !== type)                         continue;
    if (projectId && m.projectId !== projectId)                    continue;
    if (tags?.length && !tags.some(t => m.tags?.includes(t)))     continue;

    // Attach decayed importance for sorting (don't persist it)
    m._decayed = decayedImportance(m.importance, m.createdAt);
    mems.push(m);
  }

  mems.sort((a, b) =>
    b._decayed !== a._decayed
      ? b._decayed - a._decayed
      : new Date(b.createdAt) - new Date(a.createdAt),
  );

  // Remove internal field before returning
  const page = mems.slice(offset, offset + limit);
  return page.map(({ _decayed, ...m }) => m);
}

/**
 * Return memory statistics (counts by type, age distribution, etc.)
 */
export async function getMemoryStats() {
  const r   = getRedis();
  const ids = await r.smembers(MEM_INDEX_KEY);

  const byType      = {};
  const byProject   = {};
  let   total       = 0;
  let   oldest      = null;
  let   newest      = null;

  for (const id of ids) {
    const raw = await r.get(memKey(id));
    if (!raw) { await r.srem(MEM_INDEX_KEY, id); continue; }
    let m;
    try { m = JSON.parse(raw); } catch { continue; }

    total++;
    byType[m.type]     = (byType[m.type]    || 0) + 1;
    if (m.projectId) byProject[m.projectId] = (byProject[m.projectId] || 0) + 1;

    if (!oldest || m.createdAt < oldest) oldest = m.createdAt;
    if (!newest || m.createdAt > newest) newest = m.createdAt;
  }

  return { total, byType, byProject, oldest, newest };
}

// ── Project Registry ──────────────────────────────────────────────────────────

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function registerProject({
  name,
  path: fsPath   = "",
  stack          = "",
  status         = "active",
  description    = "",
  githubRepo     = "",
  notionPageId   = "",
}) {
  const r    = getRedis();
  const slug = slugify(name);
  const now  = new Date().toISOString();

  const existing = (await r.hgetall(projectKey(slug))) ?? {};
  const project  = {
    slug,
    name,
    path:         fsPath        || existing.path         || "",
    stack:        stack         || existing.stack         || "",
    status:       status        || existing.status        || "active",
    description:  description   || existing.description   || "",
    githubRepo:   githubRepo    || existing.githubRepo    || "",
    notionPageId: notionPageId  || existing.notionPageId  || "",
    createdAt:    existing.createdAt || now,
    updatedAt:    now,
  };

  await r.hset(projectKey(slug), ...Object.entries(project).flat());
  await r.sadd(PROJECT_INDEX_KEY, slug);
  return project;
}

export async function getProject(slug) {
  const data = await getRedis().hgetall(projectKey(slug));
  return data?.name ? data : null;
}

export async function updateProject(slug, fields) {
  const r        = getRedis();
  const existing = await r.hgetall(projectKey(slug));
  if (!existing?.name) return null;
  const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
  await r.hset(projectKey(slug), ...Object.entries(updated).flat());
  return updated;
}

export async function listProjects(status) {
  const r     = getRedis();
  const slugs = await r.smembers(PROJECT_INDEX_KEY);
  const projects = [];
  for (const slug of slugs) {
    const p = await r.hgetall(projectKey(slug));
    if (!p?.name) continue;
    if (status && p.status !== status) continue;
    projects.push(p);
  }
  return projects.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export async function getProjectStats() {
  const all = await listProjects();
  const byStatus = {};
  for (const p of all) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }
  return { total: all.length, byStatus };
}

// ── Reasoning scratchpad (Devin-style <think>) ───────────────────────────────────

/**
 * Append a private thought (reasoning scratchpad). Not shown to user.
 * Stored in Redis list with TTL; used by buildContext when includeThoughts is true.
 */
export async function pushThought(thought, context = "") {
  const r = getRedis();
  const entry = JSON.stringify({
    thought: String(thought).slice(0, 2000),
    context: String(context).slice(0, 200) || null,
    at: new Date().toISOString(),
  });
  await r.rpush(THOUGHTS_LIST_KEY, entry);
  await r.ltrim(THOUGHTS_LIST_KEY, -THOUGHTS_MAX, -1);
  await r.expire(THOUGHTS_LIST_KEY, THOUGHTS_TTL_SEC);
}

/**
 * Get the most recent thoughts (for LLM context injection).
 */
export async function getRecentThoughts(limit = 5) {
  const r = getRedis();
  const raw = await r.lrange(THOUGHTS_LIST_KEY, -limit, -1);
  const out = [];
  for (const s of raw) {
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return out.reverse();
}

// ── Session Working Memory ────────────────────────────────────────────────────

export async function getSession(sessionId) {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setSession(sessionId, data) {
  const session = { sessionId, ...data, updatedAt: new Date().toISOString() };
  await getRedis().setex(sessionKey(sessionId), SES_TTL_SECONDS, JSON.stringify(session));
  return session;
}

export async function clearSession(sessionId) {
  await getRedis().del(sessionKey(sessionId));
}

// ── File System Snapshot ──────────────────────────────────────────────────────

export async function setFsSnapshot(snapshot) {
  await getRedis().set(FS_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export async function getFsSnapshot() {
  const raw = await getRedis().get(FS_SNAPSHOT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
