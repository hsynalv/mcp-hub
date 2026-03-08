/**
 * MongoDB adapter with production-hardened security.
 * Parity with PostgreSQL and MSSQL adapters.
 */

import { MongoClient } from "mongodb";
import { createPluginErrorHandler } from "../../../core/error-standard.js";
import { config } from "../../../core/config.js";

const pluginError = createPluginErrorHandler("database");

let client = null;
let db = null;

// Database configuration
const dbConfig = config.database || {};

// MongoDB-specific timeouts and pool settings
const CONNECTION_TIMEOUT_MS = dbConfig.connectionTimeoutMs || 10000;
const QUERY_TIMEOUT_MS = dbConfig.queryTimeoutMs || 30000;
const MAX_POOL_SIZE = dbConfig.maxPoolSize || 10;
const MIN_POOL_SIZE = dbConfig.minPoolSize || 1;
const IDLE_TIMEOUT_MS = dbConfig.idleTimeoutMs || 30000;
const WAIT_QUEUE_TIMEOUT_MS = dbConfig.waitQueueTimeoutMs || 5000;
const SERVER_SELECTION_TIMEOUT_MS = dbConfig.serverSelectionTimeoutMs || 5000;
const SOCKET_TIMEOUT_MS = dbConfig.socketTimeoutMs || 30000;

// Result size limits
const MAX_DOCUMENT_COUNT = dbConfig.maxDocumentCount || 1000;
const MAX_RESULT_SIZE_BYTES = dbConfig.maxResultSizeBytes || 10 * 1024 * 1024; // 10MB default
const MAX_RESULT_SIZE_MB = MAX_RESULT_SIZE_BYTES / (1024 * 1024);

/**
 * Calculate BSON byte size of documents
 * Rough estimation: JSON.stringify + BSON overhead
 */
function calculateByteSize(docs) {
  if (!Array.isArray(docs)) docs = [docs];
  if (docs.length === 0) return 0;

  const jsonStr = JSON.stringify(docs);
  // Add ~20% overhead for BSON type markers and field names
  return Math.ceil(Buffer.byteLength(jsonStr, "utf8") * 1.2);
}

/**
 * Apply byte size limit to result array
 * Returns truncated result with metadata if limit exceeded
 */
function applyByteSizeLimit(rows) {
  const sizeBytes = calculateByteSize(rows);

  if (sizeBytes > MAX_RESULT_SIZE_BYTES) {
    // Calculate how many documents to keep (rough estimate)
    const avgDocSize = sizeBytes / rows.length;
    const keepCount = Math.floor(MAX_RESULT_SIZE_BYTES / avgDocSize * 0.9); // 90% safety margin
    const truncatedRows = rows.slice(0, Math.max(1, keepCount));

    return {
      rows: truncatedRows,
      rowCount: truncatedRows.length,
      _truncated: true,
      _sizeLimitBytes: MAX_RESULT_SIZE_BYTES,
      _sizeLimitMb: MAX_RESULT_SIZE_MB,
      _actualSizeBytes: sizeBytes,
      _actualSizeMb: (sizeBytes / (1024 * 1024)).toFixed(2),
      _originalRowCount: rows.length,
    };
  }

  return { rows, rowCount: rows.length, _truncated: false, sizeBytes };
}

/**
 * Get MongoDB client with production-safe options
 */
async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw pluginError.validation("MONGODB_URI not configured");
  if (db) return db;

  // Production-safe MongoDB client options
  const clientOptions = {
    // Connection pool safety
    maxPoolSize: MAX_POOL_SIZE,
    minPoolSize: MIN_POOL_SIZE,
    maxIdleTimeMS: IDLE_TIMEOUT_MS,
    waitQueueTimeoutMS: WAIT_QUEUE_TIMEOUT_MS,

    // Server selection timeout
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,

    // Socket timeouts
    connectTimeoutMS: CONNECTION_TIMEOUT_MS,
    socketTimeoutMS: SOCKET_TIMEOUT_MS,

    // Retry settings
    retryWrites: true,
    retryReads: true,
  };

  try {
    client = new MongoClient(uri, clientOptions);
    await client.connect();
    db = client.db();

    // Handle connection errors
    client.on("error", (err) => {
      console.error("[database] MongoDB client error:", err);
    });

    return db;
  } catch (err) {
    throw pluginError.external("MongoDB", `Connection failed: ${err.message}`, "connection_failed");
  }
}

/**
 * Apply query timeout (maxTimeMS) to cursor or operation
 */
function applyQueryTimeout(cursorOrOperation) {
  if (cursorOrOperation && typeof cursorOrOperation.maxTimeMS === "function") {
    return cursorOrOperation.maxTimeMS(QUERY_TIMEOUT_MS);
  }
  return cursorOrOperation;
}

