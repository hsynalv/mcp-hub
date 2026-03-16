/**
 * RAG Ingestion Plugin
 *
 * Document ingestion pipeline: load → normalize → chunk → enrich → index.
 * Works alongside the RAG plugin; indexes chunks via rag_index_batch.
 */

import { Router } from "express";
import { z } from "zod";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { auditLog, generateCorrelationId } from "../../core/audit/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { requireScope } from "../../core/auth.js";
import { registerJobRunner, submitJob, getJob } from "../../core/jobs.js";
import { runPipeline } from "./pipeline/pipeline.js";
import { callTool } from "../../core/tool-registry.js";
import { canModifyIndex } from "../../core/workspace-permissions.js";

const pluginError = createPluginErrorHandler("rag-ingestion");

export const metadata = createMetadata({
  name: "rag-ingestion",
  version: "1.0.0",
  description: "Document ingestion pipeline: structure-aware chunking, markdown/PDF support, RAG indexing.",
  status: PluginStatus.BETA,
  riskLevel: RiskLevel.MEDIUM,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "rag", "ingestion", "chunking", "indexing"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  supportsJobs: true,
  tags: ["rag", "ingestion", "chunking", "documents"],
  owner: "platform-team",
});

export const name = "rag-ingestion";
export const version = "1.0.0";
export const description = "Document ingestion pipeline with configurable chunking strategies.";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "POST", path: "/rag-ingestion/ingest", description: "Ingest document (sync or async)", scope: "write" },
  { method: "POST", path: "/rag-ingestion/ingest-markdown", description: "Ingest markdown document", scope: "write" },
  { method: "POST", path: "/rag-ingestion/preview-chunks", description: "Preview chunks without indexing", scope: "read" },
  { method: "POST", path: "/rag-ingestion/reindex", description: "Reindex document by ID", scope: "write" },
  { method: "GET", path: "/rag-ingestion/status/:jobId", description: "Get ingestion job status", scope: "read" },
  { method: "GET", path: "/rag-ingestion/health", description: "Plugin health", scope: "read" },
];

function extractContext(req) {
  return {
    workspaceId: req.headers?.["x-workspace-id"] || req.workspaceId || "global",
    projectId: req.headers?.["x-project-id"] || req.projectId || null,
    actor: req.user?.id || req.user?.email || "anonymous",
  };
}

async function auditEntry(entry) {
  try {
    await auditLog({
      plugin: "rag-ingestion",
      operation: entry.operation,
      actor: entry.actor || "anonymous",
      workspaceId: entry.workspaceId || "global",
      projectId: entry.projectId || null,
      correlationId: entry.correlationId,
      allowed: entry.success,
      success: entry.success,
      durationMs: entry.durationMs,
      error: entry.error,
      metadata: {
        chunkCount: entry.chunkCount,
        jobId: entry.jobId,
        documentId: entry.documentId,
      },
    });
  } catch {
    /* never crash on audit failure */
  }
}

const ingestBodySchema = z.object({
  content: z.string().min(1).max(10 * 1024 * 1024),
  format: z.enum(["markdown", "text", "pdf"]).default("text"),
  documentId: z.string().optional(),
  chunkStrategy: z.enum(["fixed", "heading", "sliding", "semantic"]).default("sliding"),
  chunkSize: z.number().int().min(100).max(10000).optional(),
  chunkOverlap: z.number().int().min(0).max(500).optional(),
  metadata: z.record(z.any()).optional(),
  async: z.boolean().default(false),
});

const previewBodySchema = z.object({
  content: z.string().min(1).max(2 * 1024 * 1024),
  format: z.enum(["markdown", "text"]).default("text"),
  chunkStrategy: z.enum(["fixed", "heading", "sliding", "semantic"]).default("sliding"),
  chunkSize: z.number().int().min(100).max(10000).optional(),
  chunkOverlap: z.number().int().min(0).max(500).optional(),
});

const reindexBodySchema = z.object({
  documentId: z.string().min(1),
  chunkStrategy: z.enum(["fixed", "heading", "sliding", "semantic"]).optional(),
});

registerJobRunner("rag.ingestion", async (job, updateProgress, log) => {
  const { request, context } = job.payload;
  await log("Starting ingestion pipeline");
  const result = await runPipeline(request, context);
  await updateProgress(100);
  await log(`Completed: ${result.chunks?.length || 0} chunks`);
  return result;
});

