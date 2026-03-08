# Database Plugin

Production-hardened database plugin with query classification, read-only mode, and comprehensive audit logging. Supports PostgreSQL, MSSQL, and MongoDB.

## Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/database/tables` | GET | `read` | List tables/collections |
| `/database/tables/:name/schema` | GET | `read` | Get table schema |
| `/database/query` | POST | `write` | Execute raw SQL/NoSQL query |
| `/database/crud/select` | POST | `read` | Select rows |
| `/database/crud/insert` | POST | `write` | Insert row |
| `/database/crud/update` | POST | `write` | Update rows |
| `/database/crud/delete` | POST | `write` | Delete rows |
| `/database/audit` | GET | `read` | View audit log |
| `/database/health` | GET | `read` | Plugin health |

## Security Features

### 1. Read-only Mode (Default)

**Default behavior: READ-ONLY**

By default, the database plugin only allows SELECT queries. All write operations are blocked.

**Enable write operations:**
```env
DATABASE_DEFAULT_MODE=readwrite
```

**Whitelist specific operations:**
```env
DATABASE_DEFAULT_MODE=readwrite
DATABASE_ENABLED_OPERATIONS=SELECT,INSERT,UPDATE
```

### 2. Query Classification

All SQL queries are classified before execution:

**Safe (Read) Queries:**
- ✅ `SELECT` - Allowed by default
- ✅ `WITH` (CTEs) - Allowed by default
- ✅ `EXPLAIN` - Allowed by default
- ✅ `DESCRIBE` - Allowed by default
- ✅ `SHOW` - Allowed by default

**Destructive (Blocked by default):**
- ❌ `INSERT` - Blocked in read-only mode
- ❌ `UPDATE` - Blocked in read-only mode
- ❌ `DELETE` - Blocked in read-only mode
- ❌ `DROP` - **Always blocked**
- ❌ `CREATE` - **Always blocked**
- ❌ `ALTER` - **Always blocked**
- ❌ `TRUNCATE` - **Always blocked**

### 3. Multi-Statement Blocking

Queries containing multiple statements (semicolon-separated) are **always blocked**:
```sql
-- BLOCKED
SELECT * FROM users; DROP TABLE users;
```

### 4. Comment Bypass Protection

SQL comments are stripped during analysis to prevent bypass:
```sql
-- BLOCKED: DROP detected despite comment
/* comment */ DROP TABLE users;

-- BLOCKED: INSERT detected after line comment
-- select
INSERT INTO users VALUES (1);
```

### 5. Row Limits

Maximum rows returned per query: **1000**

### 6. Query Timeout

Every query has a maximum execution time:
- **Default: 30 seconds**
- Configurable via `DATABASE_QUERY_TIMEOUT_MS`
- Returns `504 Gateway Timeout` on timeout

### 7. Connection Pool Safety

Connection pools are configured with safety limits:
- **Max pool size**: 10 connections (configurable)
- **Connection timeout**: 10 seconds (configurable)
- **Idle timeout**: 30 seconds (configurable)
- Prevents connection exhaustion attacks

### 8. Result Size Limit

Maximum response payload size: **10MB**
- Results exceeding limit are truncated
- `X-Result-Truncated: true` header added
- Original and truncated sizes in response

### 9. Tenant / Workspace Isolation Hook

Minimum context tracking for future multi-tenant enforcement:
- Actor, workspaceId, projectId extracted from request
- Passed to audit logs for traceability
- Headers supported: `x-workspace-id`, `x-project-id`

### 10. Audit Logging

All database operations are logged:
- Timestamp, operation type, database type
- Query (sanitized, truncated to 500 chars)
- Table name (if applicable)
- Allowed/denied status and reason
- Row count, duration
- Actor, workspaceId, projectId, correlationId

Access logs: `GET /database/audit?limit=50`

**Logged scenarios:**
- ✅ Successful queries
- ✅ Timeout errors
- ✅ Connection failures
- ✅ Validation rejections (DDL, multi-statement)
- ✅ Denied write operations (readonly mode)
## Configuration

```env
# Connection strings
PG_CONNECTION_STRING=postgresql://user:pass@localhost:5432/db
MSSQL_CONNECTION_STRING=Server=localhost;Database=mydb;User Id=sa;Password=pass;
MONGODB_URI=mongodb://localhost:27017/mydb

# Security Mode
DATABASE_DEFAULT_MODE=readonly        # readonly | readwrite
DATABASE_ENABLED_OPERATIONS=SELECT,INSERT  # whitelist (optional)

# Query & Connection Timeouts (ms)
DATABASE_QUERY_TIMEOUT_MS=30000       # Default: 30s - Max query execution time
DATABASE_CONNECTION_TIMEOUT_MS=10000  # Default: 10s - Connection acquisition timeout

# Connection Pool Safety
DATABASE_MAX_POOL_SIZE=10             # Default: 10 - Max connections in pool
DATABASE_IDLE_TIMEOUT_MS=30000        # Default: 30s - Idle connection timeout

# Result Size Limit
DATABASE_MAX_RESULT_SIZE_BYTES=10485760  # Default: 10MB - Max response payload

# MongoDB-Specific Timeouts
DATABASE_SERVER_SELECTION_TIMEOUT_MS=5000   # Default: 5s - Server selection timeout
DATABASE_SOCKET_TIMEOUT_MS=30000            # Default: 30s - Socket timeout
DATABASE_WAIT_QUEUE_TIMEOUT_MS=5000         # Default: 5s - Wait queue timeout

# MongoDB Document Limit
DATABASE_MAX_DOCUMENT_COUNT=1000            # Default: 1000 - Max documents per query
```

## Database-Specific Notes

