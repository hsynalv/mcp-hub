/**
 * Brain Plugin — Personal AI Memory & Context Engine  v2.1
 *
 * Fixes applied in this version:
 *   fix-1  brain_search_files tool
 *   fix-2  Delete → RAG sync (deleteMemory also removes RAG entry)
 *   fix-3  brain_update_memory + PATCH /brain/memories/:id
 *   fix-4  Memory deduplication (similarity check before addMemory)
 *   fix-5  brain_forget (semantic bulk delete)
 *   fix-6  brain_analyze_habits (LLM pattern extraction)
 *   fix-7  brain_what_do_you_know_about
 *   fix-8  GET /brain/stats + brain_get_stats
 *   fix-9  brain_recall smarter ranking (semantic·0.5 + importance·0.3 + recency·0.2)
 *   fix-10 confidence field on memories
 *   fix-11 Importance temporal decay (listMemories sort + recall)
 *   fix-12 listMemories pagination (offset/limit)
 *   fix-13 brain_list_sessions
 *   fix-14 Multi-tenant namespace (BRAIN_NAMESPACE env var)
 */

import { Router }                                  from "express";
import { z }                                       from "zod";
import { ToolTags, callTool as useTool }           from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler }                from "../../core/error-standard.js";
import { auditLog }                                from "../../core/audit/index.js";
import { requireScope }                            from "../../core/auth.js";
import { checkRedisHealth }                        from "../../core/redis.js";
import { routeTask }                               from "../llm-router/index.js";

import {
  NAMESPACE,
  getProfile, updateProfile,
  addMemory, getMemory, updateMemory, deleteMemory, listMemories,
  getMemoryStats,
  registerProject, getProject, updateProject, listProjects, getProjectStats,
  clearSession,
  setFsSnapshot, getFsSnapshot,
  pushThought,
  recallScore,
} from "./brain.memory.js";

import { buildContext, buildCompactContext } from "./brain.context.js";

// ── Plugin Metadata ───────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name:        "brain",
  version:     "2.1.0",
  description: "Personal AI memory engine: profile, episodic memory, project registry, FS awareness, habit analysis, context assembly",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.MEDIUM,
  capabilities: ["read", "write"],
  requires:    ["REDIS_URL", "OPENAI_API_KEY"],
  tags:        ["memory", "context", "ai", "semantic-kernel"],
  endpoints: [
    { method: "GET",    path: "/brain/health",             description: "Plugin health",               scope: "read"  },
    { method: "GET",    path: "/brain/stats",              description: "Memory + project stats",      scope: "read"  },
    { method: "GET",    path: "/brain/profile",            description: "Get user profile",            scope: "read"  },
    { method: "PUT",    path: "/brain/profile",            description: "Update user profile",         scope: "write" },
    { method: "GET",    path: "/brain/memories",           description: "List / filter memories",      scope: "read"  },
    { method: "POST",   path: "/brain/memories",           description: "Add a memory",                scope: "write" },
    { method: "PATCH",  path: "/brain/memories/:id",       description: "Update a memory",             scope: "write" },
    { method: "DELETE", path: "/brain/memories/:id",       description: "Delete a memory",             scope: "write" },
    { method: "GET",    path: "/brain/projects",           description: "List projects",               scope: "read"  },
    { method: "POST",   path: "/brain/projects",           description: "Register / update project",   scope: "write" },
    { method: "PATCH",  path: "/brain/projects/:slug",     description: "Patch project fields",        scope: "write" },
    { method: "POST",   path: "/brain/context",            description: "Build LLM context block",     scope: "read"  },
    { method: "POST",   path: "/brain/index-filesystem",   description: "Index directory structure",   scope: "write" },
    { method: "POST",   path: "/brain/summarize-session",  description: "Summarize & save session",    scope: "write" },
  ],
});

const handleError = createPluginErrorHandler("brain");

// ── Audit helper ─────────────────────────────────────────────────────────────

async function brainAudit(operation, details = {}) {
  try { await auditLog({ plugin: "brain", operation, namespace: NAMESPACE, ...details }); }
  catch { /* never crash on audit failure */ }
}

// ── Validation Schemas ────────────────────────────────────────────────────────

const memoryCreateSchema = z.object({
  content:    z.string().min(1).max(8_000),
  type:       z.enum(["fact", "decision", "preference", "event", "project_note"]).default("fact"),
  tags:       z.array(z.string()).default([]),
  projectId:  z.string().optional().nullable(),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(1.0),
  source:     z.enum(["user", "agent", "system"]).default("user"),
});

