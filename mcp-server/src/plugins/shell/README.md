# Shell Plugin

Production-hardened shell command execution with strict allowlist and security controls.

## Security Model

**Default: DENY-ALL with EXPLICIT ALLOWLIST**

- Only commands explicitly in `SHELL_ALLOWLIST` can execute
- Dangerous patterns (pipes, redirects, chaining, subshells) are blocked
- Policy layer integration for pre-execution approval
- Structured audit logging for all attempts

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SHELL_ALLOWLIST` | `ls,cat,echo,grep,find,head,tail,wc,stat,du,df,ps,top,uname,whoami,pwd,cd,mkdir,cp,mv,chmod,git,npm,node,python,python3,pip,which,whereis,date,uptime,free` | Comma-separated list of allowed commands |
| `SHELL_DEFAULT_TIMEOUT_MS` | `30000` | Default execution timeout (ms) |
| `SHELL_MAX_TIMEOUT_MS` | `300000` | Maximum allowed timeout (ms) |
| `ALLOWED_WORKING_DIRS` | `''` | **SECURITY: If empty, only current working directory is allowed** |
| `SHELL_AUDIT_TYPE` | `memory` | Audit sink type: `memory`, `file`, `redis`, or `multi` |
| `SHELL_AUDIT_FILE_PATH` | `./logs/shell-audit.jsonl` | File path when using `file` sink |
| `SHELL_AUDIT_MAX_ENTRIES` | `1000` | Max audit entries to keep (per sink) |

## Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/shell/execute` | POST | `write` | Execute a shell command |
| `/shell/execute/stream` | POST | `write` | Execute with streaming output (SSE) |
| `/shell/audit` | GET | `read` | Get execution audit log |
| `/shell/safety` | GET | `read` | Get safety configuration |

## MCP Tools

| Tool | Tags | Description |
|------|------|-------------|
| `shell_execute` | `write`, `destructive`, `local_fs` | Execute allowed command |
| `shell_audit` | `read` | Get audit log entries |
| `shell_safety_check` | `read` | Check if command would be allowed |

## Allowed Commands (Default Allowlist)

File operations: `ls`, `cat`, `echo`, `grep`, `find`, `head`, `tail`, `wc`, `stat`, `du`, `df`
System info: `ps`, `top`, `uname`, `whoami`, `pwd`, `date`, `uptime`, `free`
File manipulation: `cd`, `mkdir`, `cp`, `mv`, `chmod`
Development: `git`, `npm`, `node`, `python`, `python3`, `pip`, `which`, `whereis`

## Blocked Dangerous Patterns

| Pattern | Example | Blocked |
|---------|---------|---------|
| Shell chaining | `&&`, `\|\|`, `;` | Yes |
| Pipes | `\|` | Yes |
| Redirections | `>`, `>>`, `<` | Yes |
| Subshells | `$(...)`, `` `...` `` | Yes |
| sudo | `sudo ...` | Yes |
| rm -rf | `rm -rf /` | Yes |
| Disk operations | `dd`, `mkfs`, `fdisk` | Yes |

## Examples

### Execute Command
```bash
POST /shell/execute
{
  "command": "ls -la",
  "cwd": "./workspace",
  "timeout": 30000
}
```

Success Response:
```json
{
  "ok": true,
  "data": {
    "command": "ls -la",
    "exitCode": 0,
    "stdout": "...",
    "stderr": "",
    "duration": 150,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "correlationId": "a1b2c3d4e5f67890"
  }
}
```

### Denied Command Response
```json
{
  "ok": false,
  "error": {
    "code": "AUTHORIZATION_ERROR",
    "category": "authorization",
    "message": "Shell command denied: Command not in allowlist",
    "userSafeMessage": "Shell command denied: Command not in allowlist",
    "retryable": false
  }
}
```

### Safety Check
```bash
POST /shell/safety
{
  "command": "rm -rf /"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "command": "rm -rf /",
    "allowed": false,
    "allowedCommand": false,
    "reason": "Command not in allowlist",
    "cwdAllowed": true,
    "allowlist": ["ls", "cat", ...],
    "dangerousPatterns": ["\\brm\\b.+\\s-rf?\\b", "..."],
    "allowedDirs": [],
    "defaultTimeout": 30000,
    "maxTimeout": 300000
  }
}
```

### Audit Log
```bash
GET /shell/audit?limit=10
```

Response:
```json
{
  "ok": true,
  "data": {
    "audit": [
      {
        "timestamp": "2024-01-01T00:00:00.000Z",
        "command": "ls -la",
        "cwd": "/workspace",
        "allowed": true,
        "duration": 150,
        "exitCode": 0,
        "correlationId": "a1b2c3d4e5f67890",
        "actor": "unknown"
      },
      {
        "timestamp": "2024-01-01T00:00:01.000Z",
        "command": "rm -rf /",
        "allowed": false,
        "reason": "Command not in allowlist",
        "correlationId": "b2c3d4e5f6g78901",
        "actor": "unknown"
      }
    ]
  }
}
```

## Timeout Behavior

- Commands exceeding timeout are terminated with SIGTERM
- Process is killed to prevent resource exhaustion
- Standardized `TIMEOUT` error returned
- Duration capped at `SHELL_MAX_TIMEOUT_MS`

## Policy Integration

If policy layer is active, shell commands are evaluated **before execution**:
- Policy `block`: Denied with `AUTHORIZATION_ERROR` - command **never executes**
- Policy `require_approval`: Goes to approval queue
- Policy `allow`: Proceeds with execution

## Audit Log Persistence

The shell plugin supports pluggable audit sinks:

### Memory Sink (Default)
```bash
SHELL_AUDIT_TYPE=memory
SHELL_AUDIT_MAX_ENTRIES=1000
```
- Fast, in-process storage
- Lost on restart
- Good for development

### File Sink
```bash
SHELL_AUDIT_TYPE=file
SHELL_AUDIT_FILE_PATH=./logs/shell-audit.jsonl
```
- Persistent JSONL append-only logs
- Automatic rotation at 50MB
- Good for single-instance production

### Multi Sink
```javascript
// Use both memory and file
SHELL_AUDIT_TYPE=multi
// Configured via code - see audit-sink.js
```

## Security Best Practices

1. **Allowlist maintenance**: Review and update `SHELL_ALLOWLIST` for your environment
2. **Working directories**: **Default behavior**: If `ALLOWED_WORKING_DIRS` is not set, only the current working directory is allowed. Configure `ALLOWED_WORKING_DIRS` for explicit directory access
3. **Audit log storage**: Use `SHELL_AUDIT_TYPE=file` for persistent audit trails in production
4. **Policy rules**: Define appropriate policy rules for your security requirements
5. **Timeout tuning**: Adjust `SHELL_DEFAULT_TIMEOUT_MS` based on typical command durations

