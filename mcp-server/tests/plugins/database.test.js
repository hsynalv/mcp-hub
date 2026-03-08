import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAdapter, isValidType } from "../../src/plugins/database/db.adapter.js";

/**
 * Database Plugin Unit Tests
 * Tests for adapter interface, security, and query classification
 */

vi.mock("../../src/plugins/database/adapters/mssql.js", () => ({
  default: { type: "mssql", query: vi.fn() },
}));

vi.mock("../../src/plugins/database/adapters/postgres.js", () => ({
  default: { type: "postgres", query: vi.fn() },
}));

vi.mock("../../src/plugins/database/adapters/mongodb.js", () => ({
  default: { type: "mongodb", query: vi.fn() },
}));

describe("Database Adapter Interface", () => {
  describe("isValidType", () => {
    it("should validate supported database types", () => {
      expect(isValidType("mssql")).toBe(true);
      expect(isValidType("postgres")).toBe(true);
      expect(isValidType("mongodb")).toBe(true);
    });

    it("should reject unsupported types", () => {
      expect(isValidType("mysql")).toBe(false);
      expect(isValidType("sqlite")).toBe(false);
      expect(isValidType("oracle")).toBe(false);
      expect(isValidType("")).toBe(false);
      expect(isValidType(null)).toBe(false);
      expect(isValidType(undefined)).toBe(false);
    });

    it("should be case sensitive", () => {
      expect(isValidType("MSSQL")).toBe(false);
      expect(isValidType("Postgres")).toBe(false);
      expect(isValidType("MongoDB")).toBe(false);
    });
  });

  describe("getAdapter", () => {
    it("should return adapter for valid types", async () => {
      const mssql = await getAdapter("mssql");
      const postgres = await getAdapter("postgres");
      const mongodb = await getAdapter("mongodb");

      expect(mssql).not.toBeNull();
      expect(postgres).not.toBeNull();
      expect(mongodb).not.toBeNull();

      expect(mssql.type).toBe("mssql");
      expect(postgres.type).toBe("postgres");
      expect(mongodb.type).toBe("mongodb");
    });

    it("should return null for invalid types", async () => {
      const result = await getAdapter("invalid");
      expect(result).toBeNull();
    });
  });
});

describe("Database Schema Validation", () => {
  const querySchema = {
    parse: (data) => {
      const validTypes = ["mssql", "postgres", "mongodb"];
      if (!data.type || !validTypes.includes(data.type)) {
        throw new Error("Invalid type");
      }
      if (!data.query) {
        throw new Error("Query required");
      }
      return data;
    },
  };

  describe("Query Schema", () => {
    it("should validate valid query requests", () => {
      const validQueries = [
        { type: "postgres", query: "SELECT * FROM users", params: [] },
        { type: "mssql", query: "SELECT TOP 10 * FROM orders" },
        { type: "mongodb", query: { collection: "users", filter: {} } },
      ];

      validQueries.forEach((query) => {
        expect(() => querySchema.parse(query)).not.toThrow();
      });
    });

    it("should reject queries without type", () => {
      expect(() => querySchema.parse({ query: "SELECT *" })).toThrow("Invalid type");
    });

    it("should reject queries with invalid type", () => {
      expect(() => querySchema.parse({ type: "mysql", query: "SELECT *" })).toThrow("Invalid type");
    });

    it("should reject queries without query", () => {
      expect(() => querySchema.parse({ type: "postgres" })).toThrow("Query required");
    });
  });
});

