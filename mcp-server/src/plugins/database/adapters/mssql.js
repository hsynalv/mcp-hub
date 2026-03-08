/**
 * MSSQL adapter.
 */

import sql from "mssql";
import { createPluginErrorHandler } from "../../../core/error-standard.js";

const pluginError = createPluginErrorHandler("database");

let pool = null;

function getConfig() {
  if (process.env.MSSQL_CONNECTION_STRING) {
    return { connectionString: process.env.MSSQL_CONNECTION_STRING };
  }
  if (process.env.MSSQL_HOST && process.env.MSSQL_DATABASE) {
    return {
      server:   process.env.MSSQL_HOST,
      port:     parseInt(process.env.MSSQL_PORT || "1433", 10),
      user:     process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      database: process.env.MSSQL_DATABASE,
      options:  { encrypt: true, trustServerCertificate: true },
    };
  }
  throw pluginError.validation("MSSQL connection not configured - set MSSQL_CONNECTION_STRING or MSSQL_HOST/MSSQL_DATABASE");
}

async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(getConfig());
  return pool;
}

export default {
  async getTables() {
    const p = await getPool();
    const r = await p.request().query(`
      SELECT name FROM sys.tables WHERE type = 'U' ORDER BY name
    `);
    return { tables: r.recordset.map((row) => row.name) };
  },

  async getSchema(tableName) {
    const p = await getPool();
    const r = await p.request()
      .input("table", sql.NVarChar, tableName)
      .query(`
        SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION
      `);
    const pk = await p.request()
      .input("table", sql.NVarChar, tableName)
      .query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE OBJECTPROPERTY(OBJECT_ID(CONSTRAINT_SCHEMA + '.' + CONSTRAINT_NAME), 'IsPrimaryKey') = 1
        AND TABLE_NAME = @table
      `);
    const primaryKey = pk.recordset.map((row) => row.COLUMN_NAME);
    return {
      columns: r.recordset.map((row) => ({
        name:     row.column_name,
        type:     row.data_type,
        nullable: row.is_nullable === "YES",
      })),
      primaryKey,
    };
  },

  async query(sqlText, params = {}) {
    const p = await getPool();
    const req = p.request();
    Object.entries(params).forEach(([key, val], i) => {
      req.input(`p${i}`, val);
    });
    const r = await req.query(sqlText);
    return { rows: r.recordset, rowCount: r.recordset?.length ?? 0 };
  },

  async rawQuery(sqlText, params = []) {
    const p = await getPool();
    const req = p.request();
    params.forEach((val, i) => req.input(`p${i}`, val));
    const r = await req.query(sqlText);
    return { rows: r.recordset, rowCount: r.recordset?.length ?? 0 };
  },

  async insert(table, data) {
    const cols = Object.keys(data);
    const placeholders = cols.map((_, i) => `@p${i}`).join(", ");
    const sqlText = `INSERT INTO [${table}] (${cols.map((c) => `[${c}]`).join(", ")}) VALUES (${placeholders}); SELECT SCOPE_IDENTITY() as id;`;
    const p = await getPool();
    const req = p.request();
    Object.values(data).forEach((v, i) => req.input(`p${i}`, v));
    const r = await req.query(sqlText);
    return { rows: r.recordset, rowCount: 1 };
  },

  async select(table, where = {}, limit = 100) {
    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `[${k}] = @p${i}`).join(" AND ");
    const sqlText = keys.length
      ? `SELECT TOP (${limit}) * FROM [${table}] WHERE ${conditions}`
      : `SELECT TOP (${limit}) * FROM [${table}]`;
    const p = await getPool();
    const req = p.request();
    Object.values(where).forEach((v, i) => req.input(`p${i}`, v));
    const r = await req.query(sqlText);
    return { rows: r.recordset, rowCount: r.recordset?.length ?? 0 };
  },

  async update(table, where, data) {
    const setParts = Object.keys(data).map((k, i) => `[${k}] = @set${i}`);
    const whereKeys = Object.keys(where);
    const whereParts = whereKeys.map((k, i) => `[${k}] = @where${i}`);
    const sqlText = `UPDATE [${table}] SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")}`;
    const p = await getPool();
    const req = p.request();
    Object.values(data).forEach((v, i) => req.input(`set${i}`, v));
    Object.values(where).forEach((v, i) => req.input(`where${i}`, v));
    await req.query(sqlText);
    return { rows: [], rowCount: 0 };
  },

  async delete(table, where) {
    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `[${k}] = @p${i}`).join(" AND ");
    const sqlText = `DELETE FROM [${table}] WHERE ${conditions}`;
    const p = await getPool();
    const req = p.request();
    Object.values(where).forEach((v, i) => req.input(`p${i}`, v));
    await req.query(sqlText);
    return { rows: [], rowCount: 0 };
  },
};
