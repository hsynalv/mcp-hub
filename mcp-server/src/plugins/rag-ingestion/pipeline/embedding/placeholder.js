/**
 * Embedding Step (Placeholder)
 *
 * Future: Compute embeddings per chunk before indexing.
 * Currently a pass-through; RAG plugin handles embedding at index time.
 */

/**
 * @param {Array<{ id: string, content: string, metadata: Object }>} chunks - ChunkDocuments
 * @param {Object} options - Future: model, provider, batchSize
 * @returns {Promise<Array<{ id: string, content: string, metadata: Object, embedding?: number[] }>>}
 */
export async function embedChunks(chunks, options = {}) {
  return chunks.map((c) => ({
    ...c,
    metadata: { ...c.metadata, embeddingStep: "passthrough" },
  }));
}
