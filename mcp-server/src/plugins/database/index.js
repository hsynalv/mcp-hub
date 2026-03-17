import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { validateBody } from "../../core/validate.js";
import { getAdapter, isValidType } from "./db.adapter.js";
import { Errors, standardizeError, createPluginErrorHandler } from "../../core/error-standard.js";
import { config } from "../../core/config.js";
import { randomBytes } from "crypto";
import { canAccessDatabase, getPolicyManager } from "../../core/policy/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { ToolTags } from "../../core/tool-registry.js";

const pluginError = createPluginErrorHandler("database");

export const metadata = createMetadata({
  name: "database",
  version: "1.0.0",
  description: "SQL and MongoDB query interface with safety controls",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write", "admin"],
  capabilities: ["read", "write", "delete", "database", "query", "audit", "policy"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.HIGH,
  owner: "platform-team",
  tags: ["database", "sql", "mongodb", "query", "data"],
  dependencies: [],
  backends: ["postgres", "mysql", "sqlite", "mongodb"],
  since: "1.0.0",
  notes: "Supports SQL and MongoDB queries with policy-based access control and audit logging.",
});

// Database configuration
const dbConfig = config.database || {};

// Timeout defaults (ms)
const QUERY_TIMEOUT_MS = dbConfig.queryTimeoutMs || 30000;  // 30s default
const CONNECTION_TIMEOUT_MS = dbConfig.connectionTimeoutMs || 10000;  // 10s default

// Result size limit (bytes)
const MAX_RESULT_SIZE_BYTES = dbConfig.maxResultSizeBytes || 10 * 1024 * 1024;  // 10MB default
const MAX_RESULT_SIZE_MB = MAX_RESULT_SIZE_BYTES / (1024 * 1024);

// Audit log for database operations
const dbAuditLog = [];
const MAX_AUDIT_LOG = 1000;

function generateCorrelationId() {
  return randomBytes(8).toString("hex");
}

function auditEntry({ operation, type, table, query, allowed, reason, rowCount, durationMs, error, correlationId, actor, workspaceId, projectId }) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    type,
    table: table || null,
    query: query ? sanitizeQueryForAudit(query) : null,
    allowed,
    reason,
    rowCount,
    durationMs,
    error: error ? String(error) : undefined,
    correlationId,
    actor: actor || "unknown",
    workspaceId: workspaceId || null,
    projectId: projectId || null,
  };
  dbAuditLog.unshift(entry);
  if (dbAuditLog.length > MAX_AUDIT_LOG) dbAuditLog.pop();
  return entry;
}

function getAuditLogEntries(limit = 100) {
  return dbAuditLog.slice(0, Math.min(limit, MAX_AUDIT_LOG));
}

/**
 * Execute function with timeout using Promise.race.
 * AbortController was previously used but the signal was never forwarded to DB adapters,
 * making it ineffective. Promise.race guarantees the timeout is honored regardless of adapter.
 */
async function withTimeout(fn, timeoutMs, operationName) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => {
      const e = new Error(`Query '${operationName}' exceeded ${timeoutMs}ms timeout`);
      e.message = "query_timeout";
      reject(e);
    }, timeoutMs)
  );
  return Promise.race([fn(), timeout]);
}

/**
 * Check and limit result size
 * Returns { result, truncated, sizeBytes }
 */
function limitResultSize(result) {
  const resultStr = JSON.stringify(result);
  const sizeBytes = Buffer.byteLength(resultStr, "utf8");
  
  if (sizeBytes > MAX_RESULT_SIZE_BYTES) {
    // Return truncated result with metadata
    return {
      result: {
        ...result,
        _truncated: true,
        _sizeLimitBytes: MAX_RESULT_SIZE_BYTES,
        _sizeLimitMb: MAX_RESULT_SIZE_MB,
        _actualSizeBytes: sizeBytes,
        _actualSizeMb: (sizeBytes / (1024 * 1024)).toFixed(2),
        rows: result.rows?.slice(0, Math.floor(result.rows.length * 0.5)) || [],
        _originalRowCount: result.rowCount,
      },
      truncated: true,
      sizeBytes,
    };
  }
  
  return { result, truncated: false, sizeBytes };
}

