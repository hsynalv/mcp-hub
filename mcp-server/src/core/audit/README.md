# Core Audit System

A unified, production-ready, extensible audit logging infrastructure for all MCP plugins.

## Overview

The audit system provides centralized audit logging with the following key features:

- **Standardized Audit Events**: Common event format across all plugins
- **Multiple Sink Types**: Memory, File, and Multi-sink support
- **Automatic Sanitization**: PII and sensitive data redaction
- **Failure Tolerance**: Best-effort logging that doesn't block operations
- **Workspace Isolation**: Per-workspace audit trail separation
- **Configurable**: Environment-based configuration

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Plugins                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  shell   │ │llm-router│ │   rag    │ │  others  │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
└───────┼────────────┼────────────┼────────────┼─────────────┘
        │            │            │            │
        └────────────┴────────────┴────────────┘
                         │
              ┌──────────▼──────────┐
              │    AuditManager     │
              │  ┌───────────────┐  │
              │  │  Sanitize     │  │
              │  │  Validate     │  │
              │  │  Route        │  │
              │  └───────────────┘  │
              └──────────┬──────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐     ┌─────▼─────┐   ┌────▼────┐
   │ Memory  │     │   File    │   │  Multi  │
   │  Sink   │     │   Sink    │   │  Sink   │
   └─────────┘     └───────────┘   └─────────┘
```

## Quick Start

### For Plugin Developers

Import the audit utilities:

```javascript
import { auditLog, getAuditManager, generateCorrelationId } from "../core/audit/index.js";
```

Log an audit event:

```javascript
await auditLog({
  plugin: "my-plugin",
  operation: "execute",
  actor: "user@example.com",
  workspaceId: "ws-123",
  allowed: true,
  success: true,
  durationMs: 150,
  metadata: {
    // Additional context (automatically sanitized)
    command: "ls -la",
  },
});
```

### Configuration

Configure via environment variables:

```bash
# Enable/disable audit logging
export AUDIT_ENABLED=true

# Select sinks (comma-separated): memory, file
export AUDIT_SINKS=memory,file

# Memory sink settings
export AUDIT_MEMORY_MAX_ENTRIES=1000

# File sink settings  
export AUDIT_FILE_PATH=./data/audit.log
export AUDIT_FILE_MAX_SIZE_MB=50

# Sanitization settings
export AUDIT_SANITIZE_STRICT=true
```

## Audit Event Standard

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string (ISO 8601) | Event timestamp |
| `plugin` | string | Plugin name |
| `operation` | string | Operation type |
| `actor` | string | User/system identifier |
| `workspaceId` | string | Workspace identifier |
| `correlationId` | string | Request correlation ID |
| `allowed` | boolean | Whether operation was allowed |
| `durationMs` | number | Operation duration |
| `success` | boolean | Whether operation succeeded |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | string | Project identifier |
| `reason` | string | Denial reason |
| `error` | string | Error message |
| `metadata` | object | Additional context |

### Example Event

```json
{
  "timestamp": "2026-03-09T12:34:56.789Z",
  "plugin": "shell",
  "operation": "execute",
  "actor": "user@example.com",
  "workspaceId": "ws-abc123",
  "projectId": "proj-xyz789",
  "correlationId": "audit-1741505696789-a1b2c3d4",
  "allowed": true,
  "durationMs": 150,
  "success": true,
  "metadata": {
    "command": "ls -la",
    "cwd": "/home/user/project",
    "exitCode": 0
  }
}
```

## Sanitization

Sensitive fields are automatically redacted:

### Default Sensitive Patterns

- `password`, `passwd`, `pwd`
- `secret`, `apiKey`, `api_key`
- `token`, `authToken`, `bearer`
- `creditCard`, `ssn`, `privateKey`

### Sanitization Modes

**Strict Mode** (default):
- Metadata keys checked against allowlist
- Only allowed keys are preserved
- Unknown keys are redacted

**Lenient Mode**:
- Metadata keys checked against sensitive patterns
- Only sensitive keys are redacted
- Most data is preserved

## Sinks

### MemoryAuditSink

In-memory storage with FIFO eviction.

```javascript
import { MemoryAuditSink } from "../core/audit/index.js";

const sink = new MemoryAuditSink({
  maxEntries: 1000,  // Max events to keep
});

await sink.write(event);
const entries = await sink.read(100, 0, { plugin: "shell" });
```

**Features:**
- Fast in-memory access
- Automatic eviction of old entries
- Filtering by plugin, operation, workspace, etc.

### FileAuditSink

Persistent JSONL file storage with rotation.

```javascript
import { FileAuditSink } from "../core/audit/index.js";

const sink = new FileAuditSink("./logs/audit.log", {
  maxFileSize: 50 * 1024 * 1024,  // 50MB
  maxFiles: 5,                     // Keep 5 rotated files
  bufferSize: 10,                  // Buffer before flush
  flushInterval: 1000,            // Flush every 1s
});
```

**Features:**
- Append-only JSONL format
- Automatic rotation by size
- Async buffered writes
- Corruption-resistant (one bad line doesn't break the file)

### MultiAuditSink

Dispatch to multiple sinks simultaneously.

```javascript
import { MultiAuditSink, MemoryAuditSink, FileAuditSink } from "../core/audit/index.js";

