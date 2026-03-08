# MCP Hub Security Model

This document describes the security model and sandboxing system for MCP Hub.

## Overview

MCP Hub implements a multi-layer security model to protect against malicious or accidental damage from AI agents:

1. **Authentication Layer** - API key validation
2. **Authorization Layer** - Scope-based access control (read/write/admin)
3. **Policy Layer** - Rule-based approval workflows
4. **Sandbox Layer** - Plugin-specific restrictions
5. **Audit Layer** - Complete operation logging

## High-Risk Plugins

The following plugins are classified as high-risk and require additional sandboxing:

| Plugin | Risk Level | Controls |
|--------|-----------|----------|
| `shell` | 🔴 Critical | Command allowlist, blocked patterns |
| `file-storage` | 🟡 High | Path restrictions, workspace isolation |
| `http` | 🟡 High | Domain allowlist, blocked domains |
| `database` | 🟡 High | Readonly mode, query validation |
| `local-sidecar` | 🟡 High | Whitelist required |

## Sandbox Controls

### 1. Shell Command Allowlist

The `shell` plugin uses regex patterns to validate commands:

**Allowed Commands:**
- File operations: `ls`, `cat`, `head`, `tail`, `find`, `grep`, `wc`
- Git operations: `git status`, `git log`, `git clone`, `git pull`
- Process inspection: `ps`, `top`
- Network: `ping`, `curl --head`, `nslookup`, `dig`
- Build tools: `npm`, `yarn`, `pnpm` commands
- Docker: `docker ps`, `docker logs` (read-only)

**Blocked Commands (Auto-rejected):**
```javascript
/rm\s+-rf\s+\//i              // Delete root
/>\s*\/etc\/passwd/i         // Overwrite system files
/mkfs/i                      // Format filesystem
/dd\s+if/i                   // Direct disk write
/:\(\)\s*\{\s*:\|;:\};/i      // Fork bomb
/wget.*\|.*sh/i              // Remote pipe to shell
/curl.*\|.*sh/i              // Remote pipe to shell
```

### 2. HTTP Domain Restrictions

The `http` plugin enforces domain restrictions:

**Allowed Domains:**
- `api.github.com`
- `api.notion.com`
- `api.slack.com`
- `api.openai.com`
- `api.anthropic.com`
- `registry.npmjs.org`
- ... (see `src/core/sandbox.js`)

**Blocked Domains:**
- Localhost: `localhost`, `127.x.x.x`
- Private networks: `192.168.x.x`, `10.x.x.x`
- `0.0.0.0`

Unknown domains require approval before execution.

### 3. Filesystem Path Restrictions

The `file-storage` plugin enforces workspace isolation:

- Files are restricted to `/workspaces/{workspaceId}/`
- Path traversal (`..`) is blocked
- Write/delete operations require approval

### 4. Database Query Validation

The `database` plugin enforces query restrictions:

**Write Operations (Require Approval):**
- `INSERT`, `UPDATE`, `DELETE`
- `DROP`, `CREATE`, `ALTER`, `TRUNCATE`

**Read-Only Mode:**
Plugins can operate in readonly mode where all writes are blocked.

## Policy Check Integration

### Policy Evaluation Flow

```
Request → Auth → Policy Check → Sandbox Check → Execution
              ↓
         [Approval Queue]
              ↓
         User Approves → Execution
```

### Policy Rules

Rules can be configured to require approval for:

1. **Pattern-based**: Match method + path
   ```javascript
   {
     pattern: "POST /shell/execute",
     action: "require_approval",
     description: "Shell commands need approval"
   }
   ```

2. **Plugin-based**: All operations from a plugin
   ```javascript
   {
     plugin: "file-storage",
     action: "require_approval",
     scope: "write"  // Only write operations
   }
   ```

3. **Dangerous combinations**: Detect risky sequences
   ```javascript
   {
     tools: ["github_get_file", "shell_execute"],
     action: "require_approval",
     reason: "Shell after GitHub access"
   }
   ```

### Approval Queue

Pending approvals can be managed via:

- `GET /policy/approvals` - List all approvals
- `POST /policy/approvals/:id/approve` - Approve a request
- `POST /policy/approvals/:id/reject` - Reject a request

## Execution Timeout

All sandboxed operations have timeouts:

| Plugin | Timeout |
|--------|---------|
| shell | 30 seconds |
| database | 30 seconds |
| http | 10 seconds |

## Security Best Practices

### For Administrators

1. **Use strict mode**: `STRICT_PLUGIN_LOADING=true`
2. **Enable audit logging**: `AUDIT_LOG_FILE=true`
3. **Configure Redis**: For centralized rate limiting
4. **Set up Sentry**: For error tracking
5. **Review approval queue**: Regularly check pending approvals

### For Plugin Developers

1. **Implement cleanup**: Always provide `cleanup()` function
2. **Use timeouts**: Set reasonable operation timeouts
3. **Validate inputs**: Use Zod schemas
4. **Log operations**: Use `ctx.logger` for all actions
5. **Declare capabilities**: Set accurate `capabilities` array

## Configuration

### Environment Variables

```bash
# Enable strict plugin loading
STRICT_PLUGIN_LOADING=true

# Enable audit logging
AUDIT_LOG_FILE=true

# Configure Redis for rate limiting
REDIS_URL=redis://localhost:6379

# Set Sentry DSN for error tracking
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Policy Presets

Built-in policy presets can be loaded:

- `strict`: Maximum security, most operations require approval
- `standard`: Balanced security for production
- `permissive`: Development mode with minimal restrictions

Load a preset:
```bash
POST /policy/rules/load-preset
{ "preset": "strict" }
```

## Emergency Procedures

### Blocking a Plugin

If a plugin is compromised:

```bash
# Disable plugin via environment
ENABLE_SHELL_PLUGIN=false

# Or add deny-all rule
POST /policy/rules
{
  "pattern": "* /shell/*",
  "action": "deny",
  "description": "Emergency: shell disabled"
}
```

### Revoking Access

If an API key is compromised:

1. Generate new keys
2. Update `.env` file
3. Restart server
4. Invalidate old sessions in Redis

## See Also

- [Transport Auth Security](./transport-auth.md) - Authentication details
- [Error Standard](../mcp-server/src/core/error-standard.js) - Error handling
- [Sandbox Implementation](../mcp-server/src/core/sandbox.js) - Source code
