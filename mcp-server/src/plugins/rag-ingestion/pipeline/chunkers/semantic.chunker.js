/**
 * Semantic Chunker (Placeholder)
 *
 * Future: Use embeddings or LLM to split at semantic boundaries.
 * Falls back to heading-aware chunking when structure exists, else sliding window.
 */

import { chunkByHeading } from "./heading.chunker.js";
import { chunkSliding } from "./sliding.chunker.js";

/**
 * @param {string} text - Normalized text
 * @param {Object} options
 * @returns {Array<{ content: string, metadata: Object }>}
 */
export function chunkSemantic(text, options = {}) {
  const hasStructure = /^#{1,6}\s/m.test(text);
  if (hasStructure) {
    return chunkByHeading(text, options);
  }
  return chunkSliding(text, options);
}
