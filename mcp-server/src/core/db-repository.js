/**
 * Database Abstraction Layer
 * 
 * 3-tier architecture:
 * 1. Connector - Connection pooling, driver management
 * 2. Repository - CRUD operations per entity with query building
 * 3. Policy Service - Readonly/write enforcement, timeout, max rows, redaction
 */

import { config } from "../core/config.js";

/**
 * Base Repository Class
 * Provides standardized CRUD operations with policy enforcement
 */
export class BaseRepository {
  constructor(options = {}) {
    this.tableName = options.tableName;
    this.primaryKey = options.primaryKey || "id";
    this.mode = options.mode || "readonly"; // "readonly" | "write"
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxRows = options.maxRows || 1000;
    this.redactFields = options.redactFields || [];
    this.workspaceId = options.workspaceId;
    this.auditLog = options.auditLog !== false;
  }

  /**
   * Check if operation is allowed in current mode
   */
  _checkMode(operation) {
    const writeOps = ["insert", "update", "delete", "upsert"];
    
    if (this.mode === "readonly" && writeOps.includes(operation)) {
      throw new Error(`Operation '${operation}' not allowed in readonly mode`);
    }
  }

  /**
   * Apply redaction to sensitive fields
   */
  _redact(data) {
    if (!this.redactFields.length) return data;
    
    const redacted = { ...data };
    for (const field of this.redactFields) {
      if (redacted[field]) {
        redacted[field] = "[REDACTED]";
      }
    }
    return redacted;
  }

  /**
   * Apply workspace filter
   */
  _applyWorkspaceFilter(query) {
    if (!this.workspaceId) return query;
    
    return {
      ...query,
      workspaceId: this.workspaceId,
    };
  }

  /**
   * Log audit event
   */
  _audit(operation, data, metadata = {}) {
    if (!this.auditLog) return;
    
    console.log(`[DB-AUDIT] ${operation} on ${this.tableName}`, {
      workspaceId: this.workspaceId,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  /**
   * Set query timeout
   */
  async _withTimeout(promise, operation) {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Query timeout after ${this.timeoutMs}ms: ${operation}`));
      }, this.timeoutMs);
    });
    
    return Promise.race([promise, timeout]);
  }

  /**
   * Enforce max rows limit
   */
  _enforceMaxRows(results) {
    if (results.length > this.maxRows) {
      throw new Error(`Query exceeded max rows limit (${this.maxRows})`);
    }
    return results;
  }

  // Abstract methods - to be implemented by concrete repositories
  async findById(id) {
    throw new Error("findById() must be implemented");
  }

  async findAll(query = {}) {
    throw new Error("findAll() must be implemented");
  }

  async insert(data) {
    this._checkMode("insert");
    throw new Error("insert() must be implemented");
  }

  async update(id, data) {
    this._checkMode("update");
    throw new Error("update() must be implemented");
  }

  async delete(id) {
    this._checkMode("delete");
    throw new Error("delete() must be implemented");
  }
}

/**
 * PostgreSQL Repository Implementation
 */
export class PostgresRepository extends BaseRepository {
  constructor(pool, options = {}) {
    super(options);
    this.pool = pool;
    this.dialect = "postgres";
  }

  async findById(id) {
    const query = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = $1`;
    const params = [id];
    
    if (this.workspaceId) {
      query += ` AND workspace_id = $2`;
      params.push(this.workspaceId);
    }
    
    const result = await this._withTimeout(
      this.pool.query(query, params),
      "findById"
    );
    
    return result.rows[0] ? this._redact(result.rows[0]) : null;
  }

  async findAll(query = {}) {
    let sql = `SELECT * FROM ${this.tableName}`;
    const params = [];
    const conditions = [];
    
    // Apply filters
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        conditions.push(`${key} = $${params.length + 1}`);
        params.push(value);
      }
    }
    
    // Apply workspace filter
    if (this.workspaceId) {
      conditions.push(`workspace_id = $${params.length + 1}`);
      params.push(this.workspaceId);
    }
    
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    
    // Apply limit
    sql += ` LIMIT ${this.maxRows + 1}`;
    
    const result = await this._withTimeout(
      this.pool.query(sql, params),
      "findAll"
    );
    
    return this._enforceMaxRows(result.rows).map(r => this._redact(r));
  }

  async insert(data) {
    this._checkMode("insert");
    
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    
    const query = `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`;
    
    const result = await this._withTimeout(
      this.pool.query(query, values),
      "insert"
    );
    
    this._audit("insert", data, { id: result.rows[0]?.[this.primaryKey] });
    
    return this._redact(result.rows[0]);
  }

  async update(id, data) {
    this._checkMode("update");
    
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
    
    let query = `UPDATE ${this.tableName} SET ${setClause} WHERE ${this.primaryKey} = $${values.length + 1}`;
    const params = [...values, id];
    
    if (this.workspaceId) {
      query += ` AND workspace_id = $${params.length + 1}`;
      params.push(this.workspaceId);
    }
    
    query += ` RETURNING *`;
    
    const result = await this._withTimeout(
      this.pool.query(query, params),
      "update"
    );
    
    this._audit("update", data, { id });
    
    return result.rows[0] ? this._redact(result.rows[0]) : null;
  }

  async delete(id) {
    this._checkMode("delete");
    
    let query = `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = $1`;
    const params = [id];
    
    if (this.workspaceId) {
      query += ` AND workspace_id = $2`;
      params.push(this.workspaceId);
    }
    
    query += ` RETURNING *`;
    
    const result = await this._withTimeout(
      this.pool.query(query, params),
      "delete"
    );
    
    this._audit("delete", { id }, { id });
    
    return result.rows[0] ? this._redact(result.rows[0]) : null;
  }
}

/**
 * In-Memory Repository (for development/testing)
 */
export class MemoryRepository extends BaseRepository {
  constructor(data = [], options = {}) {
    super(options);
    this.data = new Map(data.map(d => [d[this.primaryKey], d]));
    this.dialect = "memory";
  }