const memoryUpdateSchema = z.object({
  content:    z.string().min(1).max(8_000).optional(),
  type:       z.enum(["fact", "decision", "preference", "event", "project_note"]).optional(),
  tags:       z.array(z.string()).optional(),
  projectId:  z.string().optional().nullable(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const profileSchema  = z.record(z.string());

const projectSchema  = z.object({
  name:         z.string().min(1),
  path:         z.string().optional().default(""),
  stack:        z.string().optional().default(""),
  status:       z.enum(["active", "archived", "paused"]).default("active"),
  description:  z.string().optional().default(""),
  githubRepo:   z.string().optional().default(""),
  notionPageId: z.string().optional().default(""),
});

// ── Deduplication helper ──────────────────────────────────────────────────────

/**
 * Check RAG for a near-duplicate of `content` in brain-memories.
 * Returns the existing memory ID if found (score ≥ threshold), null otherwise.
 * This prevents repeatedly saving the same fact in slightly different words.
 */
async function findDuplicate(content, type, threshold = 0.88) {
  const ragResult = await useTool("rag_search", {
    query:    content,
    limit:    3,
    minScore: threshold,
  }, { workspaceId: "brain-memories" }).catch(() => null);

  if (!ragResult?.ok) return null;

  for (const r of ragResult.data?.results || []) {
    // Only flag as duplicate if the types match or both are generic
    const existing = await getMemory(r.id);
    if (existing && (!type || existing.type === type)) return existing;
  }
  return null;
}

/**
 * Remove a memory from both Redis and the RAG semantic index.
 * Always call this instead of deleteMemory() directly from index.js.
 */
async function deleteMemoryWithRagSync(id) {
  const result = await deleteMemory(id);
  // Sync deletion to RAG — ignore errors (entry may not exist in RAG)
  await useTool("rag_delete", { id }, { workspaceId: "brain-memories" }).catch(() => {});
  return result;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // ── Health ──────────────────────────────────────────────────────────────────

  router.get("/health", async (_req, res) => {
    try {
      const redis    = await checkRedisHealth();
      const llmReady = !!(process.env.OPENAI_API_KEY || process.env.BRAIN_LLM_API_KEY);
      res.json({
        ok:      redis.ok,
        plugin:  "brain",
        version: "2.1.0",
        namespace: NAMESPACE,
        dependencies: {
          redis: redis.ok ? "connected" : `error: ${redis.error}`,
          llm:   llmReady ? "configured" : "missing OPENAI_API_KEY",
        },
      });
    } catch (err) {
      res.status(500).json(handleError(err, "health"));
    }
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  router.get("/stats", requireScope("read"), async (_req, res) => {
    try {
      const [memStats, projStats, snapshot] = await Promise.all([
        getMemoryStats(),
        getProjectStats(),
        getFsSnapshot(),
      ]);
      res.json({
        ok: true,
        data: {
          namespace:  NAMESPACE,
          memories:   memStats,
          projects:   projStats,
          filesystem: snapshot
            ? { indexed: true, indexedAt: snapshot.indexedAt, totalFiles: snapshot.totalFiles, paths: snapshot.paths }
            : { indexed: false },
        },
      });
    } catch (err) {
      res.status(500).json(handleError(err, "stats"));
    }
  });

  // ── Profile ─────────────────────────────────────────────────────────────────

  router.get("/profile", requireScope("read"), async (_req, res) => {
    try {
      res.json({ ok: true, data: await getProfile() });
    } catch (err) {
      res.status(500).json(handleError(err, "get_profile"));
    }
  });

  router.put("/profile", requireScope("write"), async (req, res) => {
    try {
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      const updated = await updateProfile(parsed.data);
      await brainAudit("update_profile", { actor: req.user?.sub });
      res.json({ ok: true, data: updated });
    } catch (err) {
      res.status(500).json(handleError(err, "update_profile"));
    }
  });

  // ── Memories ────────────────────────────────────────────────────────────────

  router.get("/memories", requireScope("read"), async (req, res) => {
    try {
      const { type, projectId, tags, limit, offset } = req.query;
      const mems = await listMemories({
        type:      type      || undefined,
        projectId: projectId || undefined,
        tags:      tags      ? String(tags).split(",").map(t => t.trim()) : undefined,
        limit:     limit     ? parseInt(limit, 10)  : 50,
        offset:    offset    ? parseInt(offset, 10) : 0,
      });
      res.json({ ok: true, data: { total: mems.length, memories: mems } });
    } catch (err) {
      res.status(500).json(handleError(err, "list_memories"));
    }
  });

  router.post("/memories", requireScope("write"), async (req, res) => {
    try {
      const parsed = memoryCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

      // Deduplication: if near-identical memory exists, update it instead
      const duplicate = await findDuplicate(parsed.data.content, parsed.data.type);
      if (duplicate) {
        const updated = await updateMemory(duplicate.id, {
          importance: Math.max(duplicate.importance, parsed.data.importance),
          updatedAt:  new Date().toISOString(),
        });
        return res.status(200).json({ ok: true, data: updated, deduplicated: true });
      }

      const mem = await addMemory(parsed.data);
      await useTool("rag_index", {
        id: mem.id, content: mem.content,
        metadata: { type: mem.type, tags: mem.tags, projectId: mem.projectId, source: "brain" },
      }, { workspaceId: "brain-memories" }).catch(() => {});

      await brainAudit("add_memory", { actor: req.user?.sub, memId: mem.id, type: mem.type });
      res.status(201).json({ ok: true, data: mem });
    } catch (err) {
      res.status(500).json(handleError(err, "add_memory"));
    }
  });

  router.patch("/memories/:id", requireScope("write"), async (req, res) => {
    try {
      const parsed = memoryUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

      const updated = await updateMemory(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Memory not found" } });

      // Re-index in RAG if content changed
      if (parsed.data.content) {
        await useTool("rag_index", {
          id: updated.id, content: updated.content,
          metadata: { type: updated.type, tags: updated.tags, projectId: updated.projectId, source: "brain" },
        }, { workspaceId: "brain-memories" }).catch(() => {});
      }

      await brainAudit("update_memory", { actor: req.user?.sub, memId: req.params.id });
      res.json({ ok: true, data: updated });
    } catch (err) {
      res.status(500).json(handleError(err, "update_memory"));
    }
  });

  router.delete("/memories/:id", requireScope("write"), async (req, res) => {
    try {
      const result = await deleteMemoryWithRagSync(req.params.id);
      await brainAudit("delete_memory", { actor: req.user?.sub, memId: req.params.id });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json(handleError(err, "delete_memory"));
    }
  });

  // ── Projects ────────────────────────────────────────────────────────────────

  router.get("/projects", requireScope("read"), async (req, res) => {
    try {
      const projects = await listProjects(req.query.status || undefined);
      res.json({ ok: true, data: { total: projects.length, projects } });
    } catch (err) {
      res.status(500).json(handleError(err, "list_projects"));
    }
  });

  router.post("/projects", requireScope("write"), async (req, res) => {
    try {
      const parsed = projectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      const project = await registerProject(parsed.data);
      await brainAudit("register_project", { actor: req.user?.sub, projectName: project.name });
      res.status(201).json({ ok: true, data: project });
    } catch (err) {
      res.status(500).json(handleError(err, "register_project"));
    }
  });

  router.patch("/projects/:slug", requireScope("write"), async (req, res) => {
    try {
      const updated = await updateProject(req.params.slug, req.body);
      if (!updated) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Project not found" } });
      await brainAudit("update_project", { actor: req.user?.sub, slug: req.params.slug });
      res.json({ ok: true, data: updated });
    } catch (err) {
      res.status(500).json(handleError(err, "update_project"));
    }
  });

  // ── Context Builder ─────────────────────────────────────────────────────────

  router.post("/context", requireScope("read"), async (req, res) => {
    try {
      const { task, projectId, includeFs, maxMemories, maxChars, compact } = req.body;
      const ctx = compact
        ? { contextBlock: await buildCompactContext({ task, projectId, includeFs, maxMemories, maxChars }) }
        : await buildContext({ task, projectId, includeFs, maxMemories });
      res.json({ ok: true, data: ctx });
    } catch (err) {
      res.status(500).json(handleError(err, "get_context"));
    }
  });

  // ── File System Indexing ────────────────────────────────────────────────────

  router.post("/index-filesystem", requireScope("write"), async (req, res) => {
    try {
      const { paths = [], maxDepth = 4, workspaceId = "brain-fs" } = req.body;
      if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ ok: false, error: { code: "validation", message: "`paths` must be a non-empty array" } });
      }
      const result = await indexFilesystem({ paths, maxDepth, workspaceId });
      await brainAudit("index_filesystem", { actor: req.user?.sub, paths, totalFiles: result.totalFiles });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json(handleError(err, "index_filesystem"));
    }
  });

  // ── Session Summarizer ──────────────────────────────────────────────────────

  router.post("/summarize-session", requireScope("write"), async (req, res) => {
    try {
      const { sessionId, messages = [], projectId } = req.body;
      if (!sessionId) return res.status(400).json({ ok: false, error: { code: "validation", message: "`sessionId` is required" } });
      const result = await summarizeAndSaveSession({ sessionId, messages, projectId });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json(handleError(err, "summarize_session"));
    }
  });

  app.use("/brain", router);
}

// ── Shared Logic ──────────────────────────────────────────────────────────────

async function indexFilesystem({ paths, maxDepth = 4, workspaceId = "brain-fs" }) {
  const indexed    = [];
  let   totalFiles = 0;

  for (const dir of paths) {
    const findResult = await useTool("shell_execute", {
      command:     `find "${dir}" -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' -not -path '*/dist/*'`,
      explanation: `Index filesystem structure for brain: ${dir}`,
    });

    if (!findResult.ok) continue;

    const lines = (findResult.data?.output || "")
      .split("\n").map(l => l.trim()).filter(Boolean);

    totalFiles += lines.length;
    if (lines.length === 0) continue;

    const summary = `## ${dir}\n\n` + lines.slice(0, 500).join("\n");

    await useTool("rag_index", {
      id:      `fs:${Buffer.from(dir).toString("base64url")}`,
      content: summary,
      metadata: { sourceName: dir, sourceType: "filesystem", title: `FS: ${dir}` },
    }, { workspaceId }).catch(() => {});

    indexed.push({ path: dir, fileCount: lines.length });
  }

  const snapshot = {
    indexedAt:   new Date().toISOString(),
    paths, totalFiles, workspaceId,
    summary: indexed.map(e => `${e.path} (${e.fileCount} entries)`).join("\n"),
  };
  await setFsSnapshot(snapshot);
  return { indexed, totalFiles, snapshot };
}

async function summarizeAndSaveSession({ sessionId, messages, projectId }) {
  const transcript = messages
    .map(m => `${m.role?.toUpperCase() || "USER"}: ${m.content}`)
    .join("\n");

  if (!transcript.trim()) return { saved: false, reason: "No messages to summarize" };

  const prompt = `Summarize this conversation into key facts, decisions, and action items. Be concise (max 5 bullet points).\n\n${transcript.slice(0, 12_000)}`;

  let summary = "";
  try {
    const llmResult = await routeTask("summarize", prompt, { maxTokens: 400 });
    summary = llmResult?.content ?? "";
  } catch {
    summary = transcript.slice(0, 500) + (transcript.length > 500 ? "..." : "");
  }

  if (!summary.trim()) return { saved: false, reason: "LLM returned empty summary" };

  const mem = await addMemory({
    content:   summary,
    type:      "event",
    tags:      ["session-summary"],
    projectId: projectId || null,
    importance: 0.6,
    source:    "agent",
  });

  await useTool("rag_index", {
    id: mem.id, content: mem.content,
    metadata: { type: "session-summary", sessionId, projectId: projectId || null, source: "brain" },
  }, { workspaceId: "brain-memories" }).catch(() => {});

  await clearSession(sessionId);
  await brainAudit("summarize_session", { sessionId, projectId, memId: mem.id });
  return { saved: true, memoryId: mem.id, summary };
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [

  // ── brain_remember ─────────────────────────────────────────────────────────
  {
    name: "brain_remember",
    description: "Persist a fact, decision, preference, or event to long-term memory. Automatically deduplicates: if a very similar memory already exists, it updates the existing one instead of creating a duplicate.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        content:    { type: "string",  description: "What to remember (up to 8000 chars)" },
        type:       { type: "string",  enum: ["fact", "decision", "preference", "event", "project_note"], default: "fact" },
        tags:       { type: "array",   items: { type: "string" }, default: [] },
        projectId:  { type: "string",  description: "Slug of the associated project (optional)" },
        importance: { type: "number",  minimum: 0, maximum: 1, default: 0.5, description: "Importance 0–1. Use 0.9–1.0 for critical facts that must never be forgotten." },
        confidence: { type: "number",  minimum: 0, maximum: 1, default: 1.0, description: "How certain is this fact? 0=guess, 1=definite" },
        source:     { type: "string",  enum: ["user", "agent", "system"], default: "agent" },
      },
      required: ["content"],
    },
    handler: async (args) => {
      try {
        // fix-4: Deduplication check
        const duplicate = await findDuplicate(args.content, args.type || "fact");
        if (duplicate) {
          const updated = await updateMemory(duplicate.id, {
            importance: Math.max(duplicate.importance, args.importance ?? 0.5),
          });
          return { ok: true, data: { id: updated.id, saved: true, deduplicated: true, type: updated.type } };
        }

        const mem = await addMemory({
          content:    args.content,
          type:       args.type       || "fact",
          tags:       args.tags       || [],
          projectId:  args.projectId  || null,
          importance: args.importance ?? 0.5,
          confidence: args.confidence ?? 1.0,
          source:     args.source     || "agent",
        });

        // fix-1 prerequisite: index in RAG for semantic recall
        await useTool("rag_index", {
          id: mem.id, content: mem.content,
          metadata: { type: mem.type, tags: mem.tags, projectId: mem.projectId, source: "brain" },
        }, { workspaceId: "brain-memories" }).catch(() => {});

        return { ok: true, data: { id: mem.id, saved: true, deduplicated: false, type: mem.type } };
      } catch (err) {
        return { ok: false, error: { code: "brain_remember_failed", message: err.message } };
      }
    },
  },

  // ── brain_recall ───────────────────────────────────────────────────────────
  {
    name: "brain_recall",
    description: "Search long-term memory using semantic similarity plus optional filters. Uses a combined ranking: semantic score × 0.5 + importance × 0.3 + recency × 0.2.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string",  description: "What you want to recall" },
        type:      { type: "string",  enum: ["fact", "decision", "preference", "event", "project_note"], description: "Filter by type (optional)" },
        projectId: { type: "string",  description: "Filter by project slug (optional)" },
        tags:      { type: "array",   items: { type: "string" }, description: "Filter by tags (any match)" },
        limit:     { type: "number",  default: 10, description: "Max results" },
        minScore:  { type: "number",  default: 0.1, description: "Min RAG similarity score" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const limit = Math.min(args.limit || 10, 50);

        // Semantic search (fix-9: use actual score for ranking later)
        const ragResult = await useTool("rag_search", {
          query:    args.query,
          limit:    limit * 2,
          minScore: args.minScore ?? 0.1,
        }, { workspaceId: "brain-memories" });

        const semanticMap = new Map(); // id → semantic score
        if (ragResult.ok) {
          for (const r of ragResult.data?.results || []) {
            semanticMap.set(r.id, r.score);
          }
        }

        // Redis-based filter
        const filtered = await listMemories({
          type:      args.type      || undefined,
          projectId: args.projectId || undefined,
          tags:      args.tags      || undefined,
          limit:     limit * 4,
        });

        // fix-9: combined ranking formula
        const ranked = filtered
          .map(m => ({
            ...m,
            _score: recallScore(
              semanticMap.get(m.id) || 0,
              m.importance,
              m.createdAt,
            ),
          }))
          .sort((a, b) => b._score - a._score)
          .slice(0, limit)
          .map(({ _score, ...m }) => m);

        return {
          ok: true,
          data: {
            query:        args.query,
            total:        ranked.length,
            semanticHits: semanticMap.size,
            memories:     ranked,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "brain_recall_failed", message: err.message } };
      }
    },
  },

  // ── brain_get_context ──────────────────────────────────────────────────────
  {
    name: "brain_get_context",
    description: "Build a complete context block (user profile + project info + relevant memories sorted by decayed importance) ready to inject into an LLM system prompt. Optionally include recent reasoning (thoughts) via includeThoughts.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        task:           { type: "string",  description: "Current task — helps filter relevant memories" },
        projectId:      { type: "string",  description: "Active project slug (optional)" },
        includeFs:      { type: "boolean", default: false, description: "Include file-system snapshot" },
        includeThoughts: { type: "boolean", default: false, description: "Include recent reasoning (brain_think scratchpad)" },
        maxMemories:    { type: "number",  default: 20 },
        maxThoughts:    { type: "number",  default: 5 },
        compact:        { type: "boolean", default: false, description: "Return a single truncated string (for compact system prompts)" },
        maxChars:       { type: "number",  default: 4000 },
      },
    },
    handler: async (args) => {
      try {
        const opts = {
          task: args.task, projectId: args.projectId,
          includeFs: args.includeFs, includeThoughts: args.includeThoughts ?? false,
          maxMemories: args.maxMemories ?? 20, maxThoughts: args.maxThoughts ?? 5,
        };
        if (args.compact) {
          const block = await buildCompactContext({
            ...opts, maxChars: args.maxChars || 4_000,
          });
          return { ok: true, data: { contextBlock: block } };
        }
        const ctx = await buildContext(opts);
        return { ok: true, data: ctx };
      } catch (err) {
        return { ok: false, error: { code: "brain_context_failed", message: err.message } };
      }
    },
  },

  // ── brain_think ────────────────────────────────────────────────────────────
  {
    name: "brain_think",
    description: "Append a private reasoning step (Devin-style scratchpad). Not shown to the user; stored briefly and optionally included in 'Recent Reasoning' when building context. Use for step-by-step reasoning you want to reuse in the next turn.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        thought: { type: "string", description: "Short reasoning step or conclusion" },
        context: { type: "string", description: "Optional label (e.g. task name) for this thought" },
      },
      required: ["thought"],
    },
    handler: async ({ thought, context }) => {
      try {
        await pushThought(thought, context);
        return { ok: true, data: { saved: true } };
      } catch (err) {
        return { ok: false, error: { code: "brain_think_failed", message: err.message } };
      }
    },
  },

  // ── brain_update_profile ───────────────────────────────────────────────────
  {
    name: "brain_update_profile",
    description: "Update the user profile. Common fields: name, preferredLanguage, timezone, techStack, codingStyle, workingHours, preferences.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Key/value pairs to set on the profile",
          additionalProperties: { type: "string" },
        },
      },
      required: ["fields"],
    },
    handler: async (args) => {
      try {
        const updated = await updateProfile(args.fields || {});
        return { ok: true, data: { updated: true, profile: updated } };
      } catch (err) {
        return { ok: false, error: { code: "brain_profile_failed", message: err.message } };
      }
    },
  },

  // ── brain_get_profile ──────────────────────────────────────────────────────
  {
    name: "brain_get_profile",
    description: "Read the current user profile (name, timezone, tech stack, preferences, etc.).",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const profile = await getProfile();
        return { ok: true, data: { profile, hasData: Object.keys(profile).length > 0 } };
      } catch (err) {
        return { ok: false, error: { code: "brain_profile_failed", message: err.message } };
      }
    },
  },

  // ── brain_update_memory ────────────────────────────────────────────────────
  {
    name: "brain_update_memory",
    description: "Update an existing memory entry by ID. Use this when a fact changes (e.g. you switched frameworks). Also re-indexes in RAG if content changes.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        id:         { type: "string", description: "Memory ID to update" },
        content:    { type: "string", description: "New content (optional)" },
        type:       { type: "string", enum: ["fact", "decision", "preference", "event", "project_note"] },
        tags:       { type: "array",  items: { type: "string" } },
        projectId:  { type: "string" },
        importance: { type: "number", minimum: 0, maximum: 1 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["id"],
    },
    handler: async (args) => {
      try {
        const { id, ...fields } = args;
        const updated = await updateMemory(id, fields);
        if (!updated) return { ok: false, error: { code: "not_found", message: `Memory '${id}' not found` } };

        if (fields.content) {
          await useTool("rag_index", {
            id: updated.id, content: updated.content,
            metadata: { type: updated.type, tags: updated.tags, projectId: updated.projectId, source: "brain" },
          }, { workspaceId: "brain-memories" }).catch(() => {});
        }

        return { ok: true, data: updated };
      } catch (err) {
        return { ok: false, error: { code: "brain_update_memory_failed", message: err.message } };
      }
    },
  },

  // ── brain_forget ───────────────────────────────────────────────────────────
  {
    name: "brain_forget",
    description: "Delete memories. Either supply explicit `ids`, or supply a `query` to semantically find and delete matching memories. Also removes them from the RAG semantic index.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        ids:       { type: "array", items: { type: "string" }, description: "Explicit memory IDs to delete" },
        query:     { type: "string",  description: "Semantic query — deletes all memories matching this query above minScore" },
        minScore:  { type: "number",  default: 0.75, description: "Minimum similarity score for query-based deletion" },
        limit:     { type: "number",  default: 5, description: "Max memories to delete per query (safety cap)" },
        dryRun:    { type: "boolean", default: false, description: "Preview what would be deleted without actually deleting" },
      },
    },
    handler: async (args) => {
      try {
        let idsToDelete = args.ids || [];

        // Semantic search to find targets
        if (args.query && !idsToDelete.length) {
          const ragResult = await useTool("rag_search", {
            query:    args.query,
            limit:    args.limit || 5,
            minScore: args.minScore ?? 0.75,
          }, { workspaceId: "brain-memories" });

          if (ragResult.ok) {
            idsToDelete = (ragResult.data?.results || []).map(r => r.id);
          }
        }

        if (!idsToDelete.length) {
          return { ok: true, data: { deleted: 0, ids: [], message: "No matching memories found" } };
        }

        if (args.dryRun) {
          const preview = [];
          for (const id of idsToDelete) {
            const m = await getMemory(id);
            if (m) preview.push({ id: m.id, type: m.type, content: m.content.slice(0, 100) });
          }
          return { ok: true, data: { dryRun: true, wouldDelete: preview.length, preview } };
        }

        const deleted = [];
        for (const id of idsToDelete) {
          const result = await deleteMemoryWithRagSync(id);
          if (result.deleted) deleted.push(id);
        }

        return { ok: true, data: { deleted: deleted.length, ids: deleted } };
      } catch (err) {
        return { ok: false, error: { code: "brain_forget_failed", message: err.message } };
      }
    },
  },

  // ── brain_register_project ─────────────────────────────────────────────────
  {
    name: "brain_register_project",
    description: "Add or update a project in the brain registry.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        name:         { type: "string" },
        path:         { type: "string", description: "Absolute local path" },
        stack:        { type: "string", description: "Tech stack (e.g. 'Node.js, PostgreSQL, Redis')" },
        status:       { type: "string", enum: ["active", "archived", "paused"], default: "active" },
        description:  { type: "string" },
        githubRepo:   { type: "string", description: "owner/repo" },
        notionPageId: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      try {
        const project = await registerProject({
          name: args.name, path: args.path || "",
          stack: args.stack || "", status: args.status || "active",
          description: args.description || "",
          githubRepo: args.githubRepo || "", notionPageId: args.notionPageId || "",
        });
        return { ok: true, data: project };
      } catch (err) {
        return { ok: false, error: { code: "brain_project_failed", message: err.message } };
      }
    },
  },

  // ── brain_get_projects ─────────────────────────────────────────────────────
  {
    name: "brain_get_projects",
    description: "List all registered projects. Optionally filter by status.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "archived", "paused"] },
      },
    },
    handler: async (args) => {
      try {
        const projects = await listProjects(args.status || undefined);
        return { ok: true, data: { total: projects.length, projects } };
      } catch (err) {
        return { ok: false, error: { code: "brain_projects_failed", message: err.message } };
      }
    },
  },

  // ── brain_get_stats ────────────────────────────────────────────────────────
  {
    name: "brain_get_stats",
    description: "Get brain statistics: total memories by type, projects by status, and filesystem index info. Useful for checking what the brain knows.",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const [memStats, projStats, snapshot] = await Promise.all([
          getMemoryStats(),
          getProjectStats(),
          getFsSnapshot(),
        ]);
        return {
          ok: true,
          data: {
            namespace: NAMESPACE,
            memories:  memStats,
            projects:  projStats,
            filesystem: snapshot
              ? { indexed: true, indexedAt: snapshot.indexedAt, totalFiles: snapshot.totalFiles, paths: snapshot.paths }
              : { indexed: false },
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "brain_stats_failed", message: err.message } };
      }
    },
  },

  // ── brain_list_sessions ────────────────────────────────────────────────────
  {
    name: "brain_list_sessions",
    description: "List past session summaries that were saved via brain_summarize_session. Returns memories tagged 'session-summary' in reverse chronological order.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string",  description: "Filter by project (optional)" },
        limit:     { type: "number",  default: 20 },
        offset:    { type: "number",  default: 0 },
      },
    },
    handler: async (args) => {
      try {
        const sessions = await listMemories({
          type:      "event",
          tags:      ["session-summary"],
          projectId: args.projectId || undefined,
          limit:     args.limit  || 20,
          offset:    args.offset || 0,
        });
        return { ok: true, data: { total: sessions.length, sessions } };
      } catch (err) {
        return { ok: false, error: { code: "brain_sessions_failed", message: err.message } };
      }
    },
  },

  // ── brain_index_filesystem ─────────────────────────────────────────────────
  {
    name: "brain_index_filesystem",
    description: "Scan directories and index the file structure into semantic search so the brain can answer 'where is X?' type questions.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        paths:       { type: "array", items: { type: "string" }, description: "Absolute directory paths to scan" },
        maxDepth:    { type: "number", default: 4 },
        workspaceId: { type: "string", default: "brain-fs" },
      },
      required: ["paths"],
    },
    handler: async (args) => {
      try {
        if (!Array.isArray(args.paths) || args.paths.length === 0) {
          return { ok: false, error: { code: "validation", message: "`paths` must be a non-empty array" } };
        }
        const result = await indexFilesystem({
          paths:       args.paths,
          maxDepth:    args.maxDepth    || 4,
          workspaceId: args.workspaceId || "brain-fs",
        });
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "brain_index_fs_failed", message: err.message } };
      }
    },
  },

  // ── brain_search_files ─────────────────────────────────────────────────────
  {
    name: "brain_search_files",
    description: "Search the indexed filesystem using semantic similarity. Ask 'where is the auth module?' or 'find database configuration files'. Requires brain_index_filesystem to have run first.",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        query:       { type: "string",  description: "What you are looking for in the file system" },
        limit:       { type: "number",  default: 5 },
        minScore:    { type: "number",  default: 0.1 },
        workspaceId: { type: "string",  default: "brain-fs" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const snapshot = await getFsSnapshot();
        if (!snapshot) {
          return {
            ok: false,
            error: { code: "not_indexed", message: "Filesystem not indexed yet. Run brain_index_filesystem first." },
          };
        }

        const ragResult = await useTool("rag_search", {
          query:    args.query,
          limit:    args.limit    || 5,
          minScore: args.minScore || 0.1,
        }, { workspaceId: args.workspaceId || "brain-fs" });

        if (!ragResult.ok) return ragResult;

        return {
          ok: true,
          data: {
            query:          args.query,
            results:        ragResult.data?.results || [],
            indexedAt:      snapshot.indexedAt,
            indexedPaths:   snapshot.paths,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "brain_search_files_failed", message: err.message } };
      }
    },
  },

  // ── brain_summarize_session ────────────────────────────────────────────────
  {
    name: "brain_summarize_session",
    description: "Summarize the current conversation using LLM and save as an episodic memory. Clears the working session afterwards.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: { role: { type: "string" }, content: { type: "string" } },
            required: ["role", "content"],
          },
        },
        projectId: { type: "string" },
      },
      required: ["sessionId", "messages"],
    },
    handler: async (args) => {
      try {
        const result = await summarizeAndSaveSession({
          sessionId: args.sessionId,
          messages:  args.messages  || [],
          projectId: args.projectId || null,
        });
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "brain_summarize_failed", message: err.message } };
      }
    },
  },

  // ── brain_analyze_habits ───────────────────────────────────────────────────
  {
    name: "brain_analyze_habits",
    description: "Analyze stored memories to extract behavioral patterns, coding preferences, time habits, tool choices, and recurring decisions. Uses LLM to identify patterns across your history.",
    tags: [ToolTags.READ, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        saveAsMemory: { type: "boolean", default: true, description: "Automatically save discovered habits as preference memories" },
        projectId:    { type: "string",  description: "Analyze habits for a specific project only (optional)" },
        limit:        { type: "number",  default: 50, description: "How many recent memories to analyze" },
      },
    },
    handler: async (args) => {
      try {
        // Fetch recent preferences and decisions
        const [preferences, decisions, events] = await Promise.all([
          listMemories({ type: "preference", projectId: args.projectId, limit: args.limit || 50 }),
          listMemories({ type: "decision",   projectId: args.projectId, limit: args.limit || 50 }),
          listMemories({ type: "event",      projectId: args.projectId, limit: Math.floor((args.limit || 50) / 2) }),
        ]);

        const profile = await getProfile();
        const allMems = [...preferences, ...decisions, ...events];

        if (allMems.length < 3) {
          return {
            ok: true,
            data: {
              habits:  [],
              message: "Not enough memories to analyze patterns. Add more facts, decisions, and preferences first.",
            },
          };
        }

        const memText = allMems
          .slice(0, 60)
          .map(m => `[${m.type}] ${m.content}`)
          .join("\n");

        const profileText = Object.entries(profile).length
          ? "User profile:\n" + Object.entries(profile).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n\n"
          : "";

        const prompt = `${profileText}Analyze these memories and extract behavioral patterns, habits, and preferences of this person. Focus on:
1. Coding/technical preferences (languages, patterns, frameworks)
2. Work habits (timing, workflow, communication style)
3. Decision-making patterns (what factors drive choices)
4. Tool and technology preferences
5. Project management tendencies

Return a JSON array of habit objects: [{ "habit": "string description", "category": "coding|work|decisions|tools|projects", "confidence": 0.0-1.0, "evidence": ["memory snippet 1", ...] }]

Memories to analyze:
${memText.slice(0, 8_000)}`;

        let habits = [];
        try {
          const llmResult = await routeTask("analysis", prompt, { maxTokens: 800, temperature: 0.3 });
          const raw = llmResult?.content ?? "";

          // Extract JSON array from response
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) habits = JSON.parse(jsonMatch[0]);
        } catch {
          habits = [];
        }

        // Optionally save high-confidence habits as preference memories.
        // Use findDuplicate so re-running brain_analyze_habits doesn't create
        // duplicate habit entries — it updates the existing one instead.
        const saved = [];
        if (args.saveAsMemory !== false && habits.length > 0) {
          for (const h of habits.filter(h => h.confidence >= 0.7)) {
            const content   = `Habit: ${h.habit}`;
            const duplicate = await findDuplicate(content, "preference");

            if (duplicate) {
              // Bump importance if we found it again with higher confidence
              await updateMemory(duplicate.id, {
                importance: Math.max(duplicate.importance, 0.7),
                confidence: Math.max(duplicate.confidence || 0, h.confidence),
              });
              saved.push(duplicate.id);
            } else {
              const mem = await addMemory({
                content,
                type:       "preference",
                tags:       ["habit", h.category || "general"],
                importance: 0.7,
                confidence: h.confidence,
                source:     "agent",
              });
              await useTool("rag_index", {
                id: mem.id, content: mem.content,
                metadata: { type: "preference", tags: ["habit"], source: "brain-analysis" },
              }, { workspaceId: "brain-memories" }).catch(() => {});
              saved.push(mem.id);
            }
          }
        }

        return {
          ok: true,
          data: {
            analyzedMemories: allMems.length,
            habits,
            savedAsMemories:  saved.length,
            savedIds:         saved,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "brain_analyze_habits_failed", message: err.message } };
      }
    },
  },

  // ── brain_what_do_you_know_about ───────────────────────────────────────────
  {
    name: "brain_what_do_you_know_about",
    description: "Natural language query: 'What do you know about mcp-hub?' Returns a comprehensive LLM-generated summary aggregating memories, project info, and file system data about the subject.",
    tags: [ToolTags.READ, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "What to query about (e.g. 'mcp-hub project', 'authentication', 'database decisions')" },
        limit:   { type: "number", default: 15, description: "Max memories to consider" },
      },
      required: ["subject"],
    },
    handler: async (args) => {
      try {
        // Gather evidence from multiple sources in parallel
        const [ragMemResult, ragFsResult, projects, profile] = await Promise.all([
          useTool("rag_search", { query: args.subject, limit: args.limit || 15, minScore: 0.1 }, { workspaceId: "brain-memories" }),
          useTool("rag_search", { query: args.subject, limit: 5, minScore: 0.1 }, { workspaceId: "brain-fs" }),
          listProjects(),
          getProfile(),
        ]);

        const memResults    = ragMemResult.ok ? ragMemResult.data?.results || [] : [];
        const fsResults     = ragFsResult.ok  ? ragFsResult.data?.results  || [] : [];
        const relevantProjects = projects.filter(p =>
          p.name.toLowerCase().includes(args.subject.toLowerCase()) ||
          (p.description || "").toLowerCase().includes(args.subject.toLowerCase()),
        );

        if (memResults.length === 0 && fsResults.length === 0 && relevantProjects.length === 0) {
          return {
            ok: true,
            data: {
              subject: args.subject,
              answer:  "I don't have any information about this yet. Use brain_remember to save relevant facts.",
              sources: { memories: 0, filesystem: 0, projects: 0 },
            },
          };
        }

        // Build context for LLM synthesis
        const memText     = memResults.map(r => `- ${r.content}`).join("\n");
        const fsText      = fsResults.map(r => `- ${r.content.slice(0, 200)}`).join("\n");
        const projText    = relevantProjects.map(p => `- ${p.name}: ${p.description || ""} (${p.stack || ""})`).join("\n");
        const profileText = Object.keys(profile).length
          ? "User: " + (profile.name || "unknown")
          : "";

        const prompt = `${profileText ? profileText + "\n\n" : ""}Based on the following information, provide a comprehensive answer to: "What do I know about ${args.subject}?"

Memories:
${memText || "(none)"}

File System:
${fsText || "(none)"}

Projects:
${projText || "(none)"}

Synthesize this into a clear, structured response. If information is uncertain, note that.`;

        let answer = "";
        try {
          const llmResult = await routeTask("summarize", prompt, { maxTokens: 600 });
          answer = llmResult?.content ?? "";
        } catch {
          // Fallback: just list the raw evidence
          answer = [memText, fsText, projText].filter(Boolean).join("\n\n");
        }

        return {
          ok: true,
          data: {
            subject: args.subject,
            answer,
            sources: {
              memories:  memResults.length,
              filesystem: fsResults.length,
              projects:  relevantProjects.length,
            },
            rawEvidence: {
              memories:  memResults.map(r => ({ id: r.id, score: r.score, snippet: r.content.slice(0, 150) })),
              projects:  relevantProjects.map(p => ({ name: p.name, slug: p.slug })),
            },
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "brain_knowledge_failed", message: err.message } };
      }
    },
  },
];
