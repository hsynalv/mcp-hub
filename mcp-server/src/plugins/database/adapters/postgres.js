/**
 * PostgreSQL adapter.
 */

import pg from "pg";
import { createPluginErrorHandler } from "../../../core/error-standard.js";
import { config } from "../../../core/config.js";

const pluginError = createPluginErrorHandler("database");

const { Pool } = pg;

let pool = null;

// Database configuration
const dbConfig = config.database || {};
const CONNECTION_TIMEOUT_MS = dbConfig.connectionTimeoutMs || 10000;
const MAX_POOL_SIZE = dbConfig.maxPoolSize || 10;
const IDLE_TIMEOUT_MS = dbConfig.idleTimeoutMs || 30000;

function getPool() {
  if (pool) return pool;
  const connStr = process.env.PG_CONNECTION_STRING
    || (process.env.PG_HOST && process.env.PG_USER && process.env.PG_DATABASE
      ? `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD || ""}@${process.env.PG_HOST}:${process.env.PG_PORT || 5432}/${process.env.PG_DATABASE}`
      : null);
  if (!connStr) throw pluginError.validation("PostgreSQL connection not configured - set PG_CONNECTION_STRING or PG_HOST/PG_USER/PG_DATABASE");
  
  pool = new Pool({
    connectionString: connStr,
    // Connection pool safety
    max: MAX_POOL_SIZE,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    // Query timeout (statement timeout) - 30 seconds default
    statement_timeout: dbConfig.queryTimeoutMs || 30000,
  });
  
  // Handle pool errors
  pool.on("error", (err) => {
    console.error("[database] PostgreSQL pool error:", err);
  });
  
  return pool;
}

export default {
  async getTables() {
    const p = getPool();
    const r = await p.query(`
      SELECT table_name as name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return { tables: r.rows.map((row) => row.name) };
  },

  async getSchema(tableName) {
    const p = getPool();
    const r = await p.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    const pk = await p.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND i.indisprimary
    `, [tableName]);
    const primaryKey = pk.rows.map((r) => r.attname);
    return {
      columns: r.rows.map((row) => ({
        name:     row.column_name,
        type:     row.data_type,
        nullable: row.is_nullable === "YES",
      })),
      primaryKey,
    };
  },

  async query(sql, params = []) {
    const p = getPool();
    const r = await p.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount };
  },

  async insert(table, data) {
    const cols = Object.keys(data);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`;
    const r = await this.query(sql, Object.values(data));
    return { rows: r.rows, rowCount: r.rowCount };
  },

  async select(table, where = {}, limit = 100) {
    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `"${k}" = $${i + 1}`).join(" AND ");
    const sql = keys.length
      ? `SELECT * FROM "${table}" WHERE ${conditions} LIMIT $${keys.length + 1}`
      : `SELECT * FROM "${table}" LIMIT $1`;
    const params = [...Object.values(where), limit];
    const r = await this.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount };
  },

  async update(table, where, data) {
    const setParts = Object.keys(data).map((k, i) => `"${k}" = $${i + 1}`);
    const whereKeys = Object.keys(where);
    const whereParts = whereKeys.map((k, i) => `"${k}" = $${Object.keys(data).length + i + 1}`);
    const sql = `UPDATE "${table}" SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")} RETURNING *`;
    const params = [...Object.values(data), ...Object.values(where)];
    const r = await this.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount };
  },

  async delete(table, where) {
    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `"${k}" = $${i + 1}`).join(" AND ");
    const sql = `DELETE FROM "${table}" WHERE ${conditions} RETURNING *`;
    const r = await this.query(sql, Object.values(where));
    return { rows: r.rows, rowCount: r.rowCount };
  },
};