### PostgreSQL
- Uses `pg` driver with connection pool
- Query timeout via `statement_timeout` (ms)
- Pool config: `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`

### MSSQL  
- Uses `mssql` driver with connection pool
- Query timeout via `requestTimeout` (ms)
- Pool config: `max`, `min`, `idleTimeoutMillis`

### MongoDB
- Uses MongoDB native driver with connection pool
- Query timeout via `maxTimeMS` per operation
- **Write Stage Detection**: Aggregation pipelines with `$merge`, `$out`, `$set`, `$unset` are treated as write operations
- **Server Selection Timeout**: Time to select a server from the replica set
- **Socket Timeout**: Time to wait for socket operations
- **Wait Queue Timeout**: Time to wait for a connection from the pool

## Error Reference

| Error | Code | HTTP | Description |
|-------|------|------|-------------|
| `database_in_readonly_mode` | 403 | 403 | Write ops blocked, readonly mode |
| `operation_not_enabled` | 403 | 403 | Operation not in whitelist |
| `ddl_operation_not_allowed` | 403 | 403 | DROP/CREATE/ALTER/TRUNCATE blocked |
| `write_operation_not_allowed` | 403 | 403 | INSERT/UPDATE/DELETE blocked |
| `multiple_statements_not_allowed` | 403 | 403 | Semicolon-separated queries blocked |
| `unrecognized_query_type` | 403 | 403 | Unknown query pattern |
| `mongodb_write_stage_blocked` | 403 | 403 | $merge/$out blocked in readonly mode |
| `query_timeout` | DB_QUERY_TIMEOUT | 504 | Query exceeded timeout limit |
| `connection_failed` | DB_CONNECTION_ERROR | 502 | Database connection error |
| `query_failed` | DB_QUERY_ERROR | 422 | Query execution error |
| `internal_error` | DB_INTERNAL_ERROR | 500 | Unexpected server error |

## Usage Examples

### PostgreSQL - Safe SELECT
```bash
curl -X POST /database/query \
  -H "Content-Type: application/json" \
  -d '{"type":"postgres","query":"SELECT * FROM users LIMIT 10"}'
```

### MongoDB - Aggregation Pipeline (Read)
```bash
curl -X POST /database/query \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mongodb",
    "query": {
      "collection": "users",
      "pipeline": [
        { "$match": { "status": "active" } },
        { "$group": { "_id": "$department", "count": { "$sum": 1 } } }
      ]
    }
  }'
```

### MongoDB - Write Operation (Blocked in Readonly)
```bash
# BLOCKED: $merge stage is a write operation
curl -X POST /database/query \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mongodb",
    "query": {
      "collection": "users",
      "pipeline": [
        { "$match": { "status": "inactive" } },
        { "$merge": { "into": "archive" } }
      ]
    }
  }'
# → 403 write_operation_not_allowed (if readonly mode)
```

### Blocked in Readonly Mode
```bash
# BLOCKED
POST /database/query
{"type":"postgres","query":"INSERT INTO users (name) VALUES ('John')"}
# → 403 write_operation_not_allowed

# BLOCKED
POST /database/query
{"type":"postgres","query":"DROP TABLE users"}
# → 403 ddl_operation_not_allowed

# BLOCKED
POST /database/query
{"type":"postgres","query":"SELECT * FROM users; DELETE FROM orders"}
# → 403 multiple_statements_not_allowed
```

### Enable Write Operations
```bash
# Configure: DATABASE_DEFAULT_MODE=readwrite
# Then:
POST /database/crud/insert
{"type":"postgres","table":"users","data":{"name":"John"}}
```

## Security Best Practices

1. **Keep readonly mode** - Only enable readwrite if necessary
2. **Whitelist operations** - Use DATABASE_ENABLED_OPERATIONS for fine-grained control
3. **Monitor audit logs** - Check `/database/audit` for suspicious activity
4. **Use CRUD endpoints** - Prefer `/crud/*` over raw `/query` for safety
5. **Limit connections** - Use read-only database replicas for SELECT queries

## Production Checklist

- [ ] `DATABASE_DEFAULT_MODE` set to `readonly`
- [ ] Connection strings use least-privilege credentials
- [ ] If readwrite enabled: `DATABASE_ENABLED_OPERATIONS` configured
- [ ] `DATABASE_QUERY_TIMEOUT_MS` set appropriately (e.g., 30000)
- [ ] `DATABASE_CONNECTION_TIMEOUT_MS` set appropriately (e.g., 10000)
- [ ] `DATABASE_MAX_POOL_SIZE` set based on expected load (e.g., 10)
- [ ] `DATABASE_MAX_RESULT_SIZE_BYTES` set based on memory constraints
- [ ] Audit logging enabled and monitored
- [ ] Database user has minimal required permissions
- [ ] Row limits appropriate for use case
- [ ] Connection pool sized for expected concurrent load
- [ ] Timeout values tested under expected load

## Production Deployment Example

```env
# Database Plugin Production Configuration

# Read-only mode for safety
DATABASE_DEFAULT_MODE=readonly

# Timeouts (30s query, 10s connection)
DATABASE_QUERY_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=10000

# Pool safety (10 max connections)
DATABASE_MAX_POOL_SIZE=10
DATABASE_IDLE_TIMEOUT_MS=30000

# Result limit (10MB)
DATABASE_MAX_RESULT_SIZE_BYTES=10485760

# Connection strings (use read-only replicas for SELECT)
PG_CONNECTION_STRING=postgresql://readonly_user:pass@read-replica:5432/db
```

## Response Headers

When results are truncated due to size limits:
```
X-Result-Truncated: true
X-Result-Size-Bytes: 15728640
```
