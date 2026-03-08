# MCP Hub Architecture Plan

**Status:** v1.0 | **Last Updated:** March 2026

## Executive Summary

MCP Hub is a plugin-based AI integration platform that provides a unified interface for AI agents (Cursor, Claude Desktop, and custom LLM applications) to interact with external services, tools, and data sources. It exposes capabilities through both REST API and Model Context Protocol (MCP) transports.

## Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent Ecosystem                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Cursor     │  │Claude Desktop│  │  Custom LLM  │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │                 │                 │
          └──────────┬──────┴──────┬──────────┘
                     │             │
          ┌──────────▼──┐   ┌──────▼───────┐
          │   stdio     │   │     HTTP     │
          │  Transport  │   │   Transport  │
          └──────┬──────┘   └───────┬──────┘
                 │                  │
                 └────────┬─────────┘
                          │
            ┌─────────────▼─────────────┐
            │     MCP Hub Core          │
            │  ┌─────────────────────┐  │
            │  │  Authentication     │  │
            │  │  Authorization      │  │
            │  │  Policy Engine      │  │
            │  │  Audit Logging      │  │
            │  │  Job Queue          │  │
            │  │  Metrics            │  │
            │  └─────────────────────┘  │
            └────────────┬──────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼─────┐   ┌────▼─────┐   ┌────▼─────┐
    │  Stable  │   │   Beta   │   │   Exp    │
    │  Plugins │   │  Plugins │   │  Plugins │
    │• github  │   │• database│   │• shell   │
    │• notion  │   │• storage │   │• email   │
    │• slack   │   │• rag     │   │• image   │
    │• llm     │   │• http    │   │• video   │
    └──────────┘   └──────────┘   └──────────┘
```

### Core Services

| Service | Purpose | Key Features |
|---------|---------|--------------|
| **Auth** | Authentication & authorization | API key-based, scope-based (read/write/admin) |
| **Policy** | Rule engine & guardrails | Approval workflows, rate limiting, sandboxing |
| **Audit** | Operation logging | Request logging, compliance tracking |
| **Jobs** | Async task queue | Redis/in-memory, state management |
| **Metrics** | Prometheus-compatible | Request counts, latencies, error rates |
| **Sandbox** | Security isolation | Command/path/domain allowlists |

## Plugin Ecosystem

### Plugin Architecture

Every plugin follows a standardized structure:

```
src/plugins/<name>/
├── index.js              # Main entry point
├── manifest.json         # Plugin metadata (optional)
├── README.md             # Documentation
└── tests/                # Test files (optional)
```

### Required Exports

```javascript
export const name = "my-plugin";           // Plugin ID
export const version = "1.0.0";            // SemVer
export const description = "...";          // Short description
export const capabilities = ["read"];       // ["read", "write", "admin"]
export const requires = [];               // Required env vars
export const endpoints = [...];             // REST endpoints
export const tools = [...];                // MCP tools

export function register(app, ctx) {
  // Express route registration
}
```

### Plugin Maturity Levels

| Level | Count | Examples | Criteria |
|-------|-------|----------|----------|
| **🟢 Stable** | 5 | github, notion, llm-router, slack, git | Comprehensive tests, docs, production usage |
| **🟡 Beta** | 10 | database, file-storage, rag, http, policy | Functional, may have edge cases |
| **🔴 Experimental** | 21 | shell, email, image-gen, video-gen | Early development, use with caution |

### Stable Plugins

| Plugin | Description | Key Capabilities |
|--------|-------------|------------------|
| `github` | Repository management | PRs, issues, code analysis |
| `notion` | Knowledge base | Pages, databases, content |
| `llm-router` | LLM orchestration | Provider routing, cost tracking |
| `slack` | Team messaging | Channels, bots, notifications |
| `git` | Version control | Local repo operations |

## Transport Model

### Supported Transports

| Transport | Use Case | Authentication | Trust Level |
|-----------|----------|----------------|-------------|
| **stdio** | Local MCP clients | None (implicit trust) | High |
| **HTTP** | REST API access | API key (read/write/admin) | Medium |

### stdio Transport

Used by local AI tools like Cursor and Claude Desktop.

**Characteristics:**
- No authentication required
- Full scope access
- Local machine only
- Process-level trust

### HTTP Transport

REST API for external integrations.

**Authentication:**
```http
Authorization: Bearer <HUB_API_KEY>
# or
x-hub-api-key: <HUB_API_KEY>
```

**Scope Levels:**
- `read`: GET operations, queries
- `write`: POST/PUT/DELETE, modifications
- `admin`: Policy rules, approvals

### Security Headers

All HTTP responses include:
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
X-Correlation-Id: <request-id>
```

## Configuration System

### Environment Variables