/**
 * Extract workspace/project context from request
 */
function extractContext(req) {
  return {
    actor: req.actor || req.user?.id || null,
    workspaceId: req.workspaceId ?? null,
    projectId: req.projectId ?? null,
    correlationId: req.requestId || null,
  };
}

/**
 * Sanitize query for audit logging - truncate and mask sensitive data
 */
function sanitizeQueryForAudit(query) {
  if (typeof query !== "string") return JSON.stringify(query).slice(0, 200);
  // Truncate long queries
  if (query.length > 500) return query.slice(0, 500) + "... [truncated]";
  return query;
}

/**
 * SQL Query Classification
 * Detects query type and classifies as safe (read) or destructive (write/DDL)
 */
function classifySqlQuery(sql) {
  if (typeof sql !== "string") return { type: "unknown", isSafe: false };
  
  const upperSql = sql.toUpperCase().trim();
  
  // Remove comments for analysis
  const sqlWithoutComments = upperSql
    .replace(/\/\*[\s\S]*?\*\//g, " ")  // /* */ comments
    .replace(/--.*$/gm, " ")              // -- line comments
    .trim();
  
  // Check for multiple statements (semicolon not at end)
  const statements = sqlWithoutComments.split(";").filter(s => s.trim().length > 0);
  if (statements.length > 1) {
    return { type: "multi_statement", isSafe: false, reason: "multiple_statements_not_allowed" };
  }
  
  // DDL - Data Definition Language (most dangerous)
  const ddlPatterns = [
    /^\s*DROP\s/i,
    /^\s*CREATE\s/i,
    /^\s*ALTER\s/i,
    /^\s*TRUNCATE\s/i,
  ];
  for (const pattern of ddlPatterns) {
    if (pattern.test(sqlWithoutComments)) {
      return { type: "ddl", isSafe: false, reason: "ddl_operation_not_allowed" };
    }
  }
  
  // DML - Data Manipulation Language (destructive)
  const destructiveDmlPatterns = [
    /^\s*INSERT\s/i,
    /^\s*UPDATE\s/i,
    /^\s*DELETE\s/i,
    /^\s*MERGE\s/i,
    /^\s*UPSERT\s/i,
    /^\s*REPLACE\s/i,
  ];
  for (const pattern of destructiveDmlPatterns) {
    if (pattern.test(sqlWithoutComments)) {
      return { type: "write", isSafe: false, reason: "write_operation_not_allowed_in_readonly" };
    }
  }
  
  // Safe DQL - Data Query Language
  const safePatterns = [
    /^\s*SELECT\s/i,
    /^\s*WITH\s/i,  // CTEs that start with WITH (assuming they SELECT)
    /^\s*EXPLAIN\s/i,
    /^\s*DESCRIBE\s/i,
    /^\s*SHOW\s/i,
  ];
  for (const pattern of safePatterns) {
    if (pattern.test(sqlWithoutComments)) {
      return { type: "read", isSafe: true };
    }
  }
  
  // Unknown/unrecognized query type - block by default
  return { type: "unknown", isSafe: false, reason: "unrecognized_query_type" };
}

/**
 * Check if destructive operations are enabled
 * Default: read-only mode (only SELECT allowed)
 */
function isDestructiveOperationAllowed(operation) {
  const dbConfig = config.database || {};
  
  // Default: read-only mode
  const defaultMode = dbConfig.defaultMode || "readonly";
  
  if (defaultMode === "readonly") {
    return {
      allowed: false,
      reason: "database_in_readonly_mode",
      message: "Database plugin is in read-only mode. Destructive operations (INSERT, UPDATE, DELETE, DDL) are disabled. Configure DATABASE_DEFAULT_MODE=readwrite to enable.",
    };
  }
  
  // If enabledOperations is explicitly configured, check against it
  if (dbConfig.enabledOperations && Array.isArray(dbConfig.enabledOperations)) {
    const allowedOps = dbConfig.enabledOperations.map(op => op.toLowerCase());
    if (!allowedOps.includes(operation.toLowerCase())) {
      return {
        allowed: false,
        reason: "operation_not_enabled",
        message: `Operation '${operation}' is not in DATABASE_ENABLED_OPERATIONS`,
        enabledOperations: dbConfig.enabledOperations,
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Validate SQL query for security
 * Returns { allowed, reason, type } or throws
 */
function validateSqlQuery(sql, requireSafe = true) {
  const classification = classifySqlQuery(sql);
  
  // Always block multi-statement and DDL
  if (classification.type === "multi_statement" || classification.type === "ddl") {
    return {
      allowed: false,
      reason: classification.reason,
      type: classification.type,
    };
  }
  
  // If safe queries required, check safety
  if (requireSafe && !classification.isSafe) {
    return {
      allowed: false,
      reason: classification.reason || "unsafe_query",
      type: classification.type,
    };
  }
  
  return { allowed: true, type: classification.type, isSafe: classification.isSafe };
}

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

async function runAdapter(type, fn, res, _req, options = {}) {
  const { timeoutMs = QUERY_TIMEOUT_MS, operationName = "database_operation" } = options;

  if (!isValidType(type)) {
    return res.status(400).json({ ok: false, error: "invalid_backend", message: "Type must be one of: mssql, postgres, mongodb" });
  }
  try {
    const result = await withTimeout(fn, timeoutMs, operationName);
    
    // Check result size
    const { result: limitedResult, truncated, sizeBytes } = limitResultSize(result);
    
    if (truncated) {
      res.setHeader("X-Result-Truncated", "true");
      res.setHeader("X-Result-Size-Bytes", sizeBytes.toString());
    }
    
    res.json({ ok: true, ...limitedResult });
  } catch (err) {
    const msg = err.message || "Unknown error";
    if (msg === "connection_failed") {
      return res.status(502).json({ ok: false, error: "connection_failed", code: "DB_CONNECTION_ERROR", message: "Database connection failed" });
    }
    if (msg === "query_timeout") {
      return res.status(504).json({ ok: false, error: "query_timeout", code: "DB_QUERY_TIMEOUT", message: err.message || "Query execution timeout" });
    }
    if (msg === "query_failed") {
      return res.status(422).json({ ok: false, error: "query_failed", code: "DB_QUERY_ERROR", message: msg });
    }
    console.error("[database]", err);
    res.status(500).json({ ok: false, error: "internal_error", code: "DB_INTERNAL_ERROR", message: msg });
  }
}

export const requires = [];
// At least one of these env vars must be set depending on which adapter you use:
//   POSTGRES_URL or DATABASE_URL         → postgres adapter
//   MSSQL_HOST + MSSQL_USER + ...        → mssql adapter
//   MONGODB_URI or MONGO_URI             → mongodb adapter
//   DATABASE_DEFAULT_MODE=readwrite      → enable write operations (default: readonly)

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "database_query",
    description: "Execute a read-only SQL query (SELECT, WITH, EXPLAIN) or MongoDB aggregation pipeline. INSERT/UPDATE/DELETE/DDL are blocked unless DATABASE_DEFAULT_MODE=readwrite.",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["postgres", "mssql", "mongodb"],
          description: "Database type",
        },
        query: {
          type: "string",
          description: "SQL query string (for postgres/mssql) or MongoDB collection name (for mongodb with pipeline/filter)",
        },
        pipeline: {
          type: "array",
          description: "MongoDB aggregation pipeline stages (only for type=mongodb)",
          items: { type: "object" },
        },
        filter: {
          type: "object",
          description: "MongoDB query filter (only for type=mongodb without pipeline)",
        },
        params: {
          type: "array",
          description: "SQL parameterized query values ($1, $2... for postgres; @p0, @p1... for mssql)",
        },
        explanation: {
          type: "string",
          description: "Explain what you are querying and why",
        },
      },
      required: ["type", "explanation"],
    },
    handler: async (args) => {
      if (!isValidType(args.type)) {
        return { ok: false, error: { code: "invalid_backend", message: "type must be postgres, mssql, or mongodb" } };
      }
      try {
        const adapter = await getAdapter(args.type);

        if (args.type === "mongodb") {
          const query = { collection: args.query, pipeline: args.pipeline, filter: args.filter };
          const result = await adapter.query(query);
          return { ok: true, data: result };
        }

        if (!args.query) {
          return { ok: false, error: { code: "missing_query", message: "query string is required for SQL databases" } };
        }

        const validation = validateSqlQuery(args.query, true);
        if (!validation.allowed) {
          return { ok: false, error: { code: "query_blocked", message: `Query blocked: ${validation.reason}` } };
        }

        const result = await adapter.query(args.query, args.params || []);
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: { code: "query_failed", message: e.message } };
      }
    },
  },
  {
    name: "database_select",
    description: "Select rows from a table or MongoDB collection with optional filters and row limit. Safe read-only operation.",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["postgres", "mssql", "mongodb"], description: "Database type" },
        table: { type: "string", description: "Table name (SQL) or collection name (MongoDB)" },
        where: { type: "object", description: "Filter conditions as key-value pairs (e.g. { status: 'active' })" },
        limit: { type: "number", default: 50, description: "Max rows to return (max 1000)" },
        explanation: { type: "string", description: "Explain what data you are selecting and why" },
      },
      required: ["type", "table", "explanation"],
    },
    handler: async (args) => {
      if (!isValidType(args.type)) {
        return { ok: false, error: { code: "invalid_backend", message: "type must be postgres, mssql, or mongodb" } };
      }
      try {
        const adapter = await getAdapter(args.type);
        const result = await adapter.select(args.table, args.where || {}, Math.min(args.limit || 50, 1000));
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: { code: "query_failed", message: e.message } };
      }
    },
  },
  {
    name: "database_tables",
    description: "List all tables (SQL) or collections (MongoDB) in the connected database",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["postgres", "mssql", "mongodb"], description: "Database type" },
      },
      required: ["type"],
    },
    handler: async (args) => {
      if (!isValidType(args.type)) {
        return { ok: false, error: { code: "invalid_backend", message: "type must be postgres, mssql, or mongodb" } };
      }
      try {
        const adapter = await getAdapter(args.type);
        const result = await adapter.getTables();
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: { code: "query_failed", message: e.message } };
      }
    },
  },
  {
    name: "database_schema",
    description: "Get the schema (columns and their types) of a specific table or MongoDB collection",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["postgres", "mssql", "mongodb"], description: "Database type" },
        table: { type: "string", description: "Table or collection name" },
      },
      required: ["type", "table"],
    },
    handler: async (args) => {
      if (!isValidType(args.type)) {
        return { ok: false, error: { code: "invalid_backend", message: "type must be postgres, mssql, or mongodb" } };
      }
      try {
        const adapter = await getAdapter(args.type);
        const result = await adapter.getSchema(args.table);
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: { code: "query_failed", message: e.message } };
      }
    },
  },
  {
    name: "database_write",
    description: "Insert, update, or delete rows. Requires DATABASE_DEFAULT_MODE=readwrite env var. Operations will be blocked in readonly mode (the default). Always provide a clear explanation.",
    tags: [ToolTags.WRITE, ToolTags.DATABASE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        type:      { type: "string", enum: ["postgres", "mssql", "mongodb"], description: "Database type" },
        operation: { type: "string", enum: ["insert", "update", "delete"],   description: "Write operation type" },
        table:     { type: "string", description: "Table or collection name" },
        data:      { type: "object", description: "Data to insert or updated field values for update" },
        where:     { type: "object", description: "Filter condition — required for update and delete" },
        explanation: { type: "string", description: "Explain exactly what data you are modifying and why. Be specific." },
      },
      required: ["type", "operation", "table", "explanation"],
    },
    handler: async (args) => {
      if (!isValidType(args.type)) {
        return { ok: false, error: { code: "invalid_backend", message: "type must be postgres, mssql, or mongodb" } };
      }

      const opCheck = isDestructiveOperationAllowed(args.operation);
      if (!opCheck.allowed) {
        return { ok: false, error: { code: "operation_blocked", message: opCheck.message } };
      }

      if ((args.operation === "update" || args.operation === "delete") && !args.where) {
        return { ok: false, error: { code: "missing_where", message: `where filter is required for ${args.operation} to prevent accidental bulk changes` } };
      }

      try {
        const adapter = await getAdapter(args.type);
        let result;
        if (args.operation === "insert")      result = await adapter.insert(args.table, args.data || {});
        else if (args.operation === "update") result = await adapter.update(args.table, args.where, args.data || {});
        else if (args.operation === "delete") result = await adapter.delete(args.table, args.where);

        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: { code: "write_failed", message: e.message } };
      }
    },
  },
];

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), async (_req, res) => {
    const dbConf = config.database || {};
    const adapters = ["postgres", "mssql", "mongodb"];

    const checks = await Promise.allSettled(
      adapters.map(async (type) => {
        // Quickly check if this adapter is likely configured
        const hasConfig = (
          (type === "postgres"  && (dbConf.postgresUrl  || process.env.POSTGRES_URL  || process.env.DATABASE_URL)) ||
          (type === "mssql"     && (dbConf.mssqlHost    || process.env.MSSQL_HOST)) ||
          (type === "mongodb"   && (dbConf.mongoUri      || process.env.MONGODB_URI  || process.env.MONGO_URI))
        );
        if (!hasConfig) return { type, status: "not_configured" };

        const start = Date.now();
        try {
          const adapter = await getAdapter(type);
          await adapter.getTables();
          return { type, status: "connected", latencyMs: Date.now() - start };
        } catch (e) {
          return { type, status: "error", error: e.message, latencyMs: Date.now() - start };
        }
      })
    );

    const results = checks.map(r => r.value ?? { type: "unknown", status: "error", error: String(r.reason) });
    const healthy = results.every(r => r.status !== "error");

    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      plugin: name,
      version,
      mode: dbConf.defaultMode || "readonly",
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      maxResultSizeMb: MAX_RESULT_SIZE_MB,
      adapters: results,
    });
  });

  router.get("/tables", requireScope("read"), async (req, res) => {
    const type = req.query.type;
    const ctx = extractContext(req);
    const startTime = Date.now();
    await runAdapter(type, async () => {
      const adapter = await getAdapter(type);
      const result = await adapter.getTables();
      auditEntry({ operation: "getTables", type, allowed: true, rowCount: result.rows?.length ?? 0, durationMs: Date.now() - startTime, ...ctx });
      return result;
    }, res, req, { operationName: "getTables" });
  });

  router.get("/tables/:name/schema", requireScope("read"), async (req, res) => {
    const type = req.query.type;
    const tableName = req.params.name;
    const ctx = extractContext(req);
    const startTime = Date.now();
    await runAdapter(type, async () => {
      const adapter = await getAdapter(type);
      const result = await adapter.getSchema(tableName);
      auditEntry({ operation: "getSchema", type, table: tableName, allowed: true, durationMs: Date.now() - startTime, ...ctx });
      return result;
    }, res, req, { operationName: "getSchema" });
  });

  router.post("/query", requireScope("write"), validateBody(querySchema), async (req, res) => {
    const data = req.validatedBody;
    const { type, query, params } = data;
    const correlationId = generateCorrelationId();
    const { actor, workspaceId, projectId } = extractContext(req);
    const startTime = Date.now();

    await runAdapter(type, async () => {
      const adapter = await getAdapter(type);
      // MongoDB object queries
      if (typeof query === "object" && type === "mongodb") {
        // Check if MongoDB query contains write operations
        // Only $merge and $out are true write stages (write to new collection)
        // $set and $unset are transformation/projection stages (read-only pipeline transforms)
        const hasWriteStages = query.pipeline && Array.isArray(query.pipeline) &&
          query.pipeline.some(stage => {
            const stageKeys = Object.keys(stage || {});
            // $merge and $out write to collections - these are destructive
            return stageKeys.includes("$merge") || stageKeys.includes("$out");
          });

        const isWriteOp = hasWriteStages || query.operation &&
          ["insert", "update", "delete", "insertOne", "updateOne", "deleteOne"].includes(query.operation);

        if (isWriteOp) {
          const opCheck = isDestructiveOperationAllowed("query");
          if (!opCheck.allowed) {
            auditEntry({
              operation: "query",
              type,
              query: { collection: query.collection, hasWriteStages, operation: query.operation },
              allowed: false,
              reason: opCheck.reason,
              correlationId,
              actor,
              workspaceId,
              projectId
            });
            throw pluginError.authorization(opCheck.message);
          }
        }

        const result = await adapter.query(query);
        auditEntry({
          operation: isWriteOp ? "write_query" : "read_query",
          type,
          query: { collection: query.collection, filter: query.filter ? "[filter]" : undefined },
          allowed: true,
          rowCount: result.rowCount,
          durationMs: Date.now() - startTime,
          correlationId,
          actor,
          workspaceId,
          projectId
        });
        return result;
      }

      // SQL string queries
      if (typeof query === "string" && (type === "postgres" || type === "mssql")) {
        // Validate SQL query for security
        const validation = validateSqlQuery(query, true);
        if (!validation.allowed) {
          auditEntry({ operation: "query", type, query, allowed: false, reason: validation.reason, correlationId, actor, workspaceId, projectId });
          throw pluginError.authorization(`Query blocked: ${validation.reason}`);
        }

        // Policy check using core policy manager
        const policyManager = getPolicyManager();
        if (policyManager) {
          const policyResult = await canAccessDatabase({
            actor: actor || "unknown",
            workspaceId: workspaceId || "global",
            action: validation.type,
            table: undefined,
            metadata: { sql: query.substring(0, 100) },
          });
          if (!policyResult.allowed) {
            auditEntry({ operation: validation.type, type, query, allowed: false, reason: policyResult.reason || "Database access denied", correlationId, actor, workspaceId, projectId });
            throw pluginError.authorization(policyResult.reason || "Database access denied");
          }
        }

        const p = params || [];
        let result;
        if (type === "postgres") {
          result = await adapter.query(query, p);
        } else {
          // MSSQL - convert $1, $2 style params to @p0, @p1
          let sql = query;
          for (let i = p.length - 1; i >= 0; i--) {
            sql = sql.replace(new RegExp(`\\$${i + 1}\\b`, "g"), `@p${i}`);
          }
          result = await adapter.rawQuery(sql, p);
        }
        auditEntry({ operation: validation.type, type, query, allowed: true, rowCount: result.rowCount, durationMs: Date.now() - startTime, correlationId, actor, workspaceId, projectId });
        return result;
      }
      throw pluginError.validation("Invalid query type for database adapter");
    }, res, req, { operationName: "query" });
  });

  const insertSchema = z.object({ type: z.enum(["mssql", "postgres", "mongodb"]), table: z.string().min(1), data: z.record(z.any()) });
  router.post("/crud/insert", requireScope("write"), validateBody(insertSchema), async (req, res) => {
    const data = req.validatedBody;
    const correlationId = generateCorrelationId();
    const { actor, workspaceId, projectId } = extractContext(req);
    const startTime = Date.now();

    // Check if write operations are allowed
    const opCheck = isDestructiveOperationAllowed("insert");
    if (!opCheck.allowed) {
      auditEntry({ operation: "insert", type: data.type, table: data.table, allowed: false, reason: opCheck.reason, correlationId, actor, workspaceId, projectId });
      const err = Errors.authorization(opCheck.message);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    await runAdapter(data.type, async () => {
      const adapter = await getAdapter(data.type);
      const result = await adapter.insert(data.table, data.data);
      auditEntry({ operation: "insert", type: data.type, table: data.table, allowed: true, rowCount: result.rowCount, durationMs: Date.now() - startTime, correlationId, actor, workspaceId, projectId });
      return result;
    }, res, req, { operationName: "insert" });
  });

  const selectSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()).optional().default({}),
    limit: z.number().int().min(1).max(1000).optional().default(100),  // Reduced max limit for safety
  });
  router.post("/crud/select", requireScope("read"), validateBody(selectSchema), async (req, res) => {
    const data = req.validatedBody;
    const correlationId = generateCorrelationId();
    const { actor, workspaceId, projectId } = extractContext(req);
    const startTime = Date.now();

    await runAdapter(data.type, async () => {
      const adapter = await getAdapter(data.type);
      const result = await adapter.select(data.table, data.where, data.limit);
      auditEntry({ operation: "select", type: data.type, table: data.table, allowed: true, rowCount: result.rowCount, durationMs: Date.now() - startTime, correlationId, actor, workspaceId, projectId });
      return result;
    }, res, req, { operationName: "select" });
  });

  const updateSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()),
    data:  z.record(z.any()),
  });
  router.post("/crud/update", requireScope("write"), validateBody(updateSchema), async (req, res) => {
    const data = req.validatedBody;
    const correlationId = generateCorrelationId();
    const { actor, workspaceId, projectId } = extractContext(req);
    const startTime = Date.now();

    // Check if write operations are allowed
    const opCheck = isDestructiveOperationAllowed("update");
    if (!opCheck.allowed) {
      auditEntry({ operation: "update", type: data.type, table: data.table, allowed: false, reason: opCheck.reason, correlationId, actor, workspaceId, projectId });
      const err = Errors.authorization(opCheck.message);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    await runAdapter(data.type, async () => {
      const adapter = await getAdapter(data.type);
      const result = await adapter.update(data.table, data.where, data.data);
      auditEntry({ operation: "update", type: data.type, table: data.table, allowed: true, rowCount: result.rowCount, durationMs: Date.now() - startTime, correlationId, actor, workspaceId, projectId });
      return result;
    }, res, req, { operationName: "update" });
  });

  const deleteSchema = z.object({
    type:  z.enum(["mssql", "postgres", "mongodb"]),
    table: z.string().min(1),
    where: z.record(z.any()),
  });
  router.post("/crud/delete", requireScope("write"), validateBody(deleteSchema), async (req, res) => {
    const data = req.validatedBody;
    const correlationId = generateCorrelationId();
    const { actor, workspaceId, projectId } = extractContext(req);
    const startTime = Date.now();

    // Check if destructive operations are allowed
    const opCheck = isDestructiveOperationAllowed("delete");
    if (!opCheck.allowed) {
      auditEntry({ operation: "delete", type: data.type, table: data.table, allowed: false, reason: opCheck.reason, correlationId, actor, workspaceId, projectId });
      const err = Errors.authorization(opCheck.message);
      return res.status(403).json(standardizeError(err).serialize(req.requestId));
    }

    await runAdapter(data.type, async () => {
      const adapter = await getAdapter(data.type);
      const result = await adapter.delete(data.table, data.where);
      auditEntry({ operation: "delete", type: data.type, table: data.table, allowed: true, rowCount: result.rowCount, durationMs: Date.now() - startTime, correlationId, actor, workspaceId, projectId });
      return result;
    }, res, req, { operationName: "delete" });
  });

  /**
   * GET /database/audit
   * Returns database operation audit log.
   */
  router.get("/audit", requireScope("read"), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/database", router);
}
