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

/**
 * Limit result set for safety
 */
function limitResultSet(cursor, limit = MAX_DOCUMENT_COUNT) {
  return cursor.limit(limit);
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
      limitResultSet(cursor, limit);
      const rows = await cursor.toArray();
      return { rows, rowCount: rows.length };
    }

    // Handle find query
    if (spec.collection && (spec.filter || spec.options)) {
      const col = d.collection(spec.collection);
      const findOptions = { ...spec.options, maxTimeMS };
      const cursor = col.find(spec.filter || {}, findOptions);
      limitResultSet(cursor, limit);
      const rows = await cursor.toArray();
      return { rows, rowCount: rows.length };
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
      return { rows, rowCount: rows.length };
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
};
