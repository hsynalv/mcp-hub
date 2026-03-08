/**
 * MongoDB adapter.
 */

import { MongoClient } from "mongodb";
import { createPluginErrorHandler } from "../../../core/error-standard.js";

const pluginError = createPluginErrorHandler("database");

let client = null;
let db = null;

async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw pluginError.validation("MONGODB_URI not configured");
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  return db;
}

export default {
  async getTables() {
    const d = await getDb();
    const cols = await d.listCollections().toArray();
    return { tables: cols.map((c) => c.name) };
  },

  async getSchema(collectionName) {
    const d = await getDb();
    const col = d.collection(collectionName);
    const sample = await col.findOne();
    if (!sample) return { columns: [], primaryKey: ["_id"] };
    const columns = Object.keys(sample).map((k) => ({
      name:     k,
      type:     typeof sample[k],
      nullable: true,
    }));
    return { columns, primaryKey: ["_id"] };
  },

  async query(spec) {
    const d = await getDb();
    if (spec.collection && spec.pipeline) {
      const col = d.collection(spec.collection);
      const rows = await col.aggregate(spec.pipeline).toArray();
      return { rows, rowCount: rows.length };
    }
    if (spec.collection && (spec.filter || spec.options)) {
      const col = d.collection(spec.collection);
      const cursor = col.find(spec.filter || {}, spec.options || {});
      const rows = await cursor.toArray();
      return { rows, rowCount: rows.length };
    }
    throw pluginError.external("MongoDB", err.message);
  },

  async insert(table, data) {
    const d = await getDb();
    const col = d.collection(table);
    const doc = typeof data === "object" && !Array.isArray(data) ? data : { value: data };
    const r = await col.insertOne(doc);
    return { rows: [{ _id: r.insertedId, ...doc }], rowCount: 1 };
  },

  async select(table, where = {}, limit = 100) {
    const d = await getDb();
    const col = d.collection(table);
    const rows = await col.find(where).limit(limit).toArray();
    return { rows, rowCount: rows.length };
  },

  async update(table, where, data) {
    const d = await getDb();
    const col = d.collection(table);
    const r = await col.updateMany(where, { $set: data });
    return { rows: [], rowCount: r.modifiedCount };
  },

  async delete(table, where) {
    const d = await getDb();
    const col = d.collection(table);
    const r = await col.deleteMany(where);
    return { rows: [], rowCount: r.deletedCount };
  },
};
