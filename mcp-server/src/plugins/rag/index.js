/**
 * RAG (Retrieval-Augmented Generation) Plugin
 * Document indexing and semantic search with workspace isolation and audit logging.
 */

import { Router } from "express";
import { z } from "zod";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { MemoryStore } from "./stores/memory.store.js";
import { auditLog, getAuditManager } from "../../core/audit/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginError = createPluginErrorHandler("rag");

export const metadata = createMetadata({
  name: "rag",
  version: "1.0.0",
  description: "Document indexing and semantic search with workspace isolation and audit logging",
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
  tags: ["rag", "search", "semantic", "documents", "ai"],
  dependencies: [],
  since: "1.0.0",
  notes: "RAG (Retrieval-Augmented Generation) for document indexing and semantic search.",
});

// Configuration
const MAX_DOCUMENT_SIZE = parseInt(process.env.RAG_MAX_DOCUMENT_SIZE, 10) || 10 * 1024 * 1024; // 10MB default
const MAX_QUERY_LENGTH = parseInt(process.env.RAG_MAX_QUERY_LENGTH, 10) || 10000; // 10K chars
const MAX_CHUNK_SIZE = parseInt(process.env.RAG_MAX_CHUNK_SIZE, 10) || 2000; // chars per chunk
const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP, 10) || 200; // overlap between chunks
const MAX_CHUNKS_PER_DOC = parseInt(process.env.RAG_MAX_CHUNKS_PER_DOC, 10) || 100;
const MAX_TOTAL_RESULTS = parseInt(process.env.RAG_MAX_TOTAL_RESULTS, 10) || 50;
const CONTENT_SNIPPET_LENGTH = parseInt(process.env.RAG_CONTENT_SNIPPET_LENGTH, 10) || 500; // chars returned in search

// Initialize store (MemoryStore by default, configurable in future)
const store = new MemoryStore({ name: "rag-memory" });

// Global ID counter for document IDs
const globalNextId = { value: 1 };

// Plugin exports
export const name = "rag";
export const version = "1.0.0";
export const description = "Document indexing and semantic search with workspace isolation and audit logging.";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "POST", path: "/rag/index",          description: "Index a document",           scope: "write" },
  { method: "POST", path: "/rag/index-batch",    description: "Index multiple documents",   scope: "write" },
  { method: "POST", path: "/rag/search",          description: "Semantic search",            scope: "read"  },
  { method: "GET",  path: "/rag/documents/:id",    description: "Get document by ID",         scope: "read"  },
  { method: "DELETE", path: "/rag/documents/:id", description: "Delete document",            scope: "write" },
  { method: "GET",  path: "/rag/stats",           description: "Index statistics",           scope: "read"  },
  { method: "POST", path: "/rag/clear",           description: "Clear all documents",        scope: "danger" },
  { method: "GET",  path: "/rag/health",          description: "Plugin health",              scope: "read"  },
  { method: "GET",  path: "/rag/audit",           description: "View audit log",             scope: "read"  },
];

/**
 * Simple text embedding using word frequency vectors
 * Production would use OpenAI, Hugging Face, or local embeddings
 */
function createEmbedding(text) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const vocab = [...new Set(words)];
  return vocab.map(word => words.filter(w => w === word).length / words.length);
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    // Pad shorter vector
    const maxLen = Math.max(a.length, b.length);
    const aa = [...a, ...Array(maxLen - a.length).fill(0)];
    const bb = [...b, ...Array(maxLen - b.length).fill(0)];
    a = aa;
    b = bb;
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate correlation ID for tracing
 */
