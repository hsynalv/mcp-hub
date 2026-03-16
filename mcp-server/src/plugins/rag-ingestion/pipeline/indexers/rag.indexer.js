/**
 * RAG Indexer
 * Sends chunks to the RAG plugin via callTool.
 */

import { callTool } from "../../../../core/tool-registry.js";

const BATCH_SIZE = 10;

/**
 * @param {Array<{ id: string, content: string, metadata: Object }>} chunks - ChunkDocuments with ids
 * @param {Object} context - Execution context (workspaceId, actor, etc.)
 * @returns {Promise<{ documentId: string, chunksIndexed: number, chunksFailed: number, errors?: string[] }>}
 */
export async function indexChunks(chunks, context = {}) {
  const workspaceId = context.workspaceId || "global";
  const documentId = chunks[0]?.metadata?.documentId || `ingest-${Date.now()}`;
  let chunksIndexed = 0;
  let chunksFailed = 0;
  const errors = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const documents = batch.map((c) => ({
      content: c.content,
      metadata: sanitizeMetadata(c.metadata),
      id: c.id,
    }));

    const result = await callTool(
      "rag_index_batch",
      { documents },
      { ...context, workspaceId }
    );

    if (!result.ok && result.error?.code === "tool_not_found") {
      throw new Error("RAG plugin required for indexing. Ensure rag plugin is loaded.");
    }

    if (result.ok && result.data?.documents) {
      for (const doc of result.data.documents) {
        if (doc.indexed) chunksIndexed++;
        else chunksFailed++;
        if (doc.error) errors.push(doc.error);
      }
    } else {
      chunksFailed += batch.length;
      errors.push(result.error?.message || "Index batch failed");
    }
  }

  return {
    documentId,
    chunksIndexed,
    chunksFailed,
    ...(errors.length > 0 && { errors }),
  };
}

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== "object") return {};
  const allowed = ["chunkIndex", "totalChunks", "heading", "headingPath", "sourceType", "documentId"];
  const out = {};
  for (const k of allowed) {
    if (meta[k] !== undefined) out[k] = meta[k];
  }
  if (meta.custom && typeof meta.custom === "object") {
    Object.assign(out, meta.custom);
  }
  return out;
}
