/**
 * RAG Store Interface
 *
 * Abstraction layer for document/vector storage.
 * Implementations: MemoryStore (in-memory), PgVectorStore (future), QdrantStore (future), etc.
 */

/**
 * Document structure stored in RAG index
 */
export class RagDocument {
  constructor(id, content, metadata, embedding, chunks) {
    this.id = id;
    this.content = content;
    this.metadata = metadata || {};
    this.embedding = embedding || [];
    this.chunks = chunks || [];
    this.indexedAt = new Date().toISOString();
  }
}

/**
 * Search result structure
 */
export class SearchResult {
  constructor(id, score, content, metadata) {
    this.id = id;
    this.score = score;
    this.content = content;
    this.metadata = metadata || {};
  }
}

/**
 * Base Store Interface
 * All storage adapters must implement these methods
 */
export class RagStore {
  constructor(config = {}) {
    this.config = config;
    this.name = config.name || "unknown";
  }

  /**
   * Initialize workspace storage
   * @param {string} workspaceId - Workspace identifier
   * @returns {Promise<void>}
   */
  async initWorkspace(workspaceId) {
    throw new Error("initWorkspace() must be implemented by subclass");
  }

  /**
   * Upsert (insert or update) a document
   * @param {string} workspaceId - Workspace identifier
   * @param {string} docId - Document identifier
   * @param {RagDocument} document - Document to store
   * @returns {Promise<void>}
   */
  async upsertDocument(workspaceId, docId, document) {
    throw new Error("upsertDocument() must be implemented by subclass");
  }

  /**
   * Get a document by ID
   * @param {string} workspaceId - Workspace identifier
   * @param {string} docId - Document identifier
   * @returns {Promise<RagDocument|null>}
   */
  async getDocument(workspaceId, docId) {
    throw new Error("getDocument() must be implemented by subclass");
  }

  /**
   * Delete a document
   * @param {string} workspaceId - Workspace identifier
   * @param {string} docId - Document identifier
   * @returns {Promise<boolean>} - True if document existed and was deleted
   */
  async deleteDocument(workspaceId, docId) {
    throw new Error("deleteDocument() must be implemented by subclass");
  }

  /**
   * Search documents by similarity
   * @param {string} workspaceId - Workspace identifier
   * @param {Array<number>} queryEmbedding - Query vector
   * @param {Object} options - Search options
   * @param {number} options.limit - Max results
   * @param {number} options.minScore - Minimum similarity threshold
   * @returns {Promise<Array<SearchResult>>}
   */
  async searchDocuments(workspaceId, queryEmbedding, options = {}) {
    throw new Error("searchDocuments() must be implemented by subclass");
  }

  /**
   * Clear all documents in a workspace
   * @param {string} workspaceId - Workspace identifier
   * @returns {Promise<number>} - Number of documents cleared
   */
  async clearWorkspace(workspaceId) {
    throw new Error("clearWorkspace() must be implemented by subclass");
  }

  /**
   * List all documents in a workspace (for admin/debug)
   * @param {string} workspaceId - Workspace identifier
   * @param {Object} options - List options
   * @param {number} options.limit - Max documents to return
   * @returns {Promise<Array<{id, metadata, indexedAt}>>}
   */
  async listDocuments(workspaceId, options = {}) {
    throw new Error("listDocuments() must be implemented by subclass");
  }

  /**
   * Get workspace statistics
   * @param {string} workspaceId - Workspace identifier
   * @returns {Promise<{totalDocuments, avgEmbeddingSize}>}
   */
  async getStats(workspaceId) {
    throw new Error("getStats() must be implemented by subclass");
  }

  /**
   * Check store health
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    throw new Error("checkHealth() must be implemented by subclass");
  }

  /**
   * Close store connection (cleanup)
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error("close() must be implemented by subclass");
  }
}

/**
 * Store factory - creates appropriate store instance based on config
 */
export function createStore(config = {}) {
  const type = config.type || "memory";

  switch (type) {
    case "memory":
      // Dynamic import to avoid circular dependencies
      return import("./memory.store.js").then(m => new m.MemoryStore(config));
    // Future implementations:
    // case "pgvector":
    //   return import("./pgvector.store.js").then(m => new m.PgVectorStore(config));
    // case "qdrant":
    //   return import("./qdrant.store.js").then(m => new m.QdrantStore(config));
    // case "sqlite":
    //   return import("./sqlite.store.js").then(m => new m.SqliteStore(config));
    default:
      throw new Error(`Unknown store type: ${type}`);
  }
}
