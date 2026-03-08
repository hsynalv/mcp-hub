# MCP-Hub Infrastructure & Operations Plan

Implements 10 operational and governance requirements to mature the project from functional to production-ready, covering CI/CD, documentation, versioning, security, and repository hygiene.

---

## 1. CI/CD Pipeline

**Current State:** .github folder exists but contains only ISSUE_TEMPLATE. No workflows. Husky and local tests exist but no automated GitHub checks.

**Risk:** Without CI, every merge is a potential breaking change. Manual testing won't scale with 40+ plugins.

**Implementation:**
- `.github/workflows/ci.yml`:
  - Node 18/20 matrix
  - Install → Lint → Type check → Test (with coverage thresholds)
  - Plugin contract validation
  - Security audit (`npm audit`)
  
- `.github/workflows/security.yml`:
  - Dependency vulnerability scanning
  - Secret scanning (truffleHunter or GitHub native)
  - SAST if available
  
- `.github/workflows/release.yml`:
  - Trigger on version tag push
  - Build artifacts
  - Create GitHub Release with changelog
  - Publish to npm (optional)

- Branch protection rules enforced via settings documentation

---

## 2. Plugin Maturity Matrix

**Current State:** Plugin metadata exists but no visible summary in root README.

**Risk:** Users cannot quickly assess which plugins are production-ready vs experimental.

**Implementation:**
- Add table to root README.md:
  ```
  | Plugin | Owner | Status | Auth | Tests | Docs | Production Ready |
  |--------|-------|--------|------|-------|------|------------------|
  | github | @hsynalv | stable | Yes | unit | ✅ | Yes |
  | notion | @hsynalv | stable | Yes | unit | ✅ | Yes |
  | shell | @hsynalv | beta | Yes | none | ⚠️ | No |
  ```
- Auto-generate from plugin.meta.json files
- Add badge system: 🟢 Stable / 🟡 Beta / 🔴 Experimental

---

## 3. Versioning / Release System

**Current State:** CHANGELOG.md exists but no release discipline visible. No tags in repo.

**Risk:** Cannot track breaking changes, users don't know what's safe to upgrade.

**Implementation:**
- Adopt SemVer strictly:
  - MAJOR: Breaking API/tool contract changes
  - MINOR: New plugin or tool additions
  - PATCH: Bug fixes, security patches
  
- Structured CHANGELOG.md categories:
  - Added
  - Changed
  - Deprecated
  - Removed
  - Fixed
  - Security
  
- GitHub Releases with:
  - Release notes from CHANGELOG
  - Binary artifacts (if applicable)
  - Docker images (optional)

- Version command: `npm version` with hooks

---

## 4. Plugin SDK Standard

**Current State:** Plugin structure varies. No formal SDK contract documentation.

**Risk:** Plugins diverge in quality and structure over time.

**Implementation:**
- Formal Plugin SDK specification:
  ```typescript
  interface PluginContract {
    name: string;
    version: string;
    register(app: Express, ctx: PluginContext): void | Promise<void>;
    manifest?: PluginManifest;
    schemas?: { input: JSONSchema; output: JSONSchema };
    healthcheck?: () => Promise<HealthStatus>;
    capabilities?: string[];
    cleanup?: () => Promise<void>;
  }
  ```
  
- Required lifecycle hooks:
  - `register()` - Route registration
  - `healthcheck()` - Health status (optional but recommended)
  - `cleanup()` - Graceful shutdown
  
- Error mapping standardization
- CLI scaffold generator: `npm run create-plugin <name>`
- SDK package: `@mcp-hub/plugin-sdk` (optional future)

---

## 5. Error Standardization

**Current State:** errors.js has basic AppError structure. Not all plugins use it consistently.

**Risk:** Clients cannot reliably parse errors or decide retry behavior.

**Implementation:**
- Standard error envelope (already partially implemented):
  ```json
  {
    "ok": false,
    "error": {
      "code": "string",
      "category": "validation|auth|runtime|external",
      "message": "string",
      "userSafeMessage": "string",
      "retryable": boolean,
      "details": {}
    },
    "meta": {
      "correlationId": "string"
    }
  }
  ```
  
- Error categories:
  - VALIDATION (400) - Bad input
  - AUTHENTICATION (401) - Not authenticated
  - AUTHORIZATION (403) - No permission
  - NOT_FOUND (404) - Resource missing
  - RATE_LIMITED (429) - Too many requests
  - EXTERNAL_ERROR (502) - Upstream failure
  - INTERNAL_ERROR (500) - Server bug
  
- Plugin error wrapper to enforce standard
- Ban raw error throwing in plugins

---

## 6. Config Management