export default {
  // Connection and pool info for monitoring
  getConnectionInfo() {
    return {
      maxPoolSize: MAX_POOL_SIZE,
      minPoolSize: MIN_POOL_SIZE,
      maxIdleTimeMS: IDLE_TIMEOUT_MS,
      waitQueueTimeoutMS: WAIT_QUEUE_TIMEOUT_MS,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMS: CONNECTION_TIMEOUT_MS,
      socketTimeoutMS: SOCKET_TIMEOUT_MS,
      queryTimeoutMS: QUERY_TIMEOUT_MS,
      maxDocumentCount: MAX_DOCUMENT_COUNT,
    };
  },

  async getTables() {
    const d = await getDb();
    const cursor = d.listCollections();
    applyQueryTimeout(cursor);
    const cols = await cursor.toArray();
    return { tables: cols.map((c) => c.name) };
  },

  async getSchema(collectionName) {
    const d = await getDb();
    const col = d.collection(collectionName);
    const cursor = col.find({});
    applyQueryTimeout(cursor);
    const sample = await cursor.limit(1).toArray();

    if (!sample || sample.length === 0) {
      return { columns: [], primaryKey: ["_id"] };
    }

    const doc = sample[0];
    const columns = Object.keys(doc).map((k) => ({
      name:     k,
      type:     typeof doc[k],
      nullable: true,
    }));
    return { columns, primaryKey: ["_id"] };
  },

  async query(spec, options = {}) {
    const d = await getDb();
    const { maxTimeMS = QUERY_TIMEOUT_MS, limit = MAX_DOCUMENT_COUNT } = options;

    // Handle aggregation pipeline
    if (spec.collection && spec.pipeline) {
      const col = d.collection(spec.collection);
      const cursor = col.aggregate(spec.pipeline, { maxTimeMS });
      cursor.limit(limit);
      const rows = await cursor.toArray();
      const result = applyByteSizeLimit(rows);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        ...(result._truncated && {
          _truncated: true,
          _sizeLimitBytes: result._sizeLimitBytes,
          _sizeLimitMb: result._sizeLimitMb,
          _actualSizeBytes: result._actualSizeBytes,
          _actualSizeMb: result._actualSizeMb,
          _originalRowCount: result._originalRowCount,
        }),
      };
    }

    // Handle find query
    if (spec.collection && (spec.filter || spec.options)) {
      const col = d.collection(spec.collection);
      const findOptions = { ...spec.options, maxTimeMS };
      const cursor = col.find(spec.filter || {}, findOptions);
      cursor.limit(limit);
      const rows = await cursor.toArray();
      const result = applyByteSizeLimit(rows);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        ...(result._truncated && {
          _truncated: true,
          _sizeLimitBytes: result._sizeLimitBytes,
          _sizeLimitMb: result._sizeLimitMb,
          _actualSizeBytes: result._actualSizeBytes,
          _actualSizeMb: result._actualSizeMb,
          _originalRowCount: result._originalRowCount,
        }),
      };
    }

    throw pluginError.validation("Invalid MongoDB query specification");
  },

  async insert(table, data, options = {}) {
    const d = await getDb();
    const col = d.collection(table);
    const doc = typeof data === "object" && !Array.isArray(data) ? data : { value: data };

    try {
      const result = await col.insertOne(doc, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { rows: [{ _id: result.insertedId, ...doc }], rowCount: 1 };
    } catch (err) {
      throw pluginError.external("MongoDB", `Insert failed: ${err.message}`, "query_failed");
    }
  },

  async select(table, where = {}, limit = 100, options = {}) {
    const d = await getDb();
    const col = d.collection(table);
    const maxLimit = Math.min(limit, MAX_DOCUMENT_COUNT);

    try {
      const cursor = col.find(where, { maxTimeMS: QUERY_TIMEOUT_MS });
      cursor.limit(maxLimit);
      const rows = await cursor.toArray();
      const result = applyByteSizeLimit(rows);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        ...(result._truncated && {
          _truncated: true,
          _sizeLimitBytes: result._sizeLimitBytes,
          _sizeLimitMb: result._sizeLimitMb,
          _actualSizeBytes: result._actualSizeBytes,
          _actualSizeMb: result._actualSizeMb,
          _originalRowCount: result._originalRowCount,
        }),
      };
    } catch (err) {
      throw pluginError.external("MongoDB", `Select failed: ${err.message}`, "query_failed");
    }
  },

  async update(table, where, data, options = {}) {
    const d = await getDb();
    const col = d.collection(table);

    try {
      const result = await col.updateMany(where, { $set: data }, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { rows: [], rowCount: result.modifiedCount };
    } catch (err) {
      throw pluginError.external("MongoDB", `Update failed: ${err.message}`, "query_failed");
    }
  },

  async delete(table, where, options = {}) {
    const d = await getDb();
    const col = d.collection(table);

    try {
      const result = await col.deleteMany(where, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { rows: [], rowCount: result.deletedCount };
    } catch (err) {
      throw pluginError.external("MongoDB", `Delete failed: ${err.message}`, "query_failed");
    }
  },

  // Export constants for use in index.js
  MAX_DOCUMENT_COUNT,
  QUERY_TIMEOUT_MS,
  MAX_RESULT_SIZE_BYTES,
  calculateByteSize,
  applyByteSizeLimit,
};
