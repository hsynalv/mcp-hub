# HTTP Plugin

Controlled outbound HTTP client with security hardening: SSRF protection, redirect safety, strict method governance, rate limiting, and audit logging.

## Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/http/request` | POST | `write` | Make a controlled HTTP request |
| `/http/cache` | GET | `read` | Cache statistics |
| `/http/cache` | DELETE | `danger` | Clear cache |
| `/http/policy` | GET | `read` | Current policy configuration |
| `/http/audit` | GET | `read` | Request audit log |
| `/http/health` | GET | `read` | Plugin health check |

## Security Features

### 1. SSRF Protection

Requests to private/internal addresses are automatically blocked:
- `localhost`, `127.0.0.1`, `::1`
- Private IP ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- Link-local: `169.254.x.x`
- Non-HTTP protocols: `ftp://`, `file://`, etc.

### 2. Redirect Safety

Redirects are handled manually with security checks:
- **Max redirects**: Default 5 (configurable via `HTTP_MAX_REDIRECTS`)
- **Redirect loop detection**: Automatically detects and blocks loops
- **Re-validation**: Each redirect target is validated against:
  - Domain allowlist
  - SSRF protection (private IPs blocked)
- **Relative URL resolution**: Properly handles relative redirect targets

**Blocked redirect scenarios:**
```javascript
// Redirect to localhost - BLOCKED
301 Location: http://localhost:8080/admin

// Redirect to private IP - BLOCKED
302 Location: http://192.168.1.1/config

// Redirect loop - BLOCKED
A -> B -> A (loop detected)

// Too many redirects - BLOCKED
After 5 redirects (default max)
```

### 3. HTTP Method Governance

**Default (Safe Methods Only):**
- ✅ `GET` - Always allowed
- ✅ `HEAD` - Always allowed
- ✅ `OPTIONS` - Always allowed
- ❌ `POST` - **Blocked by default**
- ❌ `PUT` - **Blocked by default**
- ❌ `PATCH` - **Blocked by default**
- ❌ `DELETE` - **Blocked by default**

**Enable Destructive Methods:**
```env
# Enable specific methods
HTTP_ENABLED_METHODS=GET,HEAD,OPTIONS,POST

# Or enable all methods (use with caution)
HTTP_ENABLED_METHODS=GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE
```

**Error response when method disabled:**
```json
{
  "ok": false,
  "error": {
    "code": "AUTHORIZATION_ERROR",
    "message": "Method POST is not enabled. Configure HTTP_ENABLED_METHODS to enable destructive methods.",
    "category": "AUTHORIZATION"
  }
}
```

### 4. Domain Allowlist/Blocklist

```env
# Only allow specific domains (wildcards supported)
HTTP_ALLOWED_DOMAINS=*.github.com,api.notion.com

# Block specific domains
HTTP_BLOCKED_DOMAINS=internal.company.com,*.internal.net
```

**Precedence:** Blocklist > Allowlist

### 5. Rate Limiting

Per-domain request limiting (default: 60 RPM):
```env
HTTP_RATE_LIMIT_RPM=60
```

### 6. Response Size Limit

Maximum response size (default: 512KB):
```env
HTTP_MAX_RESPONSE_SIZE_KB=512
```

### 7. Request Timeout

Request timeout in milliseconds (default: 10s):
```env
HTTP_TIMEOUT_MS=10000
```

### 8. Audit Logging

All HTTP requests are logged with:
- Timestamp, method, URL
- Allow/deny result and reason
- Status code, duration
- Correlation ID, actor

Access via: `GET /http/audit?limit=50`

## Configuration

```env
# Security
HTTP_ALLOWED_DOMAINS=api.github.com,api.notion.com
HTTP_BLOCKED_DOMAINS=internal.company.com
HTTP_MAX_REDIRECTS=5

# Method governance (safe-only default)
HTTP_ENABLED_METHODS=GET,HEAD,OPTIONS

# Rate limiting
HTTP_RATE_LIMIT_RPM=60

# Resource limits
HTTP_MAX_RESPONSE_SIZE_KB=512
HTTP_TIMEOUT_MS=10000

# Caching
HTTP_CACHE_TTL_SECONDS=300
```

## Usage Examples

### Safe GET Request (Always Allowed)
```bash
curl -X POST /http/request \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","url":"https://api.github.com/user"}'
```

### POST Request (Requires Enablement)
```bash
# First configure: HTTP_ENABLED_METHODS=GET,HEAD,OPTIONS,POST
# Then:
curl -X POST /http/request \
  -H "Content-Type: application/json" \
  -d '{
    "method":"POST",
    "url":"https://api.github.com/repos/owner/repo/issues",
    "headers":{"Authorization":"Bearer {{secret:GITHUB_TOKEN}}"},
    "body":{"title":"New Issue"}
  }'
```

### Blocked Request Examples
```bash
# SSRF - Blocked
POST /http/request
{"method":"GET","url":"http://localhost:8080/admin"}
# → 403 SSRF protection: private_host_blocked

# Domain not allowed - Blocked
POST /http/request
{"method":"GET","url":"https://unknown.com/api"}
# → 403 Domain not in allowlist

# Method disabled - Blocked
POST /http/request
{"method":"DELETE","url":"https://api.example.com/resource/1"}
# → 403 Method DELETE is not enabled
```

## Error Reference

| Error | Code | Description |
|-------|------|-------------|
| `private_host_blocked` | 403 | SSRF protection triggered |
| `domain_not_allowed` | 403 | Domain not in allowlist |
| `destructive_methods_disabled` | 403 | Method requires HTTP_ENABLED_METHODS |
| `method_not_enabled` | 403 | Specific method not in enabled list |
| `rate_limit_exceeded` | 429 | Too many requests to domain |
| `redirect_limit_exceeded` | 502 | Max redirects exceeded |
| `redirect_loop` | 502 | Circular redirect detected |
| `redirect_blocked` | 502 | Redirect to private/invalid target |
| `timeout` | 504 | Request timeout |

## Security Best Practices

1. **Keep allowlist minimal** - Only add necessary domains
2. **Block internal domains** - Add company/internal domains to blocklist
3. **Restrict destructive methods** - Only enable methods you need
4. **Monitor audit logs** - Check `/http/audit` for suspicious activity
5. **Use secrets** - Store tokens in secrets store, reference with `{{secret:NAME}}`
6. **Set reasonable timeouts** - Prevent long-running requests
7. **Limit response size** - Prevent memory exhaustion

## Production Checklist

- [ ] `HTTP_ALLOWED_DOMAINS` configured with explicit list
- [ ] Internal/private domains in `HTTP_BLOCKED_DOMAINS`
- [ ] `HTTP_ENABLED_METHODS` configured (don't rely on defaults)
- [ ] `HTTP_MAX_REDIRECTS` set to reasonable value (3-5)
- [ ] `HTTP_RATE_LIMIT_RPM` configured for your use case
- [ ] `HTTP_MAX_RESPONSE_SIZE_KB` limit set
- [ ] Audit logging enabled and monitored
