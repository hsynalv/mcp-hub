/**
 * Ingestion Pipeline
 *
 * Stages: loader → normalizer → chunker → metadata enricher → embedding (optional) → indexer
 */

import { loadMarkdown, loadText, loadPdf } from "./loaders/index.js";
import { normalizeMarkdown, normalizeText } from "./normalizers/index.js";
import { chunkFixed, chunkByHeading, chunkSliding, chunkSemantic } from "./chunkers/index.js";
import { enrichMetadata } from "./enrichers/index.js";
import { embedChunks } from "./embedding/index.js";
import { indexChunks } from "./indexers/index.js";
import { CHUNK_STRATEGIES, DOCUMENT_FORMATS } from "../types.js";

const MAX_DOCUMENT_SIZE = parseInt(process.env.RAG_INGESTION_MAX_DOCUMENT_SIZE, 10) || 5 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE = parseInt(process.env.RAG_INGESTION_CHUNK_SIZE, 10) || 1500;
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.RAG_INGESTION_CHUNK_OVERLAP, 10) || 150;
const DEFAULT_MAX_CHUNKS = parseInt(process.env.RAG_INGESTION_MAX_CHUNKS, 10) || 100;
const PIPELINE_TIMEOUT_MS = parseInt(process.env.RAG_INGESTION_TIMEOUT_MS, 10) || 60_000;

/**
 * @param {IngestionRequest} request
 * @param {Object} context - { workspaceId, actor, documentId? }
 * @returns {Promise<IngestionResult>}
 */
export async function runPipeline(request, context = {}) {
  const start = Date.now();
  const workspaceId = context.workspaceId || "global";
  const documentId = request.documentId || `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (request.content.length > MAX_DOCUMENT_SIZE) {
    return {
      success: false,
      chunks: [],
      durationMs: Date.now() - start,
      error: `Document exceeds max size of ${MAX_DOCUMENT_SIZE} chars`,
    };
  }

  const format = (request.format || "text").toLowerCase();
  if (!DOCUMENT_FORMATS.includes(format)) {
    return {
      success: false,
      chunks: [],
      durationMs: Date.now() - start,
      error: `Invalid format: ${format}. Must be one of: ${DOCUMENT_FORMATS.join(", ")}`,
    };
  }

  const strategy = (request.chunkStrategy || "sliding").toLowerCase();
  if (!CHUNK_STRATEGIES.includes(strategy)) {
    return {
      success: false,
      chunks: [],
      durationMs: Date.now() - start,
      error: `Invalid chunk strategy: ${strategy}. Must be one of: ${CHUNK_STRATEGIES.join(", ")}`,
    };
  }

  const chunkSize = request.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = request.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const chunkOptions = { chunkSize, chunkOverlap, maxChunks: DEFAULT_MAX_CHUNKS };

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Pipeline timeout")), PIPELINE_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([
      executePipeline(request, format, strategy, chunkOptions, documentId, context, request.previewOnly),
      timeoutPromise,
    ]);

    result.durationMs = Date.now() - start;
    return result;
  } catch (err) {
    return {
      success: false,
      chunks: [],
      durationMs: Date.now() - start,
      error: err.message || "Pipeline failed",
    };
  }
}

async function executePipeline(request, format, strategy, chunkOptions, documentId, context, previewOnly) {
  let loaded;
  if (format === "markdown") {
    loaded = await loadMarkdown(request.content);
  } else if (format === "pdf") {
    loaded = await loadPdf(request.content);
  } else {
    loaded = await loadText(request.content);
  }

  const normalizer = format === "markdown" ? normalizeMarkdown : normalizeText;
  const normalized = normalizer(loaded.content);

  let rawChunks;
  if (strategy === "fixed") {
    rawChunks = chunkFixed(normalized, chunkOptions);
  } else if (strategy === "heading") {
    rawChunks = chunkByHeading(normalized, { ...chunkOptions, maxChunkSize: chunkOptions.chunkSize });
  } else if (strategy === "sliding") {
    rawChunks = chunkSliding(normalized, chunkOptions);
  } else {
    rawChunks = chunkSemantic(normalized, chunkOptions);
  }

  const enriched = enrichMetadata(
    rawChunks,
    request.metadata || {},
    documentId,
    loaded.metadata?.sourceType || format
  );

  const chunks = enriched.map((c, i) => ({
    id: `${documentId}--chunk-${i}`,
    content: c.content,
    metadata: { ...c.metadata, documentId, sourceType: format },
  }));

  const embedded = await embedChunks(chunks, request.embeddingOptions || {});

  if (previewOnly) {
    return {
      success: true,
      chunks: embedded,
      indexing: null,
      durationMs: 0,
    };
  }

  const indexing = await indexChunks(embedded, { ...context, workspaceId: context.workspaceId || "global" });

  return {
    success: indexing.chunksFailed === 0,
    chunks: embedded,
    indexing,
    durationMs: 0,
  };
}
