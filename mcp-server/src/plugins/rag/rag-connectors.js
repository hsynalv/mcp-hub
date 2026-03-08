/**
 * RAG Source Connector Interface
 * 
 * Defines the contract for all RAG data sources.
 * Implementations: GitHubConnector, NotionConnector, FileConnector, HttpConnector
 */

/**
 * Base Source Connector Interface
 * All connectors must implement these methods
 */
export class SourceConnector {
  constructor(config) {
    this.config = config;
    this.name = config.name || "unknown";
    this.type = config.type || "generic";
  }

  /**
   * Check if connector is properly configured and available
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    throw new Error("checkHealth() must be implemented by subclass");
  }

  /**
   * Crawl source and return list of documents to index
   * @param {Object} options - Crawl options (filters, depth, etc.)
   * @returns {Promise<Array<SourceDocument>>}
   */
  async crawl(options = {}) {
    throw new Error("crawl() must be implemented by subclass");
  }

  /**
   * Check if a document has changed since last index
   * @param {SourceDocument} doc - Document to check
   * @param {string} lastIndexedAt - ISO timestamp of last index
   * @returns {Promise<boolean>}
   */
  async hasChanged(doc, lastIndexedAt) {
    throw new Error("hasChanged() must be implemented by subclass");
  }

  /**
   * Extract raw content from document
   * @param {SourceDocument} doc - Document to extract
   * @returns {Promise<string>}
   */
  async extract(doc) {
    throw new Error("extract() must be implemented by subclass");
  }

  /**
   * Get metadata for a document
   * @param {SourceDocument} doc
   * @returns {Promise<Object>}
   */
  async getMetadata(doc) {
    throw new Error("getMetadata() must be implemented by subclass");
  }
}

/**
 * Source Document representation
 */
export class SourceDocument {
  constructor(id, source, type, path, options = {}) {
    this.id = id;
    this.source = source; // Connector name
    this.type = type; // file, page, issue, pr, etc.
    this.path = path; // Source-specific path
    this.content = options.content || null;
    this.metadata = {
      title: options.title || null,
      author: options.author || null,
      createdAt: options.createdAt || null,
      updatedAt: options.updatedAt || null,
      size: options.size || 0,
      language: options.language || null,
      tags: options.tags || [],
      ...options.metadata,
    };
    this.checksum = options.checksum || null;
  }
}

/**
 * Ingestion Pipeline
 * Orchestrates document crawling, chunking, embedding, and indexing
 */
export class IngestionPipeline {
  constructor(config = {}) {
    this.config = {
      chunkSize: config.chunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      maxChunkSize: config.maxChunkSize || 2000,
      embeddingModel: config.embeddingModel || "default",
      ...config,
    };
    this.connectors = new Map();
  }

  /**
   * Register a source connector
   * @param {SourceConnector} connector
   */
  registerConnector(connector) {
    this.connectors.set(connector.name, connector);
  }

  /**
   * Run ingestion for a specific connector
   * @param {string} connectorName - Name of connector to use
   * @param {Object} options - Ingestion options
   * @returns {Promise<IngestionResult>}
   */
  async ingest(connectorName, options = {}) {
    const connector = this.connectors.get(connectorName);
    if (!connector) {
      throw new Error(`Connector not found: ${connectorName}`);
    }

    // Check health
    const healthy = await connector.checkHealth();
    if (!healthy) {
      throw new Error(`Connector ${connectorName} is not healthy`);
    }

    // Crawl documents
    const docs = await connector.crawl(options);

    // Process each document
    const results = {
      total: docs.length,
      indexed: 0,
      failed: 0,
      skipped: 0,
      chunks: 0,
    };

    for (const doc of docs) {
      try {
        // Check if changed (for incremental updates)
        if (options.incremental && doc.metadata.updatedAt) {
          const hasChanged = await connector.hasChanged(doc, options.lastIndexedAt);
          if (!hasChanged) {
            results.skipped++;
            continue;
          }
        }

        // Extract content
        const content = await connector.extract(doc);

        // Chunk content
        const chunks = this.chunkContent(content);
        results.chunks += chunks.length;

        // Store chunks with metadata
        for (let i = 0; i < chunks.length; i++) {
          await this.storeChunk({
            id: `${doc.id}--chunk-${i}`,
            content: chunks[i],
            source: doc.source,
            sourceType: doc.type,
            sourcePath: doc.path,
            metadata: {
              ...doc.metadata,
              chunkIndex: i,
              totalChunks: chunks.length,
            },
            workspaceId: options.workspaceId,
          });
        }

        results.indexed++;
      } catch (err) {
        console.error(`[Ingestion] Failed to process ${doc.id}:`, err.message);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * Chunk content into smaller pieces
   * @param {string} content - Raw content to chunk
   * @returns {Array<string>} Chunks
   */
  chunkContent(content) {
    const chunks = [];
    const { chunkSize, chunkOverlap, maxChunkSize } = this.config;

    // Simple sentence-based chunking (can be replaced with more sophisticated logic)
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
    let currentChunk = "";

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize) {
        chunks.push(currentChunk.trim());
        // Keep overlap
        const words = currentChunk.split(" ");
        const overlapWords = words.slice(-Math.floor(chunkOverlap / 10)); // Approximate
        currentChunk = overlapWords.join(" ") + " " + sentence;
      } else {
        currentChunk += sentence + " ";
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Store a chunk (to be implemented by storage backend)
   * @param {Object} chunk - Chunk with content and metadata
   */
  async storeChunk(chunk) {
    // This should integrate with the RAG plugin's storage
    // For now, it's a placeholder that should be overridden
    throw new Error("storeChunk() must be implemented with storage backend");
  }
}

/**
 * Ingestion Result
 */
export class IngestionResult {
  constructor(data) {
    this.total = data.total;
    this.indexed = data.indexed;
    this.failed = data.failed;
    this.skipped = data.skipped;
    this.chunks = data.chunks;
    this.duration = data.duration;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Source Connector Registry
 */
export class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
  }

  register(name, connectorClass) {
    this.connectors.set(name, connectorClass);
  }

  create(name, config) {
    const ConnectorClass = this.connectors.get(name);
    if (!ConnectorClass) {
      throw new Error(`Unknown connector type: ${name}`);
    }
    return new ConnectorClass(config);
  }

  list() {
    return Array.from(this.connectors.keys());
  }
}

// Global registry instance
export const connectorRegistry = new ConnectorRegistry();
