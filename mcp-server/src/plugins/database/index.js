import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { getAdapter, isValidType } from "./db.adapter.js";

export const name = "database";
export const version = "1.0.0";
export const description = "MSSQL, PostgreSQL ve MongoDB ile veritabanı işlemleri";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET",  path: "/database/tables",              description: "Tablo/collection listesi", scope: "read"  },
  { method: "GET",  path: "/database/tables/:name/schema",  description: "Tablo şeması",           scope: "read"  },
  { method: "POST", path: "/database/query",                description: "Raw SQL / aggregation",   scope: "write" },
  { method: "POST", path: "/database/crud/insert",           description: "Insert",                 scope: "write" },
  { method: "POST", path: "/database/crud/select",          description: "Select",                 scope: "read"  },
  { method: "POST", path: "/database/crud/update",          description: "Update",                 scope: "write" },
  { method: "POST", path: "/database/crud/delete",          description: "Delete",                 scope: "write" },
  { method: "GET",  path: "/database/health",               description: "Plugin health",          scope: "read"  },
];
export const examples = [
  "GET  /database/tables?type=postgres",
  "GET  /database/tables/users/schema?type=postgres",
  'POST /database/query body: {"type":"postgres","query":"SELECT * FROM users LIMIT 10","params":[]}',
  'POST /database/crud/insert body: {"type":"postgres","table":"users","data":{"name":"x"}}',
];

const querySchema = z.object({
  type:  z.enum(["mssql", "postgres", "mongodb"]),
  query: z.union([z.string(), z.object({
    collection: z.string(),
    pipeline:   z.array(z.any()).optional(),
    filter:     z.record(z.any()).optional(),
    options:    z.record(z.any()).optional(),
  })]),
  params: z.array(z.any()).optional().default([]),
});

const crudSchema = z.object({
  type:  z.enum(["mssql", "postgres", "mongodb"]),
  table: z.string().min(1),
  data:  z.record(z.any()).optional(),
  where: z.record(z.any()).optional(),
  limit: z.number().int().min(1).max(10000).optional(),
});

function validate(schema, data, res) {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({ ok: false, error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

async function runAdapter(type, fn, res) {
  if (!isValidType(type)) {
    return res.status(400).json({ ok: false, error: "invalid_backend", message: "Type must be one of: mssql, postgres, mongodb" });
  }
  try {
    const adapter = await getAdapter(type);
    const result = await fn(adapter);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err.message || "Unknown error";
    if (msg === "connection_failed") {
      return res.status(502).json({ ok: false, error: "connection_failed", message: "Database connection failed" });
    }
    if (msg === "query_failed") {
      return res.status(422).json({ ok: false, error: "query_failed", message: msg });
    }
    console.error("[database]", err);
    res.status(500).json({ ok: false, error: "internal_error", message: msg });
  }
}

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  router.get("/tables", requireScope("read"), async (req, res) => {
    const type = req.query.type;
    await runAdapter(type, (adapter) => adapter.getTables(), res);
  });

  router.get("/tables/:name/schema", requireScope("read"), async (req, res) => {
    const type = req.query.type;
    const name = req.params.name;
    await runAdapter(type, (adapter) => adapter.getSchema(name), res);
  });

  router.post("/query", requireScope("write"), async (req, res) => {
    const data = validate(querySchema, req.body, res);
    if (!data) return;
    const { type, query, params } = data;
    await runAdapter(type, async (adapter) => {
      if (typeof query === "object" && type === "mongodb") {
        return adapter.query(query);
      }
      if (typeof query === "string" && (type === "postgres" || type === "mssql")) {
        const p = params || [];
        if (type === "postgres") return adapter.query(query, p);
        let sql = query;
        for (let i = p.length - 1; i >= 0; i--) {
          sql = sql.replace(new RegExp(`\\$${i + 1}\\b`, "g"), `@p${i}`);
        }
        return adapter.rawQuery(sql, p);
      }
      throw new Error("query_failed");
    }, res);
  });

  const insertSchema = z.object({ type: z.enum(["mssql", "postgres", "mongodb"]), table: z.string().min(1), data: z.record(z.any()) });
  router.post("/crud/insert", requireScope("write"), async (req, res) => {
    const data = validate(insertSchema, req.body, res);
    if (!data) return;
    await runAdapter(data.type, (adapter) => adapter.insert(data.table, data.data), res);
  });

  const selectSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()).optional().default({}),
    limit: z.number().int().min(1).max(10000).optional().default(100),
  });
  router.post("/crud/select", requireScope("read"), async (req, res) => {
    const data = validate(selectSchema, req.body, res);
    if (!data) return;
    await runAdapter(data.type, (adapter) => adapter.select(data.table, data.where, data.limit), res);
  });

  const updateSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()),
    data:  z.record(z.any()),
  });
  router.post("/crud/update", requireScope("write"), async (req, res) => {
    const data = validate(updateSchema, req.body, res);
    if (!data) return;
    await runAdapter(data.type, (adapter) => adapter.update(data.table, data.where, data.data), res);
  });

  const deleteSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()),
  });
  router.post("/crud/delete", requireScope("write"), async (req, res) => {
    const data = validate(deleteSchema, req.body, res);
    if (!data) return;
    await runAdapter(data.type, (adapter) => adapter.delete(data.table, data.where), res);
  });

  app.use("/database", router);
}