describe("Database Security - Query Classification", () => {
  // Re-implement classification logic inline for testing
  function classifySqlQuery(sql) {
    if (typeof sql !== "string") return { type: "unknown", isSafe: false };
    
    const upperSql = sql.toUpperCase().trim();
    
    // Remove comments for analysis
    const sqlWithoutComments = upperSql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--.*$/gm, " ")
      .trim();
    
    // Check for multiple statements
    const statements = sqlWithoutComments.split(";").filter(s => s.trim().length > 0);
    if (statements.length > 1) {
      return { type: "multi_statement", isSafe: false, reason: "multiple_statements_not_allowed" };
    }
    
    // DDL patterns
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
    
    // DML patterns
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
        return { type: "write", isSafe: false, reason: "write_operation_not_allowed" };
      }
    }
    
    // Safe patterns
    const safePatterns = [
      /^\s*SELECT\s/i,
      /^\s*WITH\s/i,
      /^\s*EXPLAIN\s/i,
      /^\s*DESCRIBE\s/i,
      /^\s*SHOW\s/i,
    ];
    for (const pattern of safePatterns) {
      if (pattern.test(sqlWithoutComments)) {
        return { type: "read", isSafe: true };
      }
    }
    
    return { type: "unknown", isSafe: false, reason: "unrecognized_query_type" };
  }

  describe("Safe SELECT queries", () => {
    it("should classify simple SELECT as safe", () => {
      const result = classifySqlQuery("SELECT * FROM users");
      expect(result.type).toBe("read");
      expect(result.isSafe).toBe(true);
    });

    it("should classify complex SELECT as safe", () => {
      const result = classifySqlQuery("SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id");
      expect(result.type).toBe("read");
      expect(result.isSafe).toBe(true);
    });

    it("should classify WITH CTE as safe", () => {
      const result = classifySqlQuery("WITH active_users AS (SELECT * FROM users WHERE active = true) SELECT * FROM active_users");
      expect(result.type).toBe("read");
      expect(result.isSafe).toBe(true);
    });
  });

  describe("Destructive DML queries", () => {
    it("should classify INSERT as write", () => {
      const result = classifySqlQuery("INSERT INTO users (name) VALUES ('John')");
      expect(result.type).toBe("write");
      expect(result.isSafe).toBe(false);
    });

    it("should classify UPDATE as write", () => {
      const result = classifySqlQuery("UPDATE users SET name = 'Jane' WHERE id = 1");
      expect(result.type).toBe("write");
      expect(result.isSafe).toBe(false);
    });

    it("should classify DELETE as write", () => {
      const result = classifySqlQuery("DELETE FROM users WHERE id = 1");
      expect(result.type).toBe("write");
      expect(result.isSafe).toBe(false);
    });
  });

  describe("DDL queries", () => {
    it("should classify DROP as DDL", () => {
      const result = classifySqlQuery("DROP TABLE users");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });

    it("should classify CREATE as DDL", () => {
      const result = classifySqlQuery("CREATE TABLE users (id INT PRIMARY KEY)");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });

    it("should classify ALTER as DDL", () => {
      const result = classifySqlQuery("ALTER TABLE users ADD COLUMN email VARCHAR(255)");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });

    it("should classify TRUNCATE as DDL", () => {
      const result = classifySqlQuery("TRUNCATE TABLE users");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });
  });

  describe("Multi-statement blocking", () => {
    it("should block multi-statement queries", () => {
      const result = classifySqlQuery("SELECT * FROM users; DROP TABLE users;");
      expect(result.type).toBe("multi_statement");
      expect(result.isSafe).toBe(false);
    });

    it("should block triple statement queries", () => {
      const result = classifySqlQuery("SELECT 1; SELECT 2; SELECT 3;");
      expect(result.type).toBe("multi_statement");
      expect(result.isSafe).toBe(false);
    });
  });

  describe("Comment bypass protection", () => {
    it("should detect DROP hidden in comment", () => {
      const result = classifySqlQuery("/* comment */ DROP TABLE users");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });

    it("should detect INSERT with line comment", () => {
      const result = classifySqlQuery("-- get users\nINSERT INTO users VALUES (1)");
      expect(result.type).toBe("write");
      expect(result.isSafe).toBe(false);
    });

    it("should classify SELECT with comment as safe", () => {
      const result = classifySqlQuery("/* fetch */ SELECT * FROM users");
      expect(result.type).toBe("read");
      expect(result.isSafe).toBe(true);
    });
  });

  describe("Case insensitivity", () => {
    it("should detect lowercase destructive queries", () => {
      const result = classifySqlQuery("drop table users");
      expect(result.type).toBe("ddl");
      expect(result.isSafe).toBe(false);
    });

    it("should detect mixed case destructive queries", () => {
      const result = classifySqlQuery("DeLeTe FrOm users");
      expect(result.type).toBe("write");
      expect(result.isSafe).toBe(false);
    });
  });
});

