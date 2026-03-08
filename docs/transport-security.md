# MCP Hub Transport Security Model

This document defines transport-level security rules for MCP Hub.

## Transport Trust Levels

MCP Hub supports multiple transports with different trust boundaries:

| Transport | Trust Level | Authentication | Use Case |
|-----------|-------------|----------------|----------|
| **stdio** | 🔒 Trusted Local | None (implicit trust) | Cursor, Claude Desktop |
| **HTTP (internal)** | 🔒 Trusted Network | API Key / OAuth | Internal microservices |
| **HTTP (public)** | 🔐 Authenticated Remote | API Key + Scope | Public API access |

### stdio Transport

Used by local MCP clients like Cursor and Claude Desktop.

- **Trust Boundary**: Local machine only
- **Authentication**: Not required (process-level trust)
- **Scope**: Full access (read + write)
- **Reasoning**: User physically controls their own machine

### HTTP Transport

Used for REST API and remote integrations.

- **Trust Boundary**: Network-based
- **Authentication**: Required (API keys or OAuth)
- **Scope**: Determined by key type
- **Security**: HTTPS required in production

## Authentication Methods

### 1. API Key Authentication (Default)

Three levels of API keys with different scopes:

```bash
# Read-only access
HUB_READ_KEY=hub_read_xxx

# Read + Write access  
HUB_WRITE_KEY=hub_write_xxx

# Full admin access
HUB_ADMIN_KEY=hub_admin_xxx
```

**Usage:**
```http
Authorization: Bearer <API_KEY>
```

**Scope Hierarchy:**
```
read < write < admin
```

### 2. OAuth 2.1 Bearer Token (Optional)

For external identity providers:

```bash
# Configure OAuth introspection
OAUTH_INTROSPECTION_ENDPOINT=https://auth.example.com/introspect
OAUTH_INTROSPECTION_AUTH=client_id:client_secret
```

Supports RFC 7662 token introspection.

### 3. Header-Based Fallback

Alternative header for compatibility:

```http
x-hub-api-key: <API_KEY>
```

## HTTP Transport Security

### Authentication Flow

```
Request → CORS Check → Extract Token → Validate Token → Check Scope → Execute
               ↓
         Invalid → 401 Unauthorized
               ↓
         Insufficient Scope → 403 Forbidden
```

### Middleware Enforcement

All HTTP routes use `requireScope()` middleware:

```javascript
import { requireScope } from "./auth.js";

// Read-only endpoint
app.get("/github/repos", requireScope("read"), handler);

// Write endpoint
app.post("/notion/pages", requireScope("write"), handler);

// Admin-only endpoint
app.post("/policy/rules", requireScope("admin"), handler);
```

### Open Mode (Development)

If no API keys are configured, the server runs in **open mode**:

- All requests are allowed
- No authentication required
- **Warning**: Only for local development

```bash
# Check if auth is enabled
curl http://localhost:8787/whoami
```

## Policy Integration

Transport security works with the policy layer:

```
Authentication → Authorization → Policy Check → Sandbox Check → Execution
     401             403            429            403           200
```

### Rate Limiting by Transport

| Transport | Rate Limit | Burst |
|-----------|-----------|-------|
| stdio | None (local) | N/A |
| HTTP (internal) | 100/min | 10 |
| HTTP (public) | 60/min | 5 |

### Policy Headers

Responses include policy-related headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Security Headers

All HTTP responses include security headers:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000 (production only)
```

## CORS Policy

Cross-origin requests are controlled via CORS:

```javascript
// Allowed origins (configurable)
CORS_ORIGINS=https://app.example.com,https://admin.example.com

// Default: allow local development
Access-Control-Allow-Origin: *
```

## Trust Boundary Diagram

```
┌─────────────────────────────────────────┐
│           Trust Boundary: Local          │
│  ┌─────────────────────────────────┐    │
│  │  stdio (Cursor/Claude Desktop) │    │
│  │  • No auth required            │    │
│  │  • Full access                 │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          Trust Boundary: Network         │
│  ┌─────────────────────────────────┐    │
│  │  HTTP Internal (Microservices)  │    │
│  │  • API key required             │    │
│  │  • Internal network only       │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  HTTP Public (External APIs)    │    │
│  │  • API key + scope check        │    │
│  │  • HTTPS required               │    │
│  │  • Rate limited                 │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

## Error Responses

### Authentication Errors (401)

```json
{
  "ok": false,
  "error": {
    "code": "unauthorized",
    "message": "Authorization header required. Use: Authorization: Bearer <HUB_API_KEY>"
  },
  "meta": {
    "requestId": "req-1234567890"
  }
}
```

### Authorization Errors (403)

```json
{
  "ok": false,
  "error": {
    "code": "forbidden",
    "message": "This endpoint requires 'write' scope. Your key does not have sufficient permissions."
  },
  "meta": {
    "requestId": "req-1234567890"
  }
}
```

### Rate Limit Errors (429)

```json
{
  "ok": false,
  "error": {
    "code": "rate_limited",
    "message": "Too many requests"
  },
  "meta": {
    "requestId": "req-1234567890"
  }
}
```

## Configuration

### Environment Variables

```bash
# Required for production
HUB_READ_KEY=hub_read_xxx
HUB_WRITE_KEY=hub_write_xxx
HUB_ADMIN_KEY=hub_admin_xxx

# Optional OAuth
OAUTH_INTROSPECTION_ENDPOINT=
OAUTH_INTROSPECTION_AUTH=

# CORS (production)
CORS_ORIGINS=https://app.example.com

# HTTPS enforcement
NODE_ENV=production
```

### Security Checklist

Production deployment checklist:

- [ ] API keys configured (HUB_READ_KEY, HUB_WRITE_KEY, HUB_ADMIN_KEY)
- [ ] HTTPS enabled
- [ ] CORS origins restricted
- [ ] Rate limiting enabled (Redis)
- [ ] Audit logging enabled
- [ ] Sentry DSN configured

## Best Practices

### For Administrators

1. **Never expose stdio port** - It's for local use only
2. **Use separate keys per client** - Rotate keys individually
3. **Enable audit logging** - Track all operations
4. **Monitor approval queue** - Review pending approvals
5. **Use HTTPS everywhere** - No exceptions in production

### For Developers

1. **Always check scope** - Use correct `requireScope()` level
2. **Handle 401/403 errors** - Provide clear user messages
3. **Implement retries** - Respect `Retry-After` header
4. **Cache responsibly** - Don't bypass rate limits
5. **Log correlation IDs** - For debugging with admins

## See Also

- [Security Model](./security-model.md) - Plugin sandboxing
- [Transport Auth](./transport-auth.md) - Authentication details
- [Error Standard](../mcp-server/src/core/error-standard.js) - Error handling