export const tools = [
  {
    name: "ingest_document",
    description: "Ingest a document into RAG. Supports markdown, text, and PDF. Chunks are indexed for semantic search.",
    tags: [ToolTags.WRITE, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Document content (or base64 for PDF)" },
        format: { type: "string", enum: ["markdown", "text", "pdf"], default: "text" },
        documentId: { type: "string", description: "Optional document ID" },
        chunkStrategy: { type: "string", enum: ["fixed", "heading", "sliding", "semantic"], default: "sliding" },
        metadata: { type: "object", description: "Optional metadata" },
      },
      required: ["content"],
    },
    handler: async (args, context = {}) => {
      const start = Date.now();
      const correlationId = generateCorrelationId();
      const wsId = context.workspaceId || "global";

      const perm = await canModifyIndex({ workspaceId: wsId, actor: context.actor, plugin: "rag-ingestion", correlationId });
      if (!perm.allowed) {
        return { ok: false, error: { code: "permission_denied", message: perm.reason || "Cannot modify index" } };
      }

      const result = await runPipeline(
        {
          content: args.content,
          format: args.format || "text",
          documentId: args.documentId,
          chunkStrategy: args.chunkStrategy || "sliding",
          metadata: args.metadata,
        },
        { ...context, workspaceId: wsId }
      );

      await auditEntry({
        operation: "ingest_document",
        workspaceId: wsId,
        actor: context.actor || "anonymous",
        correlationId,
        durationMs: Date.now() - start,
        success: result.success,
        chunkCount: result.chunks?.length,
        documentId: result.indexing?.documentId,
      });

      if (!result.success) {
        return { ok: false, error: { code: "ingestion_failed", message: result.error } };
      }
      return {
        ok: true,
        data: {
          chunks: result.chunks?.length,
          indexing: result.indexing,
          durationMs: result.durationMs,
        },
      };
    },
  },
  {
    name: "ingest_markdown",
    description: "Ingest markdown content. Uses heading-aware chunking when structure is detected.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content" },
        documentId: { type: "string" },
        chunkStrategy: { type: "string", enum: ["fixed", "heading", "sliding", "semantic"], default: "heading" },
      },
      required: ["content"],
    },
    handler: async (args, context = {}) => {
      const wsId = context.workspaceId || "global";
      const perm = await canModifyIndex({ workspaceId: wsId, actor: context.actor, plugin: "rag-ingestion" });
      if (!perm.allowed) {
        return { ok: false, error: { code: "permission_denied", message: perm.reason || "Cannot modify index" } };
      }
      const result = await runPipeline(
        {
          content: args.content,
          format: "markdown",
          documentId: args.documentId,
          chunkStrategy: args.chunkStrategy || "heading",
        },
        { ...context, workspaceId: wsId }
      );
      if (!result.success) {
        return { ok: false, error: { code: "ingestion_failed", message: result.error } };
      }
      return {
        ok: true,
        data: { chunks: result.chunks?.length, indexing: result.indexing, durationMs: result.durationMs },
      };
    },
  },
  {
    name: "preview_chunks",
    description: "Preview how a document would be chunked without indexing.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        format: { type: "string", enum: ["markdown", "text"], default: "text" },
        chunkStrategy: { type: "string", enum: ["fixed", "heading", "sliding", "semantic"], default: "sliding" },
      },
      required: ["content"],
    },
    handler: async (args, context = {}) => {
      const result = await runPipeline(
        {
          content: args.content,
          format: args.format || "text",
          chunkStrategy: args.chunkStrategy || "sliding",
          previewOnly: true,
        },
        context
      );
      if (!result.success) {
        return { ok: false, error: { code: "preview_failed", message: result.error } };
      }
      return {
        ok: true,
        data: {
          chunks: result.chunks?.map((c) => ({ id: c.id, content: c.content.slice(0, 200), metadata: c.metadata })),
          total: result.chunks?.length,
        },
      };
    },
  },
  {
    name: "reindex_document",
    description: "Reindex an existing RAG document with a new chunking strategy.",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "RAG document ID to reindex" },
        chunkStrategy: { type: "string", enum: ["fixed", "heading", "sliding", "semantic"], default: "sliding" },
      },
      required: ["documentId"],
    },
    handler: async (args, context = {}) => {
      const start = Date.now();
      const wsId = context.workspaceId || "global";

      const perm = await canModifyIndex({ workspaceId: wsId, actor: context.actor, plugin: "rag-ingestion" });
      if (!perm.allowed) {
        return { ok: false, error: { code: "permission_denied", message: perm.reason || "Cannot modify index" } };
      }

      const getResult = await callTool("rag_get", { id: args.documentId }, { ...context, workspaceId: wsId });
      if (!getResult.ok || !getResult.data?.content) {
        return { ok: false, error: { code: "not_found", message: "Document not found" } };
      }

      const result = await runPipeline(
        {
          content: getResult.data.content,
          format: "markdown",
          documentId: args.documentId,
          chunkStrategy: args.chunkStrategy || "sliding",
        },
        { ...context, workspaceId: wsId }
      );

      await auditEntry({
        operation: "reindex_document",
        workspaceId: wsId,
        actor: context.actor || "anonymous",
        correlationId: generateCorrelationId(),
        durationMs: Date.now() - start,
        success: result.success,
        chunkCount: result.chunks?.length,
        documentId: args.documentId,
      });

      if (!result.success) {
        return { ok: false, error: { code: "reindex_failed", message: result.error } };
      }
      return {
        ok: true,
        data: { documentId: args.documentId, chunks: result.chunks?.length, indexing: result.indexing },
      };
    },
  },
  {
    name: "get_ingestion_status",
    description: "Get status of an async ingestion job.",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", description: "Job ID from async ingest" } },
      required: ["jobId"],
    },
    handler: async (args, context = {}) => {
      const job = await getJob(args.jobId);
      if (!job) {
        return { ok: false, error: { code: "not_found", message: "Job not found" } };
      }
      return {
        ok: true,
        data: {
          id: job.id,
          state: job.state,
          progress: job.progress,
          result: job.result,
          error: job.error,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
        },
      };
    },
  },
];

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, plugin: name, version, status: "healthy" });
  });

  router.post("/ingest", requireScope("write"), async (req, res) => {
    const ctx = extractContext(req);
    const parsed = ingestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "validation_error", details: parsed.error.flatten() } });
    }

    const { async: runAsync, ...request } = parsed.data;

    if (runAsync) {
      const job = submitJob(
        "rag.ingestion",
        { request, context: ctx },
        { projectId: ctx.projectId, user: ctx.actor }
      );
      await auditEntry({
        operation: "ingest_async",
        ...ctx,
        correlationId: generateCorrelationId(),
        jobId: job.id,
        success: true,
      });
      return res.status(202).json({
        ok: true,
        data: { jobId: job.id, state: "queued", message: "Ingestion job submitted" },
      });
    }

    const start = Date.now();
    const result = await runPipeline(request, ctx);
    await auditEntry({
      operation: "ingest",
      ...ctx,
      correlationId: generateCorrelationId(),
      durationMs: Date.now() - start,
      success: result.success,
      chunkCount: result.chunks?.length,
      documentId: result.indexing?.documentId,
    });

    if (!result.success) {
      return res.status(400).json({ ok: false, error: { code: "ingestion_failed", message: result.error } });
    }
    res.status(201).json({
      ok: true,
      data: {
        chunks: result.chunks?.length,
        indexing: result.indexing,
        durationMs: result.durationMs,
      },
    });
  });

  router.post("/ingest-markdown", requireScope("write"), async (req, res) => {
    const ctx = extractContext(req);
    const parsed = ingestBodySchema.safeParse({ ...req.body, format: "markdown" });
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "validation_error", details: parsed.error.flatten() } });
    }
    const { async: runAsync, ...request } = parsed.data;
    if (runAsync) {
      const job = submitJob("rag.ingestion", { request, context: ctx }, { projectId: ctx.projectId, user: ctx.actor });
      return res.status(202).json({ ok: true, data: { jobId: job.id, state: "queued" } });
    }
    const result = await runPipeline(request, ctx);
    if (!result.success) {
      return res.status(400).json({ ok: false, error: { code: "ingestion_failed", message: result.error } });
    }
    res.status(201).json({ ok: true, data: { chunks: result.chunks?.length, indexing: result.indexing } });
  });

  router.post("/preview-chunks", requireScope("read"), async (req, res) => {
    const parsed = previewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "validation_error", details: parsed.error.flatten() } });
    }
    const result = await runPipeline(
      { ...parsed.data, previewOnly: true },
      extractContext(req)
    );
    if (!result.success) {
      return res.status(400).json({ ok: false, error: { code: "preview_failed", message: result.error } });
    }
    res.json({
      ok: true,
      data: {
        chunks: result.chunks?.map((c) => ({ id: c.id, content: c.content.slice(0, 300), metadata: c.metadata })),
        total: result.chunks?.length,
      },
    });
  });

  router.post("/reindex", requireScope("write"), async (req, res) => {
    const ctx = extractContext(req);
    const parsed = reindexBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "validation_error", details: parsed.error.flatten() } });
    }

    const getResult = await callTool("rag_get", { id: parsed.data.documentId }, { ...ctx, workspaceId: ctx.workspaceId });
    if (!getResult.ok || !getResult.data?.content) {
      return res.status(404).json({ ok: false, error: { code: "not_found", message: "Document not found" } });
    }

    const result = await runPipeline(
      {
        content: getResult.data.content,
        format: "markdown",
        documentId: parsed.data.documentId,
        chunkStrategy: parsed.data.chunkStrategy || "sliding",
      },
      ctx
    );

    if (!result.success) {
      return res.status(400).json({ ok: false, error: { code: "reindex_failed", message: result.error } });
    }
    res.json({ ok: true, data: { documentId: parsed.data.documentId, chunks: result.chunks?.length, indexing: result.indexing } });
  });

  router.get("/status/:jobId", requireScope("read"), async (req, res) => {
    const job = await getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: { code: "not_found", message: "Job not found" } });
    }
    res.json({
      ok: true,
      data: {
        id: job.id,
        type: job.type,
        state: job.state,
        progress: job.progress,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    });
  });

  app.use("/rag-ingestion", router);
}