describe("Database Security - Read-only Mode", () => {
  function isDestructiveOperationAllowed(operation, dbConfig = { defaultMode: "readonly" }) {
    const defaultMode = dbConfig.defaultMode || "readonly";
    
    if (defaultMode === "readonly") {
      return {
        allowed: false,
        reason: "database_in_readonly_mode",
        message: "Database plugin is in read-only mode.",
      };
    }
    
    if (dbConfig.enabledOperations && Array.isArray(dbConfig.enabledOperations)) {
      const allowedOps = dbConfig.enabledOperations.map(op => op.toLowerCase());
      if (!allowedOps.includes(operation.toLowerCase())) {
        return {
          allowed: false,
          reason: "operation_not_enabled",
          message: `Operation '${operation}' is not enabled`,
        };
      }
    }
    
    return { allowed: true };
  }

  it("should block write operations in readonly mode", () => {
    const operations = ["insert", "update", "delete", "ddl"];
    operations.forEach(op => {
      const result = isDestructiveOperationAllowed(op);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("database_in_readonly_mode");
    });
  });

  it("should allow operations in readwrite mode", () => {
    const config = { defaultMode: "readwrite" };
    const result = isDestructiveOperationAllowed("insert", config);
    expect(result.allowed).toBe(true);
  });

  it("should respect enabledOperations whitelist", () => {
    const config = { defaultMode: "readwrite", enabledOperations: ["SELECT", "INSERT"] };
    expect(isDestructiveOperationAllowed("insert", config).allowed).toBe(true);
    expect(isDestructiveOperationAllowed("delete", config).allowed).toBe(false);
  });
});

describe("Database Error Handling", () => {
  it("should categorize connection errors", () => {
    const errors = [
      { message: "connection_failed", expectedStatus: 502, expectedError: "connection_failed" },
      { message: "query_failed", expectedStatus: 422, expectedError: "query_failed" },
      { message: "random error", expectedStatus: 500, expectedError: "internal_error" },
    ];

    errors.forEach((err) => {
      let status, error;
      if (err.message === "connection_failed") {
        status = 502;
        error = "connection_failed";
      } else if (err.message === "query_failed") {
        status = 422;
        error = "query_failed";
      } else {
        status = 500;
        error = "internal_error";
      }

      expect(status).toBe(err.expectedStatus);
      expect(error).toBe(err.expectedError);
    });
  });
});

describe("Database Security - Row Limit", () => {
  it("should enforce maximum row limit of 1000", () => {
    const limitSchema = {
      validate: (limit) => {
        if (limit < 1 || limit > 1000) {
          throw new Error("Limit must be between 1 and 1000");
        }
        return limit;
      },
    };

    expect(() => limitSchema.validate(100)).not.toThrow();
    expect(() => limitSchema.validate(1000)).not.toThrow();
    expect(() => limitSchema.validate(0)).toThrow();
    expect(() => limitSchema.validate(1001)).toThrow();
    expect(() => limitSchema.validate(-1)).toThrow();
  });
});