  async findById(id) {
    const record = this.data.get(id);
    
    if (record && this.workspaceId && record.workspaceId !== this.workspaceId) {
      return null;
    }
    
    return record ? this._redact(record) : null;
  }

  async findAll(query = {}) {
    let results = Array.from(this.data.values());
    
    // Apply filters
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        results = results.filter(r => r[key] === value);
      }
    }
    
    // Apply workspace filter
    if (this.workspaceId) {
      results = results.filter(r => r.workspaceId === this.workspaceId);
    }
    
    return this._enforceMaxRows(results).map(r => this._redact(r));
  }

  async insert(data) {
    this._checkMode("insert");
    
    const id = data[this.primaryKey] || `_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const record = { ...data, [this.primaryKey]: id };
    
    if (this.workspaceId) {
      record.workspaceId = this.workspaceId;
    }
    
    this.data.set(id, record);
    this._audit("insert", data, { id });
    
    return this._redact(record);
  }

  async update(id, data) {
    this._checkMode("update");
    
    const existing = this.data.get(id);
    if (!existing) return null;
    
    if (this.workspaceId && existing.workspaceId !== this.workspaceId) {
      return null;
    }
    
    const updated = { ...existing, ...data, [this.primaryKey]: id };
    this.data.set(id, updated);
    this._audit("update", data, { id });
    
    return this._redact(updated);
  }

  async delete(id) {
    this._checkMode("delete");
    
    const existing = this.data.get(id);
    if (!existing) return null;
    
    if (this.workspaceId && existing.workspaceId !== this.workspaceId) {
      return null;
    }
    
    this.data.delete(id);
    this._audit("delete", { id }, { id });
    
    return this._redact(existing);
  }
}

/**
 * Repository Factory
 */
export class RepositoryFactory {
  constructor(connectors = {}) {
    this.connectors = connectors;
    this.repositories = new Map();
  }

  create(entityName, type = "memory", options = {}) {
    const key = `${type}:${entityName}:${options.workspaceId || "global"}`;
    
    if (this.repositories.has(key)) {
      return this.repositories.get(key);
    }
    
    let repository;
    
    switch (type) {
      case "postgres":
        if (!this.connectors.postgres) {
          throw new Error("PostgreSQL connector not configured");
        }
        repository = new PostgresRepository(this.connectors.postgres, {
          tableName: entityName,
          ...options,
        });
        break;
        
      case "memory":
      default:
        repository = new MemoryRepository([], {
          tableName: entityName,
          ...options,
        });
        break;
    }
    
    this.repositories.set(key, repository);
    return repository;
  }
}

/**
 * Policy-enforced query service
 */
export class PolicyQueryService {
  constructor(repository, policies = {}) {
    this.repository = repository;
    this.policies = {
      readonly: false,
      maxRows: 1000,
      timeoutMs: 30000,
      redactFields: [],
      ...policies,
    };
  }

  async execute(query, operation = "select") {
    // Enforce readonly
    if (this.policies.readonly && ["insert", "update", "delete"].includes(operation)) {
      throw new Error("Write operations not allowed in readonly mode");
    }
    
    // Apply max rows
    if (query.limit && query.limit > this.policies.maxRows) {
      query.limit = this.policies.maxRows;
    }
    
    // Apply timeout via repository
    return await this.repository.findAll(query);
  }
}