**Required:**
```bash
HUB_READ_KEY=hub_read_xxx
HUB_WRITE_KEY=hub_write_xxx
HUB_ADMIN_KEY=hub_admin_xxx
```

**Optional Integrations:**
```bash
# GitHub
GITHUB_TOKEN=ghp_xxx

# Notion
NOTION_API_KEY=secret_xxx

# Database
MSSQL_CONNECTION_STRING=...
PG_CONNECTION_STRING=...
MONGODB_URI=...

# LLM Providers
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=...
```

### Validation

Configuration is validated at startup using Zod schemas:
- **Fail-fast**: Exits on missing required config
- **Type checking**: Ensures correct data types
- **Sanitized logging**: Secrets are masked in logs

## Error Handling

### Standard Error Format

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "validation",
    "message": "Human readable message",
    "userSafeMessage": "Safe for end users",
    "retryable": false,
    "details": {}
  },
  "meta": {
    "correlationId": "req-xxx",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Error Categories

- `validation`: Invalid input
- `authentication`: Auth failures
- `authorization`: Permission denied
- `not_found`: Resource missing
- `external_error`: Third-party failures
- `internal_error`: System errors

## Observability

### Metrics (Prometheus)

| Metric | Type | Labels |
|--------|------|--------|
| `mcp_http_requests_total` | Counter | method, route, status |
| `mcp_http_request_duration_seconds` | Histogram | method, route |
| `mcp_tool_calls_total` | Counter | tool, status |
| `mcp_tool_duration_seconds` | Histogram | tool |
| `mcp_external_api_calls_total` | Counter | service, status |
| `mcp_circuit_breaker_state` | Gauge | circuit |

### Accessing Metrics

```
GET /observability/metrics       # Prometheus format
GET /observability/health        # Health check
GET /observability/errors        # Recent errors
GET /audit/logs                # Audit trail
```

### Correlation IDs

Every request includes a correlation ID for tracing:
- Auto-generated if not provided
- Passed via `x-correlation-id` header
- Included in all logs and responses

## Security Model

### Multi-Layer Security

1. **Authentication**: API key validation
2. **Authorization**: Scope-based access control
3. **Policy Engine**: Rule-based approval workflows
4. **Sandbox**: Plugin-specific restrictions
5. **Audit**: Complete operation logging

### High-Risk Plugin Sandboxing

| Plugin | Controls |
|--------|----------|
| `shell` | Command allowlist, blocked patterns, approval required |
| `file-storage` | Path restrictions, workspace isolation |
| `http` | Domain allowlist, blocked domains |
| `database` | Readonly mode, query validation |

### Policy Examples

```javascript
// Require approval for shell commands
{
  pattern: "POST /shell/execute",
  action: "require_approval",
  description: "Shell commands need approval"
}

// Block dangerous combinations
{
  tools: ["github_get_file", "shell_execute"],
  action: "require_approval",
  reason: "Shell after GitHub access"
}
```

## Roadmap

### Q1 2026 - Stabilization

- [x] CI/CD pipeline (GitHub Actions)
- [x] Plugin maturity matrix
- [x] Error standardization (partial)
- [x] Configuration validation
- [x] Security model documentation

### Q2 2026 - Production Readiness

- [ ] Complete error standardization (all plugins)
- [ ] Plugin SDK v1.0
- [ ] Comprehensive test coverage (stable plugins)
- [ ] Performance benchmarks
- [ ] Multi-region deployment guide

### Q3 2026 - Platform Expansion

- [ ] Plugin marketplace
- [ ] OAuth 2.1 support
- [ ] Webhook system
- [ ] Plugin hot-reload
- [ ] Admin dashboard

### Q4 2026 - Enterprise Features

- [ ] SSO integration
- [ ] Audit log forwarding
- [ ] Custom policy DSL
- [ ] Plugin isolation (containers)
- [ ] SLA monitoring

## Development Guidelines

### Creating a New Plugin

1. Use the CLI scaffold:
   ```bash
   npm run create-plugin my-plugin
   ```

2. Implement required exports
3. Add tests (unit + smoke)
4. Update plugin maturity matrix
5. Submit PR with documentation

### Best Practices

- **Errors**: Always use `error-standard.js`
- **Validation**: Use Zod for input schemas
- **Logging**: Use `ctx.logger`, never console
- **Timeouts**: Set reasonable operation limits
- **Cleanup**: Implement `cleanup()` for resources

## See Also

- [Plugin SDK](./docs/plugin-sdk.md)
- [Plugin Maturity Matrix](./docs/plugin-maturity-matrix.md)
- [Security Model](./docs/security-model.md)
- [Transport Security](./docs/transport-security.md)
- [Observability](./docs/observability.md)
- [Architecture (TR)](./mcp-server/ARCHITECTURE.md)

---

*This plan reflects the current MCP Hub architecture as of March 2026.*