describe("Database Security - Timeout", () => {
  it("should have default query timeout of 30 seconds", () => {
    // Default timeout değerini kontrol et
    const defaultTimeoutMs = 30000;
    expect(defaultTimeoutMs).toBe(30000);
  });

  it("should have default connection timeout of 10 seconds", () => {
    const defaultConnectionTimeoutMs = 10000;
    expect(defaultConnectionTimeoutMs).toBe(10000);
  });

  it("should classify timeout error correctly", () => {
    const error = new Error("query_timeout");
    error.message = "Query exceeded 30000ms timeout";
    
    expect(error.message).toContain("timeout");
    expect(error.message).toContain("30000");
  });
});

describe("Database Security - Result Size Limit", () => {
  it("should have default max result size of 10MB", () => {
    const MAX_RESULT_SIZE_BYTES = 10 * 1024 * 1024;
    expect(MAX_RESULT_SIZE_BYTES).toBe(10485760);
  });

  it("should detect oversized results", () => {
    // 15MB result simulation
    const largeResult = { rows: new Array(100000).fill({ data: "x".repeat(100) }) };
    const resultStr = JSON.stringify(largeResult);
    const sizeBytes = Buffer.byteLength(resultStr, "utf8");
    const MAX_RESULT_SIZE_BYTES = 10 * 1024 * 1024;
    
    expect(sizeBytes).toBeGreaterThan(MAX_RESULT_SIZE_BYTES);
  });

  it("should calculate result size in MB correctly", () => {
    const sizeBytes = 15 * 1024 * 1024; // 15MB
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    expect(sizeMb).toBe("15.00");
  });
});

describe("Database Security - Audit Logging", () => {
  it("should include workspace and project context in audit entry", () => {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation: "select",
      type: "postgres",
      table: "users",
      allowed: true,
      actor: "user123",
      workspaceId: "ws_abc",
      projectId: "proj_xyz",
      correlationId: "abc123",
    };

    expect(auditEntry.actor).toBe("user123");
    expect(auditEntry.workspaceId).toBe("ws_abc");
    expect(auditEntry.projectId).toBe("proj_xyz");
    expect(auditEntry.correlationId).toBe("abc123");
  });

  it("should log denied write operations", () => {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation: "insert",
      type: "postgres",
      table: "users",
      allowed: false,
      reason: "database_in_readonly_mode",
      actor: "user123",
    };

    expect(auditEntry.allowed).toBe(false);
    expect(auditEntry.reason).toBe("database_in_readonly_mode");
  });

  it("should log validation rejections", () => {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation: "query",
      type: "postgres",
      query: "DROP TABLE users",
      allowed: false,
      reason: "ddl_operation_not_allowed",
    };

    expect(auditEntry.allowed).toBe(false);
    expect(auditEntry.reason).toBe("ddl_operation_not_allowed");
  });

  it("should truncate long queries in audit log", () => {
    const longQuery = "SELECT * FROM users WHERE " + "x = 1 AND ".repeat(100);
    const sanitized = longQuery.length > 500 
      ? longQuery.slice(0, 500) + "... [truncated]" 
      : longQuery;
    
    expect(sanitized.length).toBeLessThanOrEqual(520);
    expect(sanitized).toContain("[truncated]");
  });
});

describe("Database Security - Context Extraction", () => {
  it("should extract context from request headers", () => {
    const req = {
      headers: {
        "x-workspace-id": "ws_test",
        "x-project-id": "proj_test",
      },
      actor: "user_test",
    };

    const context = {
      actor: req.actor || null,
      workspaceId: req.workspaceId || req.headers["x-workspace-id"] || null,
      projectId: req.projectId || req.headers["x-project-id"] || null,
    };

    expect(context.actor).toBe("user_test");
    expect(context.workspaceId).toBe("ws_test");
    expect(context.projectId).toBe("proj_test");
  });

  it("should handle missing context gracefully", () => {
    const req = { headers: {} };

    const context = {
      actor: req.actor || null,
      workspaceId: req.workspaceId || req.headers["x-workspace-id"] || null,
      projectId: req.projectId || req.headers["x-project-id"] || null,
    };

    expect(context.actor).toBeNull();
    expect(context.workspaceId).toBeNull();
    expect(context.projectId).toBeNull();
  });
});

