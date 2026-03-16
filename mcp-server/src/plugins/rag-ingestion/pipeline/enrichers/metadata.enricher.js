/**
 * Metadata Enricher
 * Adds source metadata to chunks.
 */

/**
 * @param {Array<{ content: string, metadata: Object }>} chunks - Chunks from chunker
 * @param {Object} sourceMetadata - Source document metadata
 * @param {string} [documentId] - Parent document ID
 * @param {string} [sourceType] - markdown | text | pdf
 * @returns {Array<{ content: string, metadata: Object }>}
 */
export function enrichMetadata(chunks, sourceMetadata = {}, documentId = null, sourceType = null) {
  return chunks.map((chunk, i) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      ...(documentId && { documentId }),
      ...(sourceType && { sourceType }),
      ...(sourceMetadata && Object.keys(sourceMetadata).length > 0 && { custom: sourceMetadata }),
    },
  }));
}
