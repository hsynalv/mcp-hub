/**
 * RAG (Retrieval-Augmented Generation) Plugin
 * Document indexing and semantic search using in-memory vector store.
 */

import { Router } from "express";
import { z } from "zod";
import { ToolTags } from "../../core/tool-registry.js";

// ── In-memory vector store ───────────────────────────────────────────────────

const documents = new Map(); // id → { id, content, metadata, embedding }
let nextId = 1;

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

// ── Plugin exports ─────────────────────────────────────────────────────────────

export const name = "rag";
export const version = "1.0.0";
export const description = "Document indexing and semantic search for RAG workflows";
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
];
export const examples = [
  'POST /rag/index  body: {"content":"API documentation...","metadata":{"source":"docs"}}',
  'POST /rag/search  body: {"query":"authentication flow","limit":5}',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

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
    handler: async (args) => {
      const id = args.id || `doc-${nextId++}`;
      const embedding = createEmbedding(args.content);

      documents.set(id, {
        id,
        content: args.content,
        metadata: args.metadata || {},
        embedding,
        indexedAt: new Date().toISOString(),
      });

      return { ok: true, data: { id, indexed: true } };
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
    handler: async (args) => {
      const results = [];
      for (const doc of args.documents) {
        const id = doc.id || `doc-${nextId++}`;
        const embedding = createEmbedding(doc.content);

        documents.set(id, {
          id,
          content: doc.content,
          metadata: doc.metadata || {},
          embedding,
          indexedAt: new Date().toISOString(),
        });

        results.push({ id, indexed: true });
      }

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
    handler: async (args) => {
      const queryEmbedding = createEmbedding(args.query);
      const limit = Math.min(args.limit || 5, 50);
      const minScore = args.minScore ?? 0.1;

      const results = [];
      for (const doc of documents.values()) {
        const score = cosineSimilarity(queryEmbedding, doc.embedding);
        if (score >= minScore) {
          results.push({
            id: doc.id,
            score,
            content: doc.content.slice(0, 500),
            metadata: doc.metadata,
          });
        }
      }

      results.sort((a, b) => b.score - a.score);

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
    handler: async (args) => {
      const doc = documents.get(args.id);
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
    handler: async (args) => {
      const existed = documents.delete(args.id);
      if (!existed) {
        return { ok: false, error: { code: "not_found", message: "Document not found" } };
      }
      return { ok: true, data: { deleted: args.id } };
    },
  },
  {
    name: "rag_stats",
    description: "Get index statistics",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return {
        ok: true,
        data: {
          totalDocuments: documents.size,
          avgEmbeddingSize: documents.size > 0
            ? [...documents.values()].reduce((sum, d) => sum + d.embedding.length, 0) / documents.size
            : 0,
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

  router.get("/stats", (_req, res) => {
    const total = documents.size;
    const avgSize = total > 0
      ? [...documents.values()].reduce((sum, d) => sum + d.embedding.length, 0) / total
      : 0;
    res.json({
      ok: true,
      stats: { totalDocuments: total, avgEmbeddingSize: Math.round(avgSize * 100) / 100 },
    });
  });

  router.post("/index", (req, res) => {
    const parsed = indexSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { content, metadata, id: customId } = parsed.data;
    const id = customId || `doc-${nextId++}`;
    const embedding = createEmbedding(content);

    documents.set(id, {
      id,
      content,
      metadata: metadata || {},
      embedding,
      indexedAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, document: { id, indexed: true } });
  });

  router.post("/index-batch", (req, res) => {
    const parsed = batchIndexSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const results = [];
    for (const doc of parsed.data.documents) {
      const id = doc.id || `doc-${nextId++}`;
      const embedding = createEmbedding(doc.content);

      documents.set(id, {
        id,
        content: doc.content,
        metadata: doc.metadata || {},
        embedding,
        indexedAt: new Date().toISOString(),
      });

      results.push({ id, indexed: true });
    }

    res.status(201).json({ ok: true, indexed: results.length, documents: results });
  });

  router.post("/search", (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { query, limit, minScore } = parsed.data;
    const queryEmbedding = createEmbedding(query);

    const results = [];
    for (const doc of documents.values()) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      if (score >= minScore) {
        results.push({
          id: doc.id,
          score: Math.round(score * 1000) / 1000,
          content: doc.content.slice(0, 500),
          metadata: doc.metadata,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    res.json({
      ok: true,
      query,
      total: results.length,
      results: results.slice(0, limit),
    });
  });

  router.get("/documents/:id", (req, res) => {
    const doc = documents.get(req.params.id);
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

  router.delete("/documents/:id", (req, res) => {
    const existed = documents.delete(req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.id });
  });

  router.post("/clear", (req, res) => {
    const count = documents.size;
    documents.clear();
    nextId = 1;
    res.json({ ok: true, cleared: count });
  });

  app.use("/rag", router);
}