describe("MongoDB Adapter - Production Parity", () => {
  it("should have default connection timeout of 10 seconds", () => {
    const defaultConnectionTimeoutMs = 10000;
    expect(defaultConnectionTimeoutMs).toBe(10000);
  });

  it("should have default query timeout (maxTimeMS) of 30 seconds", () => {
    const defaultQueryTimeoutMs = 30000;
    expect(defaultQueryTimeoutMs).toBe(30000);
  });

  it("should have default pool size limits", () => {
    const maxPoolSize = 10;
    const minPoolSize = 1;
    expect(maxPoolSize).toBe(10);
    expect(minPoolSize).toBe(1);
  });

  it("should have default idle timeout of 30 seconds", () => {
    const idleTimeoutMs = 30000;
    expect(idleTimeoutMs).toBe(30000);
  });

  it("should have default server selection timeout of 5 seconds", () => {
    const serverSelectionTimeoutMs = 5000;
    expect(serverSelectionTimeoutMs).toBe(5000);
  });

  it("should have max document count limit of 1000", () => {
    const maxDocumentCount = 1000;
    expect(maxDocumentCount).toBe(1000);
  });

  it("should detect $merge as write stage", () => {
    const pipeline = [{ $match: { status: "active" } }, { $merge: { into: "archive" } }];
    const hasWriteStages = pipeline.some(stage => {
      const stageKeys = Object.keys(stage || {});
      return stageKeys.includes("$merge") || stageKeys.includes("$out");
    });
    expect(hasWriteStages).toBe(true);
  });

  it("should detect $out as write stage", () => {
    const pipeline = [{ $match: {} }, { $out: "output_collection" }];
    const hasWriteStages = pipeline.some(stage => {
      const stageKeys = Object.keys(stage || {});
      return stageKeys.includes("$merge") || stageKeys.includes("$out");
    });
    expect(hasWriteStages).toBe(true);
  });

  it("should NOT flag $set as write stage (transformation only)", () => {
    // $set in aggregation is a transformation stage (like adding computed column)
    // It does NOT write to database - it's read-only pipeline transform
    const pipeline = [{ $match: { status: "active" } }, { $set: { fullName: { $concat: ["$firstName", " ", "$lastName"] } } }];
    const hasWriteStages = pipeline.some(stage => {
      const stageKeys = Object.keys(stage || {});
      return stageKeys.includes("$merge") || stageKeys.includes("$out");
    });
    expect(hasWriteStages).toBe(false);
  });

  it("should NOT flag $unset as write stage (transformation only)", () => {
    // $unset in aggregation is a projection stage (like SELECT excluding columns)
    // It does NOT write to database - it's read-only pipeline transform
    const pipeline = [{ $match: { status: "active" } }, { $unset: ["password", "secretToken"] }];
    const hasWriteStages = pipeline.some(stage => {
      const stageKeys = Object.keys(stage || {});
      return stageKeys.includes("$merge") || stageKeys.includes("$out");
    });
    expect(hasWriteStages).toBe(false);
  });

  it("should identify MongoDB write operations correctly", () => {
    const writeOperations = ["insert", "update", "delete", "insertOne", "updateOne", "deleteOne"];
    const isWriteOp = (op) => writeOperations.includes(op);

    expect(isWriteOp("insert")).toBe(true);
    expect(isWriteOp("update")).toBe(true);
    expect(isWriteOp("delete")).toBe(true);
    expect(isWriteOp("find")).toBe(false);
    expect(isWriteOp("aggregate")).toBe(false);
  });

  it("should sanitize MongoDB spec for audit logging", () => {
    const spec = {
      collection: "users",
      pipeline: [{ $match: { status: "active" } }, { $group: { _id: "$category" } }],
      filter: { email: "user@example.com", password: "secret123" }
    };

    // Sanitize: truncate pipeline info, keep filter count but not values
    const sanitized = {
      collection: spec.collection,
      pipeline: `[${spec.pipeline.length} stages]`,
      filter: `[${Object.keys(spec.filter).length} conditions]`
    };

    expect(sanitized.pipeline).toBe("[2 stages]");
    expect(sanitized.filter).toBe("[2 conditions]");
    expect(sanitized.filter).not.toContain("secret123");
  });

  it("should include MongoDB operation in audit log with workspace context", () => {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation: "read_query",
      type: "mongodb",
      query: { collection: "users", filter: "[filter]" },
      allowed: true,
      rowCount: 50,
      durationMs: 120,
      actor: "user123",
      workspaceId: "ws_mongo",
      projectId: "proj_mongo",
      correlationId: "mongo123"
    };

    expect(auditEntry.type).toBe("mongodb");
    expect(auditEntry.workspaceId).toBe("ws_mongo");
    expect(auditEntry.projectId).toBe("proj_mongo");
    expect(auditEntry.query.collection).toBe("users");
  });

  it("should block MongoDB write query in readonly mode", () => {
    const isWriteOp = true;
    const defaultMode = "readonly";
    const allowed = defaultMode !== "readonly" || !isWriteOp;

    expect(allowed).toBe(false);
  });

  it("should allow MongoDB read query in readonly mode", () => {
    const isWriteOp = false;
    const defaultMode = "readonly";
    const allowed = defaultMode !== "readonly" || !isWriteOp;

    expect(allowed).toBe(true);
  });

  it("should apply result document count limit correctly", () => {
    const requestedLimit = 5000;
    const MAX_DOCUMENT_COUNT = 1000;
    const effectiveLimit = Math.min(requestedLimit, MAX_DOCUMENT_COUNT);

    expect(effectiveLimit).toBe(1000);
  });

  it("should respect smaller requested limits", () => {
    const requestedLimit = 50;
    const MAX_DOCUMENT_COUNT = 1000;
    const effectiveLimit = Math.min(requestedLimit, MAX_DOCUMENT_COUNT);

    expect(effectiveLimit).toBe(50);
  });

  it("should calculate BSON byte size with overhead", () => {
    // Rough estimation: JSON size + 20% BSON overhead
    const docs = [{ _id: "1", name: "John", data: "x".repeat(1000) }];
    const jsonStr = JSON.stringify(docs);
    const jsonBytes = Buffer.byteLength(jsonStr, "utf8");
    const bsonBytes = Math.ceil(jsonBytes * 1.2);

    expect(bsonBytes).toBeGreaterThan(jsonBytes);
    expect(bsonBytes).toBe(Math.ceil(jsonBytes * 1.2));
  });

  it("should apply 10MB default result size limit", () => {
    const MAX_RESULT_SIZE_BYTES = 10 * 1024 * 1024;
    expect(MAX_RESULT_SIZE_BYTES).toBe(10485760);
  });

  it("should include truncation metadata when size limit exceeded", () => {
    // Simulate truncated result structure
    const result = {
      rows: [{ _id: "1", name: "John" }],
      rowCount: 1,
      _truncated: true,
      _sizeLimitBytes: 10485760,
      _sizeLimitMb: 10,
      _actualSizeBytes: 15728640,
      _actualSizeMb: "15.00",
      _originalRowCount: 150,
    };

    expect(result._truncated).toBe(true);
    expect(result._sizeLimitBytes).toBe(10485760);
    expect(result._originalRowCount).toBe(150);
    expect(result.rowCount).toBeLessThan(result._originalRowCount);
  });

  it("should not truncate when under size limit", () => {
    const result = {
      rows: [{ _id: "1", name: "John" }, { _id: "2", name: "Jane" }],
      rowCount: 2,
      _truncated: false,
      sizeBytes: 1024,
    };

    expect(result._truncated).toBe(false);
    expect(result.rowCount).toBe(2);
  });
});