export function generateCorrelationId() {
  return `rag-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Extract context from request
 */
export function extractContext(req) {
  return {
    actor: req.user?.id || req.user?.email || "anonymous",
    workspaceId: req.headers?.["x-workspace-id"] || null,
    projectId: req.headers?.["x-project-id"] || null,
  };
}

/**
 * Metadata fields allowlist for retrieval responses
 * Only these fields are returned to prevent information leakage
 */
const METADATA_ALLOWLIST = [
  "sourceName",
  "sourceType",
  "title",
  "language",
  "tags",
  "createdAt",
  "updatedAt",
  "documentId",
  "chunkIndex",
  "totalChunks",
];

/**
 * Sensitive field patterns to exclude (regex)
 */
const SENSITIVE_FIELD_PATTERNS = [
  /path/i,
  /absolute/i,
  /file.?system/i,
  /internal.?id/i,
  /secret/i,
  /token/i,
  /credential/i,
  /password/i,
  /api.?key/i,
  /private/i,
  /_id$/i,
  /embedding/i,
  /vector/i,
  /raw.?content/i,
];

/**
 * Sanitize metadata for retrieval responses
 * - Only allowlisted fields pass through
 * - Sensitive patterns are filtered
 * - Nested objects are flattened or removed
 */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Check if key is in allowlist
    const isAllowed = METADATA_ALLOWLIST.includes(key);

    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(key));

    // Skip sensitive fields even if in allowlist (defense in depth)
    if (isSensitive) {
      continue;
    }

    // Only include allowlisted fields
    if (isAllowed) {
      // For primitive values, include directly
      if (typeof value !== "object" || value === null) {
        sanitized[key] = value;
      }
      // For arrays of primitives, include if safe
      else if (Array.isArray(value)) {
        const safeArray = value.filter(item =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        );
        if (safeArray.length > 0) {
          sanitized[key] = safeArray;
        }
      }
      // Skip nested objects to prevent leakage
      // (flattening could be added if needed)
    }
  }

  return sanitized;
}

/**
 * Add audit entry for RAG operations (no content logged)
 */
export async function auditEntry(entry) {
  await auditLog({
    plugin: "rag",
    operation: entry.operation,
    actor: entry.actor || "anonymous",
    workspaceId: entry.workspaceId || "global",
    projectId: entry.projectId || null,
    correlationId: entry.correlationId,
    allowed: entry.success,
    success: entry.success,
    durationMs: entry.durationMs,
    error: entry.error || undefined,
    metadata: {
      docCount: entry.docCount,
      chunkCount: entry.chunkCount,
      queryLength: entry.queryLength,
      topK: entry.topK,
    },
  });

  const status = entry.success ? "SUCCESS" : "FAILED";
  console.log(`[rag-audit] ${status} | ${entry.operation} | ws:${entry.workspaceId || "global"} | ${entry.correlationId}`);
}

/**
 * Get recent audit log entries
 */
export async function getAuditLogEntries(limit = 100) {
  const manager = getAuditManager();
  return await manager.getRecentEntries({ limit, plugin: "rag" });
}

/**
 * Chunk text with size limits
 */
function chunkText(text, chunkSize = MAX_CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  if (!text || text.length === 0) return chunks;

  // Simple sentence-based chunking
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());

  // Apply overlap
  if (overlap > 0 && chunks.length > 1) {
    const overlappedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        overlappedChunks.push(chunks[i]);
      } else {
        const prevEnd = chunks[i - 1].slice(-overlap);
        overlappedChunks.push(prevEnd + chunks[i]);
      }
    }
    return overlappedChunks.slice(0, MAX_CHUNKS_PER_DOC);
  }

  return chunks.slice(0, MAX_CHUNKS_PER_DOC);
}

/**
 * MCP Tools
 */

export const tools = [
  {
    name: "rag_index",
    description: "Index a document for semantic search",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Document content to index" },
        metadata: { type: "object", description: "Optional metadata (source, type, tags)" },
        id: { type: "string", description: "Optional custom ID" },
      },
      required: ["content"],
    },
    handler: async (args, context = {}) => {
      const startTime = Date.now();
      const correlationId = generateCorrelationId();
      const wsId = context.workspaceId || "global";

      // Validate content size
      if (args.content.length > MAX_DOCUMENT_SIZE) {
        auditEntry({
          operation: "index",
          workspaceId: wsId,
          projectId: context.projectId,
          actor: context.actor || "anonymous",
          correlationId,
          durationMs: Date.now() - startTime,
          success: false,
          error: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars`,
        });
        return { ok: false, error: { code: "document_too_large", message: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars` } };
      }

      const id = args.id || `doc-${globalNextId.value++}`;

      // Chunk the document
      const chunks = chunkText(args.content);

      // Create embedding from first chunk (or all if small)
      const embeddingText = chunks.length > 0 ? chunks[0] : args.content.slice(0, MAX_CHUNK_SIZE);
      const embedding = createEmbedding(embeddingText);

      // Use store abstraction
      await store.upsertDocument(wsId, id, {
        id,
        content: args.content,
        chunks,
        metadata: { ...args.metadata, workspaceId: wsId },
        embedding,
        indexedAt: new Date().toISOString(),
      });

      auditEntry({
        operation: "index",
        workspaceId: wsId,
        projectId: context.projectId,
        actor: context.actor || "anonymous",
        correlationId,
        durationMs: Date.now() - startTime,
        docCount: 1,
        chunkCount: chunks.length,
        success: true,
      });

      return { ok: true, data: { id, indexed: true, chunks: chunks.length } };
    },
  },
  {
    name: "rag_index_batch",
    description: "Index multiple documents at once",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              metadata: { type: "object" },
              id: { type: "string" },
            },
            required: ["content"],
          },
        },
      },
      required: ["documents"],
    },
    handler: async (args, context = {}) => {
      const startTime = Date.now();
      const correlationId = generateCorrelationId();
      const wsId = context.workspaceId || "global";
      const results = [];
      let totalChunks = 0;

      for (const doc of args.documents) {
        // Validate content size
        if (doc.content.length > MAX_DOCUMENT_SIZE) {
          results.push({ id: null, error: "document_too_large", indexed: false });
          continue;
        }

        const id = doc.id || `doc-${globalNextId.value++}`;

        // Chunk the document
        const chunks = chunkText(doc.content);
        totalChunks += chunks.length;

        // Create embedding from first chunk
        const embeddingText = chunks.length > 0 ? chunks[0] : doc.content.slice(0, MAX_CHUNK_SIZE);
        const embedding = createEmbedding(embeddingText);

        await store.upsertDocument(wsId, id, {
          id,
          content: doc.content,
          chunks,
          metadata: { ...doc.metadata, workspaceId: wsId },
          embedding,
          indexedAt: new Date().toISOString(),
        });

        results.push({ id, indexed: true, chunks: chunks.length });
      }

      auditEntry({
        operation: "index_batch",
        workspaceId: wsId,
        projectId: context.projectId,
        actor: context.actor || "anonymous",
        correlationId,
        durationMs: Date.now() - startTime,
        docCount: results.filter(r => r.indexed).length,
        chunkCount: totalChunks,
        success: true,
      });

      return { ok: true, data: { indexed: results.length, documents: results } };
    },
  },
  {
    name: "rag_search",
    description: "Search indexed documents by semantic similarity",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 5, description: "Max results" },
        minScore: { type: "number", default: 0.1, description: "Minimum similarity threshold" },
      },
      required: ["query"],
    },
    handler: async (args, context = {}) => {
      const startTime = Date.now();
      const correlationId = generateCorrelationId();
      const wsId = context.workspaceId || "global";

      // Validate query length
      if (args.query.length > MAX_QUERY_LENGTH) {
        auditEntry({
          operation: "search",
          workspaceId: wsId,
          projectId: context.projectId,
          actor: context.actor || "anonymous",
          correlationId,
          durationMs: Date.now() - startTime,
          queryLength: args.query.length,
          success: false,
          error: `Query exceeds max length of ${MAX_QUERY_LENGTH} chars`,
        });
        return { ok: false, error: { code: "query_too_long", message: `Query exceeds max length of ${MAX_QUERY_LENGTH} chars` } };
      }

      const queryEmbedding = createEmbedding(args.query);
      const limit = Math.min(args.limit || 5, MAX_TOTAL_RESULTS);
      const minScore = args.minScore ?? 0.1;

      const rawResults = await store.searchDocuments(wsId, queryEmbedding, { limit, minScore });

      // Apply metadata sanitization to prevent context leakage
      const results = rawResults.map(result => ({
        id: result.id,
        score: Math.round(result.score * 1000) / 1000,
        content: result.content.slice(0, CONTENT_SNIPPET_LENGTH),
        metadata: sanitizeMetadata(result.metadata),
      }));

      auditEntry({
        operation: "search",
        workspaceId: wsId,
        projectId: context.projectId,
        actor: context.actor || "anonymous",
        correlationId,
        durationMs: Date.now() - startTime,
        queryLength: args.query.length,
        topK: results.slice(0, limit).length,
        success: true,
      });

      return {
        ok: true,
        data: {
          query: args.query,
          total: results.length,
          results: results.slice(0, limit),
        },
      };
    },
  },
  {
    name: "rag_get",
    description: "Get a document by ID",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
      },
      required: ["id"],
    },
    handler: async (args, context = {}) => {
      const wsId = context.workspaceId || "global";
      const doc = await store.getDocument(wsId, args.id);
      if (!doc) {
        return { ok: false, error: { code: "not_found", message: "Document not found" } };
      }
      return {
        ok: true,
        data: {
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          indexedAt: doc.indexedAt,
        },
      };
    },
  },
  {
    name: "rag_delete",
    description: "Delete a document from the index",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
      },
      required: ["id"],
    },
    handler: async (args, context = {}) => {
      const startTime = Date.now();
      const correlationId = generateCorrelationId();
      const wsId = context.workspaceId || "global";
      const existed = await store.deleteDocument(wsId, args.id);
      if (!existed) {
        auditEntry({
          operation: "delete",
          workspaceId: wsId,
          projectId: context.projectId,
          actor: context.actor || "anonymous",
          correlationId,
          durationMs: Date.now() - startTime,
          success: false,
          error: "Document not found",
        });
        return { ok: false, error: { code: "not_found", message: "Document not found" } };
      }
      auditEntry({
        operation: "delete",
        workspaceId: wsId,
        projectId: context.projectId,
        actor: context.actor || "anonymous",
        correlationId,
        durationMs: Date.now() - startTime,
        success: true,
      });
      return { ok: true, data: { deleted: args.id } };
    },
  },
  {
    name: "rag_stats",
    description: "Get index statistics",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async (args, context = {}) => {
      const wsId = context.workspaceId || "global";
      const stats = await store.getStats(wsId);
      return {
        ok: true,
        data: {
          ...stats,
          workspaceId: wsId,
        },
      };
    },
  },
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const indexSchema = z.object({
  content: z.string().min(1, "Content is required"),
  metadata: z.record(z.any()).optional(),
  id: z.string().optional(),
});

const batchIndexSchema = z.object({
  documents: z.array(indexSchema).min(1).max(100),
});

const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().min(1).max(50).default(5),
  minScore: z.number().min(0).max(1).default(0.1),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  router.get("/stats", async (req, res) => {
    const context = extractContext(req);
    const wsId = context.workspaceId || "global";
    const stats = await store.getStats(wsId);
    res.json({
      ok: true,
      stats: { ...stats, workspaceId: wsId },
    });
  });

  router.post("/index", async (req, res) => {
    const context = extractContext(req);
    const parsed = indexSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { content, metadata, id: customId } = parsed.data;
    
    // Validate content size
    if (content.length > MAX_DOCUMENT_SIZE) {
      return res.status(400).json({ ok: false, error: { code: "document_too_large", message: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars` } });
    }
    
    const id = customId || `doc-${globalNextId.value++}`;
    const wsId = context.workspaceId || "global";
    
    // Chunk the document
    const chunks = chunkText(content);
    
    // Create embedding from first chunk
    const embeddingText = chunks.length > 0 ? chunks[0] : content.slice(0, MAX_CHUNK_SIZE);
    const embedding = createEmbedding(embeddingText);

    await store.upsertDocument(wsId, id, {
      id,
      content,
      chunks,
      metadata: { ...metadata, workspaceId: wsId },
      embedding,
      indexedAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, document: { id, indexed: true, chunks: chunks.length } });
  });

  router.post("/index-batch", async (req, res) => {
    const context = extractContext(req);
    const parsed = batchIndexSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const wsId = context.workspaceId || "global";
    const results = [];
    
    for (const doc of parsed.data.documents) {
      // Validate content size
      if (doc.content.length > MAX_DOCUMENT_SIZE) {
        results.push({ id: null, error: "document_too_large", indexed: false });
        continue;
      }
      
      const id = doc.id || `doc-${globalNextId.value++}`;
      
      // Chunk the document
      const chunks = chunkText(doc.content);
      
      // Create embedding from first chunk
      const embeddingText = chunks.length > 0 ? chunks[0] : doc.content.slice(0, MAX_CHUNK_SIZE);
      const embedding = createEmbedding(embeddingText);

      await store.upsertDocument(wsId, id, {
        id,
        content: doc.content,
        chunks,
        metadata: { ...doc.metadata, workspaceId: wsId },
        embedding,
        indexedAt: new Date().toISOString(),
      });

      results.push({ id, indexed: true, chunks: chunks.length });
    }

    res.status(201).json({ ok: true, indexed: results.length, documents: results });
  });

  router.post("/search", async (req, res) => {
    const context = extractContext(req);
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { query, limit, minScore } = parsed.data;
    const wsId = context.workspaceId || "global";
    const queryEmbedding = createEmbedding(query);

    const rawResults = await store.searchDocuments(wsId, queryEmbedding, { limit, minScore });

    // Apply metadata sanitization to prevent context leakage
    const results = rawResults.map(result => ({
      id: result.id,
      score: Math.round(result.score * 1000) / 1000,
      content: result.content.slice(0, CONTENT_SNIPPET_LENGTH),
      metadata: sanitizeMetadata(result.metadata),
    }));

    res.json({
      ok: true,
      query,
      total: results.length,
      results,
    });
  });

  router.get("/documents/:id", async (req, res) => {
    const context = extractContext(req);
    const wsId = context.workspaceId || "global";
    const doc = await store.getDocument(wsId, req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });

    res.json({
      ok: true,
      document: {
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        indexedAt: doc.indexedAt,
      },
    });
  });

  router.delete("/documents/:id", async (req, res) => {
    const context = extractContext(req);
    const wsId = context.workspaceId || "global";
    const existed = await store.deleteDocument(wsId, req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.id });
  });

  router.post("/clear", async (req, res) => {
    const context = extractContext(req);
    const wsId = context.workspaceId || "global";
    const count = await store.clearWorkspace(wsId);
    res.json({ ok: true, cleared: count });
  });

  router.get("/audit", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/rag", router);
}
