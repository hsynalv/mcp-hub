/**
 * Sliding-Window Chunker
 * Deterministic sliding window with overlap.
 */

/**
 * @param {string} text - Normalized text
 * @param {Object} options
 * @param {number} [options.chunkSize=1500]
 * @param {number} [options.chunkOverlap=150]
 * @param {number} [options.maxChunks=100]
 * @returns {Array<{ content: string, metadata: { chunkIndex: number, totalChunks: number } }>}
 */
export function chunkSliding(text, options = {}) {
  const chunkSize = options.chunkSize ?? 1500;
  const overlap = options.chunkOverlap ?? 150;
  const maxChunks = options.maxChunks ?? 100;

  if (!text || text.length === 0) return [];

  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < maxChunks) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        metadata: { chunkIndex: chunks.length, totalChunks: 0 },
      });
    }
    start += chunkSize - overlap;
    if (start >= text.length) break;
  }

  chunks.forEach((c, i) => {
    c.metadata.totalChunks = chunks.length;
  });

  return chunks;
}