const sink = new MultiAuditSink([
  new MemoryAuditSink({ maxEntries: 1000 }),
  new FileAuditSink("./logs/audit.log"),
]);
```

**Features:**
- One sink failure doesn't block others
- Parallel writes for performance
- Aggregated statistics

## AuditManager

Central management for audit operations.

```javascript
import { AuditManager, getAuditManager, initAuditManager } from "../core/audit/index.js";

// Initialize with config
const manager = new AuditManager({
  enabled: true,
  sinks: ["memory", "file"],
  memoryMaxEntries: 1000,
  filePath: "./data/audit.log",
  fileMaxSizeMB: 50,
  sanitizeStrict: true,
});

await manager.init();

// Log events
await manager.log({
  plugin: "my-plugin",
  operation: "test",
  actor: "user@example.com",
  workspaceId: "ws-1",
  allowed: true,
  success: true,
  durationMs: 100,
});

// Query recent entries
const entries = await manager.getRecentEntries({
  limit: 100,
  plugin: "my-plugin",
  allowed: true,
});

// Get statistics
const stats = await manager.getStats();
```

### Global Instance

Use the singleton for cross-plugin consistency:

```javascript
import { auditLog, auditEmit, getAuditManager } from "../core/audit/index.js";

// These use the global instance
await auditLog({ ... });
await auditEmit({ ... });

const manager = getAuditManager();
```

## Migration Guide

### From Plugin-Specific Audit

Old approach (shell plugin):
```javascript
// Old: Direct array manipulation
const auditLog = [];
auditLog.unshift({ timestamp: ..., command: ..., allowed: ... });
```

New approach:
```javascript
// New: Use core audit manager
import { auditLog } from "../core/audit/index.js";

await auditLog({
  plugin: "shell",
  operation: "execute",
  actor: context.actor,
  workspaceId: context.workspaceId,
  allowed: true,
  success: true,
  durationMs: 150,
  metadata: { command, cwd, exitCode },
});
```

### Retrieving Audit Entries

Old approach:
```javascript
// Old: Direct array access
return auditLog.slice(0, limit);
```

New approach:
```javascript
// New: Use core audit manager
import { getAuditManager } from "../core/audit/index.js";

const manager = getAuditManager();
const entries = await manager.getRecentEntries({ 
  limit, 
  plugin: "shell" 
});
```

## Testing

Run audit system tests:

```bash
npm test src/core/audit/audit.test.js
```

Tests cover:
- Event validation and sanitization
- Memory sink operations
- File sink operations with rotation
- Multi-sink dispatch
- AuditManager integration
- Configuration handling

## Production Checklist

- [ ] Configure `AUDIT_ENABLED=true`
- [ ] Select appropriate sinks (recommend: memory + file)
- [ ] Set `AUDIT_FILE_PATH` to persistent storage
- [ ] Configure rotation limits for file sink
- [ ] Set up log aggregation/forwarding if needed
- [ ] Monitor audit file sizes
- [ ] Test audit log recovery procedures
- [ ] Verify sensitive data is properly sanitized
- [ ] Document retention policies

## API Reference

### Functions

- `auditLog(params)` - Log an audit event
- `auditEmit(event)` - Emit a pre-constructed event
- `generateCorrelationId()` - Generate unique correlation ID
- `validateAuditEvent(event)` - Validate event format
- `sanitizeAuditEvent(event, options)` - Sanitize sensitive data
- `getAuditManager(config?)` - Get/create AuditManager instance
- `initAuditManager(config?)` - Initialize global manager

### Classes

- `AuditManager` - Central audit management
- `MemoryAuditSink` - In-memory storage
- `FileAuditSink` - File-based storage
- `MultiAuditSink` - Multi-sink dispatch
- `AuditSink` - Abstract base class

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_ENABLED` | `true` | Enable/disable audit logging |
| `AUDIT_SINKS` | `memory` | Comma-separated sink types |
| `AUDIT_MEMORY_MAX_ENTRIES` | `1000` | Max entries for memory sink |
| `AUDIT_FILE_PATH` | `./data/audit.log` | File sink path |
| `AUDIT_FILE_MAX_SIZE_MB` | `50` | Rotation size in MB |
| `AUDIT_SANITIZE_STRICT` | `true` | Strict sanitization mode |
| `AUDIT_SENSITIVE_PATTERNS` | `[]` | Additional sensitive patterns |

## Troubleshooting

### Audit events not appearing

1. Check `AUDIT_ENABLED=true`
2. Verify sink configuration
3. Check file permissions for file sink
4. Review logs for initialization errors

### Sensitive data in logs

1. Ensure `AUDIT_SANITIZE_STRICT=true`
2. Verify metadata keys match allowlist
3. Check custom sensitive patterns

### Performance issues

1. Increase `AUDIT_MEMORY_MAX_ENTRIES`
2. Use file sink with larger buffer
3. Consider multi-sink for redundancy
4. Monitor disk I/O for file sink

## License

MIT License - See LICENSE file for details.
