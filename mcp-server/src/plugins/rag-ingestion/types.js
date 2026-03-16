/**
 * RAG Ingestion Types
 *
 * Interfaces and types for the document ingestion pipeline.
 */

/**
 * @typedef {Object} IngestionRequest
 * @property {string} content - Raw document content (markdown, plain text, or base64 for binary)
 * @property {string} [format] - Document format: "markdown" | "text" | "pdf"
 * @property {string} [documentId] - Optional document ID for reindexing
 * @property {Object} [metadata] - Source metadata (title, source, etc.)
 * @property {string} [chunkStrategy] - Chunking strategy: "fixed" | "heading" | "sliding" | "semantic"
 * @property {number} [chunkSize] - Max chunk size in chars (strategy-dependent)
 * @property {number} [chunkOverlap] - Overlap in chars for sliding window
 * @property {boolean} [previewOnly] - If true, return chunks without indexing
 */

/**
 * @typedef {Object} ChunkMetadata
 * @property {number} chunkIndex - Zero-based chunk index
 * @property {number} totalChunks - Total chunks in document
 * @property {string} [heading] - Section heading if structure-aware
 * @property {string[]} [headingPath] - Breadcrumb of headings (e.g. ["Chapter 1", "Section 1.1"])
 * @property {string} [sourceType] - "markdown" | "text" | "pdf"
 * @property {string} [documentId] - Parent document ID
 * @property {Object} [custom] - Additional metadata
 */

/**
 * @typedef {Object} ChunkDocument
 * @property {string} id - Unique chunk ID (e.g. "doc-1--chunk-0")
 * @property {string} content - Chunk text content
 * @property {ChunkMetadata} metadata - Chunk metadata
 */

/**
 * @typedef {Object} IndexingResult
 * @property {string} documentId - Indexed document ID
 * @property {number} chunksIndexed - Number of chunks successfully indexed
 * @property {number} chunksFailed - Number of chunks that failed
 * @property {string[]} [errors] - Error messages if any
 */

/**
 * @typedef {Object} IngestionResult
 * @property {boolean} success - Whether ingestion completed successfully
 * @property {ChunkDocument[]} chunks - Produced chunks (always present for preview)
 * @property {IndexingResult|null} [indexing] - Indexing result if not previewOnly
 * @property {string} [jobId] - Job ID if submitted as async job
 * @property {number} durationMs - Pipeline duration in milliseconds
 * @property {string} [error] - Error message if success is false
 */

export const CHUNK_STRATEGIES = ["fixed", "heading", "sliding", "semantic"];

export const DOCUMENT_FORMATS = ["markdown", "text", "pdf"];