**Current State:** config.js has flat structure. No validation or environment profiles.

**Risk:** Config drift between local/prod, missing env vars discovered late.

**Implementation:**
- Three-tier config:
  1. **Core config** - Server-level settings
  2. **Plugin config** - Per-plugin settings with prefix (PLUGIN_X_)
  3. **Secret references** - {{secret:NAME}} resolution
  
- Schema validation at startup using Zod or JSON Schema
- Fail-fast on missing required env vars
- Masked config logging (never log secrets)
- Environment profiles: `.env.local`, `.env.production`
- Config endpoint (admin only): GET /admin/config (masked)

---

## 7. Transport Auth Security

**Current State:** auth.js exists but transport-level security model not explicitly documented.

**Risk:** Trust boundary confusion between MCP stdio and HTTP modes.

**Implementation:**
- Document per-transport security:
  
  **Local Stdio (MCP Bridge):**
  - Trusted environment (local machine)
  - No token needed (implicit trust)
  - Scope: read/write based on HUB_*_KEY if provided
  
  **HTTP API:**
  - Bearer token required (HUB_READ_KEY / HUB_WRITE_KEY)
  - Token scope determines permissions
  - HTTPS required in production
  
  **Internal vs Public Mode:**
  - INTERNAL: No CORS, strict token check
  - PUBLIC: CORS enabled, optional token for read
  
- Plugin scope enforcement matrix
- Approval layer location documented

---

## 8. Rate Limiting / Quota

**Current State:** ratelimit.js exists but no comprehensive multi-layer policy.

**Risk:** Agent loops can exhaust APIs, rack up costs, fill job queues.

**Implementation:**
- Multi-layer rate limits:
  1. **Request level**: Per-minute per-IP/API key
  2. **Job level**: Per-hour queue depth per workspace
  3. **Provider level**: Token budget per LLM provider (daily)
  4. **Workspace level**: Daily quota (requests + cost)
  5. **Plugin level**: Sensitive plugins stricter (shell, database)
  
- Quota headers in responses:
  - X-RateLimit-Limit
  - X-RateLimit-Remaining
  - X-RateLimit-Reset
  
- Workspace quota dashboard endpoint
- Alert on 80% quota usage

---

## 9. Plugin Sandboxing

**Current State:** shell, http, database plugins have direct system access. No sandbox layer.

**Risk:** Malicious or buggy tool chains can damage system or exfiltrate data.

**Implementation:**
- Sandboxing layers:
  1. **Command allowlist** (shell plugin): Only pre-approved commands
  2. **Path allowlist** (file plugins): Workspace-bound only
  3. **Domain allowlist** (http plugin): Already partially implemented
  4. **Readonly mode**: Database plugin can enforce SELECT-only
  5. **Workspace isolation**: Files/secrets scoped to workspace
  
- Dangerous combination detection (already in security-guard.js)
- Approval required for:
  - Shell execution
  - Database write
  - File delete
  - HTTP to new domains
  
- Plugin capability flags: `CAP_DANGEROUS` requires approval

---

## 10. Artifact Cleanup / Repo Hygiene

**Current State:** Root has multiple markdown files. Docs/ is empty. No clear structure.

**Risk:** Root clutter confuses new contributors, hides important docs.

**Implementation:**
- Reorganize root:
  ```
  /
  ├── README.md (entry point only)
  ├── LICENSE
  ├── CHANGELOG.md
  ├── docs/
  │   ├── strategy/     (LAUNCH_STRATEGY, roadmap)
  │   ├── architecture/ (ARCHITECTURE, quality standards)
  │   ├── guides/       (CONTRIBUTING, plugin-dev)
  │   └── releases/     (version notes)
  ├── mcp-server/
  └── .github/
  ```
  
- Move non-essential root files to docs/
- Add REPO_HYGIENE.md with maintenance rules
- Stale file detector (monthly reminder)
- Clean build artifacts in .gitignore

---

## Implementation Priority

**Phase 1 (Critical):**
1. CI/CD pipeline (#1)
2. Plugin maturity matrix (#2)
5. Error standardization (#5)

**Phase 2 (High):**
3. Versioning system (#3)
6. Config management (#6)
7. Transport auth docs (#7)

**Phase 3 (Medium):**
4. Plugin SDK standard (#4)
8. Rate limiting (#8)
9. Plugin sandboxing (#9)

**Phase 4 (Low):**
10. Repo hygiene (#10)

---

## Success Metrics

- CI passes on every PR ✅
- All plugins have status badge ✅
- Zero raw errors from plugins ✅
- Config validation at startup ✅
- Sandboxed shell commands ✅
- Clean root directory (< 8 files) ✅
