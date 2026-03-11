/**
 * RAG (Retrieval-Augmented Generation) Plugin
 *
 * Document indexing and semantic search with workspace isolation and audit logging.
 *
 * Embedding strategy:
 *   - OPENAI_API_KEY set → uses text-embedding-3-small (real semantic search)
 *   - OPENAI_API_KEY absent → keyword-frequency fallback (clearly logged as non-semantic)
 *
 * Each chunk of a document gets its own embedding so long documents are
 * fully searchable, not just by their first chunk.
 */

import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { MemoryStore } from "./stores/memory.store.js";
import { auditLog, getAuditManager } from "../../core/audit/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { requireScope } from "../../core/auth.js";

const pluginError = createPluginErrorHandler("rag");

export const metadata = createMetadata({
  name: "rag",
  version: "1.1.0",
  description: "Document indexing and semantic search. Uses OpenAI text-embedding-3-small when OPENAI_API_KEY is set; falls back to keyword matching otherwise.",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "rag", "search", "indexing", "semantic", "audit"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  tags: ["rag", "search", "semantic", "documents", "ai", "embeddings"],
  dependencies: [],
  since: "1.0.0",
  notes: "Set OPENAI_API_KEY for real semantic search. Without it the plugin uses TF-based keyword matching.",
});

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_DOCUMENT_SIZE    = parseInt(process.env.RAG_MAX_DOCUMENT_SIZE,   10) || 10 * 1024 * 1024;
const MAX_QUERY_LENGTH     = parseInt(process.env.RAG_MAX_QUERY_LENGTH,    10) || 10_000;
const MAX_CHUNK_SIZE       = parseInt(process.env.RAG_MAX_CHUNK_SIZE,      10) || 1_500;
const CHUNK_OVERLAP        = parseInt(process.env.RAG_CHUNK_OVERLAP,       10) || 150;
const MAX_CHUNKS_PER_DOC   = parseInt(process.env.RAG_MAX_CHUNKS_PER_DOC, 10) || 100;
const MAX_TOTAL_RESULTS    = parseInt(process.env.RAG_MAX_TOTAL_RESULTS,   10) || 50;
const CONTENT_SNIPPET_LENGTH = parseInt(process.env.RAG_CONTENT_SNIPPET_LENGTH, 10) || 500;
const EMBEDDING_MODEL      = process.env.RAG_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_CACHE_TTL  = 5 * 60 * 1_000; // 5 minutes

const store = new MemoryStore({ name: "rag-memory" });
const globalNextId = { value: 1 };

// ── Embedding ─────────────────────────────────────────────────────────────────

/** In-memory embedding cache: text[:200] → { vector, expiresAt } */
const embeddingCache = new Map();

/**
 * Keyword-frequency fallback embedding (TF vector).
 * Not semantic — used only when OPENAI_API_KEY is absent.
 */
function keywordEmbedding(text) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const vocab = [...new Set(words)];
  return vocab.map(word => words.filter(w => w === word).length / words.length);
}

/**
 * Create an embedding for a text chunk.
 *
 * Strategy:
 *   1. Check cache — return cached vector if fresh.
 *   2. If OPENAI_API_KEY present → call text-embedding-3-small.
 *   3. On error or missing key → keyword fallback.
 *
 * @returns {{ vector: number[], model: string }}
 */
async function createEmbedding(text) {
  const cacheKey = text.slice(0, 200);
  const cached   = embeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { vector: cached.vector, model: cached.model };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const vector = keywordEmbedding(text);
    return { vector, model: "keyword-fallback" };
  }

  try {
    const openai  = new OpenAI({ apiKey });
    const res     = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8_191), // API limit
    });
    const vector = res.data[0].embedding;
    embeddingCache.set(cacheKey, { vector, model: EMBEDDING_MODEL, expiresAt: Date.now() + EMBEDDING_CACHE_TTL });
    return { vector, model: EMBEDDING_MODEL };
  } catch (err) {
    console.warn(`[rag] OpenAI embedding failed, using keyword fallback: ${err.message}`);
    const vector = keywordEmbedding(text);
    return { vector, model: "keyword-fallback" };
  }
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split text into fixed-size overlapping chunks using a sliding window.
 * The previous implementation prepended chunk N-1's tail to chunk N, making
 * chunks grow beyond MAX_CHUNK_SIZE. Sliding window avoids this.
 */
