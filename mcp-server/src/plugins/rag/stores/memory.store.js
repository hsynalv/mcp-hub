/**
 * Memory Store Implementation
 *
 * In-memory storage adapter for RAG.
 * Default for development and testing.
 * Not persistent - data lost on restart.
 */

import { RagStore, RagDocument, SearchResult } from "./store.interface.js";

/**
 * Cosine similarity between two vectors (copied from index.js for independence)
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    // Pad shorter vector
    const maxLen = Math.max(a.length, b.length);
    const aa = [...a, ...Array(maxLen - a.length).fill(0)];
    const bb = [...b, ...Array(maxLen - b.length).fill(0)];
    a = aa;
    b = bb;
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MemoryStore extends RagStore {
  constructor(config = {}) {
    super(config);
    this.name = "memory";
    // Map<workspaceId, Map<docId, RagDocument>>
    this.workspaces = new Map();
    this.nextId = 1;
  }

  /**
   * Initialize workspace storage
   */
  async initWorkspace(workspaceId) {
    const wsId = workspaceId || "global";
    if (!this.workspaces.has(wsId)) {
      this.workspaces.set(wsId, new Map());
    }
  }

  /**
   * Get or create workspace document store
   */
  _getWorkspaceStore(workspaceId) {
    const wsId = workspaceId || "global";
    if (!this.workspaces.has(wsId)) {
      this.workspaces.set(wsId, new Map());
    }
    return this.workspaces.get(wsId);
  }

  /**
   * Upsert (insert or update) a document
   */
  async upsertDocument(workspaceId, docId, document) {
    const store = this._getWorkspaceStore(workspaceId);
    store.set(docId, document);
  }

  /**
   * Get a document by ID
   */
  async getDocument(workspaceId, docId) {
    const store = this._getWorkspaceStore(workspaceId);
    return store.get(docId) || null;
  }

  /**
   * Delete a document
   */
  async deleteDocument(workspaceId, docId) {
    const store = this._getWorkspaceStore(workspaceId);
    return store.delete(docId);
  }

  /**
   * Search documents by similarity.
   *
   * When a document has per-chunk embeddings (chunkEmbeddings[]), each chunk
   * is compared independently and the document scores at the highest chunk
   * similarity. This ensures long documents are fully searchable — not just
   * by their first chunk.
   *
   * Falls back to doc.embedding for backward compatibility with documents
   * indexed before the per-chunk embedding feature was added.
   */
  async searchDocuments(workspaceId, queryEmbedding, options = {}) {
    const store    = this._getWorkspaceStore(workspaceId);
    const limit    = options.limit    || 10;
    const minScore = options.minScore || 0.1;

    const results = [];
    for (const doc of store.values()) {
      let bestScore = 0;

      if (Array.isArray(doc.chunkEmbeddings) && doc.chunkEmbeddings.length > 0) {
        // Score = best similarity across all chunks
        for (const chunkVec of doc.chunkEmbeddings) {
          const s = cosineSimilarity(queryEmbedding, chunkVec);
          if (s > bestScore) bestScore = s;
        }
      } else if (doc.embedding) {
        // Backward-compat: single document-level embedding
        bestScore = cosineSimilarity(queryEmbedding, doc.embedding);
      }

      if (bestScore >= minScore) {
        results.push(new SearchResult(doc.id, bestScore, doc.content, doc.metadata));
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Clear all documents in a workspace
   */
  async clearWorkspace(workspaceId) {
    const store = this._getWorkspaceStore(workspaceId);
    const count = store.size;
    store.clear();
    return count;
  }

  /**
   * List all documents in a workspace
   */
  async listDocuments(workspaceId, options = {}) {
    const store = this._getWorkspaceStore(workspaceId);
    const limit = options.limit || 100;

    const docs = [];
    for (const [id, doc] of store.entries()) {
      docs.push({
        id,
        metadata: doc.metadata,
        indexedAt: doc.indexedAt,
      });
    }

    return docs.slice(0, limit);
  }

  /**
   * Get workspace statistics
   */
  async getStats(workspaceId) {
    const store = this._getWorkspaceStore(workspaceId);
    const total = store.size;
    let avgEmbeddingSize = 0;

    if (total > 0) {
      let totalEmbeddingLength = 0;
      for (const doc of store.values()) {
        totalEmbeddingLength += doc.embedding?.length || 0;
      }
      avgEmbeddingSize = totalEmbeddingLength / total;
    }

    return {
      totalDocuments: total,
      avgEmbeddingSize: Math.round(avgEmbeddingSize * 100) / 100,
    };
  }

  /**
   * Check store health
   */
  async checkHealth() {
    return true; // Memory store is always healthy
  }

  /**
   * Close store connection
   */
  async close() {
    // No cleanup needed for memory store
    this.workspaces.clear();
  }
}