function chunkText(text, chunkSize = MAX_CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length === 0) return [];
  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    const end  = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start += chunkSize - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

const METADATA_ALLOWLIST = [
  "sourceName", "sourceType", "title", "language", "tags",
  "createdAt", "updatedAt", "documentId", "chunkIndex", "totalChunks",
];

const SENSITIVE_FIELD_PATTERNS = [
  /path/i, /absolute/i, /file.?system/i, /internal.?id/i,
  /secret/i, /token/i, /credential/i, /password/i, /api.?key/i,
  /private/i, /_id$/i, /embedding/i, /vector/i, /raw.?content/i,
];

export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) continue;
    if (!METADATA_ALLOWLIST.includes(key)) continue;
    if (typeof value !== "object" || value === null) {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      const safe = value.filter(i => typeof i === "string" || typeof i === "number" || typeof i === "boolean");
      if (safe.length) sanitized[key] = safe;
    }
  }
  return sanitized;
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

export function generateCorrelationId() {
  return `rag-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function extractContext(req) {
  return {
    actor:       req.user?.id || req.user?.email || "anonymous",
    workspaceId: req.headers?.["x-workspace-id"] || null,
    projectId:   req.headers?.["x-project-id"]   || null,
  };
}

export async function auditEntry(entry) {
  await auditLog({
    plugin:      "rag",
    operation:   entry.operation,
    actor:       entry.actor || "anonymous",
    workspaceId: entry.workspaceId || "global",
    projectId:   entry.projectId || null,
    correlationId: entry.correlationId,
    allowed:     entry.success,
    success:     entry.success,
    durationMs:  entry.durationMs,
    error:       entry.error || undefined,
    metadata: {
      docCount:    entry.docCount,
      chunkCount:  entry.chunkCount,
      queryLength: entry.queryLength,
      topK:        entry.topK,
    },
  });
}

export async function getAuditLogEntries(limit = 100) {
  const manager = getAuditManager();
  return await manager.getRecentEntries({ limit, plugin: "rag" });
}

// ── Indexing helper ───────────────────────────────────────────────────────────

/**
 * Index a single document: chunk → embed each chunk → store.
 * Returns { id, chunks, embeddingModel }.
 */
async function indexDocument(wsId, { content, metadata, id: customId }) {
  const id     = customId || `doc-${globalNextId.value++}`;
  const chunks = chunkText(content);

  // Embed every chunk (real semantic search needs per-chunk vectors)
  const chunkEmbeddings = await Promise.all(chunks.map(c => createEmbedding(c)));
  const vectors         = chunkEmbeddings.map(e => e.vector);
  const embeddingModel  = chunkEmbeddings[0]?.model || "keyword-fallback";

  await store.upsertDocument(wsId, id, {
    id,
    content,
    chunks,
    chunkEmbeddings: vectors,
    embedding:       vectors[0] ?? [],         // backward-compat field
    metadata:        { ...metadata, workspaceId: wsId },
    indexedAt:       new Date().toISOString(),
    embeddingModel,
  });

  return { id, chunks: chunks.length, embeddingModel };
}

// ── Plugin exports ────────────────────────────────────────────────────────────

export const name        = "rag";
export const version     = "1.1.0";
export const description = "Document indexing and semantic search. OPENAI_API_KEY enables real semantic search.";
export const capabilities = ["read", "write"];
export const requires    = [];

export const endpoints = [
  { method: "POST",   path: "/rag/index",          description: "Index a document",                          scope: "write"  },
  { method: "POST",   path: "/rag/index-batch",    description: "Index multiple documents",                  scope: "write"  },
  { method: "POST",   path: "/rag/search",         description: "Semantic search (or keyword if no API key)", scope: "read"   },
  { method: "GET",    path: "/rag/documents/:id",  description: "Get document by ID",                        scope: "read"   },
  { method: "DELETE", path: "/rag/documents/:id",  description: "Delete document",                           scope: "write"  },
  { method: "GET",    path: "/rag/stats",          description: "Index statistics",                          scope: "read"   },
  { method: "POST",   path: "/rag/clear",          description: "Clear all documents (requires confirmation)", scope: "write" },
  { method: "GET",    path: "/rag/health",         description: "Plugin health",                             scope: "read"   },
  { method: "GET",    path: "/rag/audit",          description: "View audit log",                            scope: "read"   },
];

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "rag_index",
    description: "Index a document for semantic search. Automatically chunks large documents. Each chunk gets its own embedding so the full document is searchable.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        content:  { type: "string", description: "Document content to index" },
        metadata: { type: "object", description: "Optional metadata: { sourceName, sourceType, title, tags, language }" },
        id:       { type: "string", description: "Optional custom document ID (auto-generated if omitted)" },
      },
      required: ["content"],
    },
    handler: async (args, context = {}) => {
      const startTime    = Date.now();
      const correlationId = generateCorrelationId();
      const wsId         = context.workspaceId || "global";

      if (args.content.length > MAX_DOCUMENT_SIZE) {
        await auditEntry({ operation: "index", workspaceId: wsId, actor: context.actor, correlationId, durationMs: Date.now() - startTime, success: false, error: "document_too_large" });
        return { ok: false, error: { code: "document_too_large", message: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars` } };
      }

      const result = await indexDocument(wsId, { content: args.content, metadata: args.metadata, id: args.id });
      await auditEntry({ operation: "index", workspaceId: wsId, projectId: context.projectId, actor: context.actor || "anonymous", correlationId, durationMs: Date.now() - startTime, docCount: 1, chunkCount: result.chunks, success: true });

      return { ok: true, data: { id: result.id, indexed: true, chunks: result.chunks, embeddingModel: result.embeddingModel } };
    },
  },
  {
    name: "rag_index_batch",
    description: "Index multiple documents at once. Each document is independently chunked and embedded.",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content:  { type: "string" },
              metadata: { type: "object" },
              id:       { type: "string" },
            },
            required: ["content"],
          },
        },
      },
      required: ["documents"],
    },
    handler: async (args, context = {}) => {
      const startTime    = Date.now();
      const correlationId = generateCorrelationId();
      const wsId         = context.workspaceId || "global";
      const results      = [];
      let   totalChunks  = 0;

      for (const doc of args.documents) {
        if (doc.content.length > MAX_DOCUMENT_SIZE) {
          results.push({ id: null, error: "document_too_large", indexed: false });
          continue;
        }
        const r = await indexDocument(wsId, doc);
        totalChunks += r.chunks;
        results.push({ id: r.id, indexed: true, chunks: r.chunks, embeddingModel: r.embeddingModel });
      }

      await auditEntry({ operation: "index_batch", workspaceId: wsId, projectId: context.projectId, actor: context.actor || "anonymous", correlationId, durationMs: Date.now() - startTime, docCount: results.filter(r => r.indexed).length, chunkCount: totalChunks, success: true });

      return { ok: true, data: { indexed: results.length, documents: results } };
    },
  },
  {
    name: "rag_search",
    description: "Search indexed documents by semantic similarity. Returns the most relevant chunks with their source documents. Requires OPENAI_API_KEY for true semantic search; falls back to keyword matching otherwise.",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        query:   { type: "string", description: "What you are looking for" },
        limit:   { type: "number", default: 5, description: "Max results to return (max 50)" },
        minScore: { type: "number", default: 0.1, description: "Min similarity score 0-1. For keyword fallback, try 0.05+" },
      },
      required: ["query"],
    },
    handler: async (args, context = {}) => {
      const startTime    = Date.now();
      const correlationId = generateCorrelationId();
      const wsId         = context.workspaceId || "global";

      if (args.query.length > MAX_QUERY_LENGTH) {
        return { ok: false, error: { code: "query_too_long", message: `Query exceeds max length of ${MAX_QUERY_LENGTH} chars` } };
      }

      const { vector: queryVector, model } = await createEmbedding(args.query);
      const limit    = Math.min(args.limit || 5, MAX_TOTAL_RESULTS);
      const minScore = args.minScore ?? 0.1;

      const rawResults = await store.searchDocuments(wsId, queryVector, { limit, minScore });
      const results    = rawResults.map(r => ({
        id:       r.id,
        score:    Math.round(r.score * 1_000) / 1_000,
        content:  r.content.slice(0, CONTENT_SNIPPET_LENGTH),
        metadata: sanitizeMetadata(r.metadata),
      }));

      await auditEntry({ operation: "search", workspaceId: wsId, projectId: context.projectId, actor: context.actor || "anonymous", correlationId, durationMs: Date.now() - startTime, queryLength: args.query.length, topK: results.length, success: true });

      return { ok: true, data: { query: args.query, total: results.length, results, embeddingModel: model } };
    },
  },
  {
    name: "rag_get",
    description: "Get a document by ID",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Document ID" } },
      required: ["id"],
    },
    handler: async (args, context = {}) => {
      const wsId = context.workspaceId || "global";
      const doc  = await store.getDocument(wsId, args.id);
      if (!doc) return { ok: false, error: { code: "not_found", message: "Document not found" } };
      return { ok: true, data: { id: doc.id, content: doc.content, metadata: doc.metadata, indexedAt: doc.indexedAt, embeddingModel: doc.embeddingModel } };
    },
  },
  {
    name: "rag_delete",
    description: "Delete a document from the index",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Document ID" } },
      required: ["id"],
    },
    handler: async (args, context = {}) => {
      const startTime    = Date.now();
      const correlationId = generateCorrelationId();
      const wsId         = context.workspaceId || "global";
      const existed      = await store.deleteDocument(wsId, args.id);
      const success      = !!existed;
      await auditEntry({ operation: "delete", workspaceId: wsId, projectId: context.projectId, actor: context.actor || "anonymous", correlationId, durationMs: Date.now() - startTime, success, error: success ? undefined : "not_found" });
      if (!existed) return { ok: false, error: { code: "not_found", message: "Document not found" } };
      return { ok: true, data: { deleted: args.id } };
    },
  },
  {
    name: "rag_stats",
    description: "Get index statistics (document count, chunk count, etc.)",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async (args, context = {}) => {
      const wsId  = context.workspaceId || "global";
      const stats = await store.getStats(wsId);
      return {
        ok: true,
        data: {
          ...stats,
          workspaceId:    wsId,
          embeddingMode:  process.env.OPENAI_API_KEY ? EMBEDDING_MODEL : "keyword-fallback",
          semanticSearch: !!process.env.OPENAI_API_KEY,
        },
      };
    },
  },
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const indexSchema = z.object({
  content:  z.string().min(1, "Content is required"),
  metadata: z.record(z.any()).optional(),
  id:       z.string().optional(),
});

const batchIndexSchema = z.object({
  documents: z.array(indexSchema).min(1).max(100),
});

const searchSchema = z.object({
  query:    z.string().min(1, "Query is required"),
  limit:    z.number().int().min(1).max(50).default(5),
  minScore: z.number().min(0).max(1).default(0.1),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      status: "healthy",
      plugin: name,
      version,
      embeddingMode:  process.env.OPENAI_API_KEY ? EMBEDDING_MODEL : "keyword-fallback",
      semanticSearch: !!process.env.OPENAI_API_KEY,
    });
  });

  router.get("/stats", async (req, res) => {
    const ctx  = extractContext(req);
    const wsId = ctx.workspaceId || "global";
    const stats = await store.getStats(wsId);
    res.json({ ok: true, stats: { ...stats, workspaceId: wsId, embeddingMode: process.env.OPENAI_API_KEY ? EMBEDDING_MODEL : "keyword-fallback" } });
  });

  router.post("/index", async (req, res) => {
    const ctx    = extractContext(req);
    const parsed = indexSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });

    const { content, metadata, id: customId } = parsed.data;
    if (content.length > MAX_DOCUMENT_SIZE) {
      return res.status(400).json({ ok: false, error: { code: "document_too_large", message: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars` } });
    }

    const wsId  = ctx.workspaceId || "global";
    const result = await indexDocument(wsId, { content, metadata, id: customId });
    res.status(201).json({ ok: true, document: { id: result.id, indexed: true, chunks: result.chunks, embeddingModel: result.embeddingModel } });
  });

  router.post("/index-batch", async (req, res) => {
    const ctx    = extractContext(req);
    const parsed = batchIndexSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });

    const wsId    = ctx.workspaceId || "global";
    const results = [];

    for (const doc of parsed.data.documents) {
      if (doc.content.length > MAX_DOCUMENT_SIZE) {
        results.push({ id: null, error: "document_too_large", indexed: false });
        continue;
      }
      const r = await indexDocument(wsId, doc);
      results.push({ id: r.id, indexed: true, chunks: r.chunks, embeddingModel: r.embeddingModel });
    }

    res.status(201).json({ ok: true, indexed: results.length, documents: results });
  });

  router.post("/search", async (req, res) => {
    const ctx    = extractContext(req);
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });

    const { query, limit, minScore } = parsed.data;
    const wsId = ctx.workspaceId || "global";

    const { vector: queryVector, model } = await createEmbedding(query);
    const rawResults = await store.searchDocuments(wsId, queryVector, { limit, minScore });

    const results = rawResults.map(r => ({
      id:       r.id,
      score:    Math.round(r.score * 1_000) / 1_000,
      content:  r.content.slice(0, CONTENT_SNIPPET_LENGTH),
      metadata: sanitizeMetadata(r.metadata),
    }));

    res.json({ ok: true, query, total: results.length, results, embeddingModel: model });
  });

  router.get("/documents/:id", async (req, res) => {
    const ctx  = extractContext(req);
    const wsId = ctx.workspaceId || "global";
    const doc  = await store.getDocument(wsId, req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });

    res.json({ ok: true, document: { id: doc.id, content: doc.content, metadata: doc.metadata, indexedAt: doc.indexedAt, embeddingModel: doc.embeddingModel } });
  });

  router.delete("/documents/:id", async (req, res) => {
    const ctx     = extractContext(req);
    const wsId    = ctx.workspaceId || "global";
    const existed = await store.deleteDocument(wsId, req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.id });
  });

  /**
   * POST /rag/clear
   * Clears all documents in the workspace.
   * Requires write scope AND body { "confirm": "DELETE_ALL" } to prevent accidents.
   */
  router.post("/clear", requireScope("write"), async (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== "DELETE_ALL") {
      return res.status(400).json({
        ok: false,
        error: {
          code:    "confirmation_required",
          message: 'Send { "confirm": "DELETE_ALL" } in the request body to clear the index. This cannot be undone.',
        },
      });
    }

    const ctx   = extractContext(req);
    const wsId  = ctx.workspaceId || "global";
    const count = await store.clearWorkspace(wsId);

    await auditEntry({
      operation:   "clear",
      workspaceId: wsId,
      projectId:   ctx.projectId,
      actor:       ctx.actor || "anonymous",
      correlationId: generateCorrelationId(),
      durationMs:  0,
      docCount:    count,
      success:     true,
    });

    res.json({ ok: true, cleared: count });
  });

  /**
   * GET /rag/audit
   * Returns recent audit entries. await was previously missing — fixed.
   */
  router.get("/audit", async (req, res) => {
    const limit   = Math.min(parseInt(req.query.limit) || 50, 100);
    const entries = await getAuditLogEntries(limit);   // ← await added
    res.json({ ok: true, data: { audit: entries } });
  });

  app.use("/rag", router);
}
