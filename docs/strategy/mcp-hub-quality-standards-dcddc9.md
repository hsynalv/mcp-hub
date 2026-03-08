# MCP-Hub Architecture Quality Plan

This plan addresses 10 critical architectural areas identified in the codebase review, establishing standards and implementation priorities to ensure mcp-hub scales reliably as a production-ready AI agent platform.

---

## 1. Plugin Quality Standards

**Current State:** 40+ plugins exist with varying metadata completeness. Some have rich exports (github, notion, llm-router with capabilities, requires, endpoints), while others are minimal. No formal maturity classification exists.

**Risk:** Without quality tiers, users cannot distinguish production-ready plugins from experimental ones. Inconsistent retry/auth/error handling creates unpredictable behavior.

**Implementation:**
- Create `plugin.meta.json` schema with required fields:
  - `status`: stable | beta | experimental
  - `owner`: GitHub username/team
  - `version`: semver
  - `requiresAuth`: boolean
  - `supportsJobs`: boolean
  - `supportsStreaming`: boolean
  - `testLevel`: unit | integration | e2e | none
  - `resilience`: { retry: boolean, timeout: number, circuitBreaker: boolean }
  - `errorMapping`: { strategy: "standardized" | "raw" }

- Enforce via `plugins.js` loader: warn if meta missing, block if malformed
- Create `PLUGINS_TIER.md` registry documenting each plugin's maturity

---

## 2. Plugin Documentation Standards

**Current State:** README files exist for all plugins but with inconsistent depth. Some have endpoint tables, others lack usage examples or failure case documentation.

**Risk:** Poor documentation leads to incorrect tool selection by LLMs, unexpected behavior, and debugging friction.

**Implementation:**
- Standardize README structure across all 40 plugins:
  ```
  # Plugin Name
  ## Purpose (1-2 sentences)
  ## Endpoints (table: method, path, scope, description)
  ## MCP Tools (table: name, description, required params)
  ## Configuration (env vars)
  ## Example Usage (curl + MCP tool call)
  ## Error Handling (common failures)
  ## Policy Implications (approval required?)
  ```
- Add README validation to CI: check required sections exist
- Generate `PLUGIN_CATALOG.md` auto-index from plugin metadata

---

## 3. Test Coverage Framework

**Current State:** Vitest configured with coverage reporting. Tests exist in `tests/` with some plugin-specific tests, but no coverage thresholds or tiered testing strategy.

**Risk:** Core modules (plugin loader, auth, job lifecycle) may have insufficient coverage. Plugin additions can break without detection.

**Implementation:**
- Establish 4 test tiers:
  1. **Unit:** Individual functions/modules (target: 85%+ core, 75%+ plugins)
  2. **Contract:** Plugin input/output schema validation (required for all plugins)
  3. **Integration:** Plugin + policy + registry interaction
  4. **E2E:** Full MCP/HTTP request lifecycle

- Add coverage thresholds to `vitest.config.js`:
  ```js
  coverage: {
    thresholds: {
      'src/core/**/*.js': { branches: 85, functions: 85, lines: 85 },
      'src/plugins/*/index.js': { branches: 60, functions: 70, lines: 75 }
    }
  }
  ```
- Create `tests/contract/` with schema validation tests for each plugin
- Add smoke tests for critical paths: plugin load, auth, job queue

---

## 4. Workspace System Formalization

**Current State:** `x-project-id` and `x-env` headers are read by middleware and attached to `req` object. `workspace` and `projects` plugins exist but workspace isolation is not deeply integrated.

**Risk:** Without clear workspace ownership, jobs/audits/secrets from different projects may intermingle. Percepta and J4RV1S contexts could collide.

**Implementation:**
- Define workspace entity model:
  ```
  workspace (top-level container)
    └── projects[]
        └── conversations[]
            └── artifacts[]
            └── jobs[]
        └── secrets (workspace-scoped)
        └── rag-index (workspace-scoped)
        └── audit-logs (workspace-scoped)
  ```
- Extend middleware to validate workspace exists (lazy-create on first request)
- Update `jobs.js` to store `workspaceId` with each job
- Update `audit.js` to include workspace context in all logs
- Update `secrets.js` to support workspace-scoped secrets
- Add workspace admin endpoints: `/workspaces/:id/clone`, `/workspaces/:id/export`

---

## 5. RAG Platform Memory Integration

**Current State:** RAG plugin provides basic document indexing and semantic search with in-memory storage. Chunking is simple, no source connectors or freshness tracking.

**Risk:** Without proper ingestion pipeline and source tracking, RAG returns stale or wrong context, wasting tokens and producing poor AI responses.

**Implementation:**
- Design RAG as platform memory layer:
  - **Source Connectors:** GitHub repos, Notion databases, local files, HTTP endpoints
  - **Ingestion Pipeline:** Crawl → Extract → Chunk → Embed → Store
  - **Metadata Schema:** source, sourceType, freshness, workspaceId, tags
  - **Retrieval Policy:** top-k, reranking, citation required, max age
  - **Workspace Isolation:** Each workspace has isolated index
  - **Freshness Tracking:** `lastIndexed`, `checkFrequency`, auto-reindex triggers

- Implement connector interface:
  ```js
  interface SourceConnector {
    async crawl(config): Document[]
    async checkFreshness(doc): boolean
    async extract(doc): string
  }
  ```
- Add reindex scheduler based on source type (GitHub: on push, Notion: hourly, File: on change)
- Include citation in RAG results: `{ content, source, relevanceScore, retrievedAt }`

---

## 6. LLM Router Production Hardening

**Current State:** llm-router has good routing rules with fallback support, cost estimation, and resilience wrapper. Provider configs include strengths and cost tiers.

**Risk:** No explicit latency budgets, cost caps, or streaming support matrix. Fallback is binary (primary/fallback) rather than a chain.

**Implementation:**
- Extend ROUTING_RULES with production constraints:
  ```js
  {
    task: "code_review",
    primary: { provider: "anthropic", model: "claude-3-sonnet" },
    fallbackChain: [
      { provider: "openai", model: "gpt-4o" },
      { provider: "openai", model: "gpt-4o-mini" }
    ],
    constraints: {
      maxLatencyMs: 10000,
      maxCostUsd: 0.05,
      streaming: false,
      structuredOutput: true
    },
    retry: { maxAttempts: 2, backoffMs: 1000 }
  }
  ```
- Add cost tracking middleware: log actual vs estimated per request
- Implement latency-based preemption: abort slow requests, try fallback
- Add streaming support matrix: which providers/models support streaming
- Create provider health dashboard: availability, avg latency, error rate per provider

---

## 7. Observability Standardization

**Current State:** `observability` plugin exists with basic metrics. `metrics.js` core module provides tracking. Dashboard available at `/observability/dashboard`.

**Risk:** Without standardized metrics and correlation IDs, debugging distributed failures (plugin → job → LLM → external API) is difficult.

**Implementation:**
- Standardize metric categories:
  - **Request:** count, latency p50/p95/p99, error rate
  - **Plugin:** success rate, calls per plugin, avg duration
  - **Job:** queue size, processing time, failure rate by type
  - **Policy:** deny count, approval wait time
  - **LLM:** provider usage, token consumption, cost per request
  - **Cache:** hit ratio, eviction rate

- Enforce correlation ID propagation:
  - Generate `x-correlation-id` at entry (or accept from client)
  - Attach to all logs, job submissions, external API calls
  - Return in response headers for client tracking

- Extend dashboard with:
  - Real-time plugin health grid
  - Job queue depth visualization
  - LLM provider availability status
  - Recent errors with correlation ID search

---

## 8. Database Abstraction Layer

**Current State:** `database` plugin supports PostgreSQL, MSSQL, MongoDB with direct queries. No unified repository pattern or policy-safe query service.

**Risk:** Raw SQL variations, inconsistent transaction handling, no standardized timeout/redaction. One plugin's query can affect others.

**Implementation:**
- Create 3-tier DB architecture:
  1. **Connector:** Connection pooling, driver management
  2. **Repository:** CRUD operations per entity with query building
  3. **Policy Service:** Readonly/write enforcement, statement timeout, max rows, redaction

- Enforce DB plugin standards:
  ```js
  {
    mode: "readonly" | "write",  // Reject if mismatch
    timeoutMs: 30000,           // Kill long queries
    maxRows: 1000,              // Prevent unbounded results
    redact: ["password", "ssn"] // Column patterns to mask
  }
  ```

- Add connection-level audit: log all queries with workspace context
- Implement query result caching for readonly queries (respects TTL)

---

## 9. OpenAPI/Registry Synchronization

**Current State:** `openapi` plugin exists. Tool registry and OpenAPI spec are maintained separately.

**Risk:** Registry and OpenAPI drift leads to broken client generation, incorrect documentation, confused LLM tool selection.

**Implementation:**
- Establish single source of truth:
  - **Option A:** Derive OpenAPI from tool registry (preferred)
  - **Option B:** Derive tool registry from OpenAPI spec
  
- If Option A: Add `generateOpenApiSpec()` to tool-registry
  - Traverse registered tools, generate paths from endpoints
  - Include schemas from inputSchema/outputSchema
  - Serve at `/openapi.json` dynamically

- If Option B: Parse OpenAPI on startup, auto-register tools
- Add CI check: fail build if registry and OpenAPI are out of sync

---

## 10. Security Model Hardening

**Current State:** `policy` plugin with policy engine exists. `policy-guard` middleware enforces rules. `policy.json` has rule definitions. Auth uses API keys with read/write/admin scopes.

**Risk:** Tool misuse (wrong tool, excessive permissions), dangerous tool chains (shell → file → http), insufficient audit trails.

**Implementation:**
- Formalize 4-layer security:
  1. **Authentication:** API key validation
  2. **Authorization:** Scope-based (read/write/admin)
  3. **Policy Rules:** Per-tool rules (rate limit, require approval)
  4. **Audit/Approval:** Human-in-the-loop for sensitive operations

- Add per-plugin security questionnaire:
  ```
  - Who can invoke: [scope requirements]
  - Dangerous combinations: [tool chains to block]
  - Blocked parameters: [patterns that trigger rejection]
  - Requires approval: [yes/no, with conditions]
  ```

- Implement tool chain analysis: detect and block shell + file + http sequence
- Add parameter sanitization layer: block SQL injection patterns, path traversal
- Extend policy rules with: `maxCallsPerMinute`, `maxCallsPerHour`, `blockedArgumentPatterns`

---

## Implementation Priority

**Phase 1 (Critical):**
- Plugin quality standards (#1)
- Test coverage framework (#3)
- Security model hardening (#10)

**Phase 2 (High):**
- Workspace system formalization (#4)
- Observability standardization (#7)

**Phase 3 (Medium):**
- RAG platform integration (#5)
- LLM router hardening (#6)
- Database abstraction (#8)

**Phase 4 (Low):**
- OpenAPI synchronization (#9)
- Documentation standardization (#2) - ongoing

---

## Success Metrics

- All stable plugins have `plugin.meta.json` ✓
- Core coverage >= 85%, stable plugins >= 75%
- All jobs/audits have workspace context
- Correlation ID on 100% of requests
- Policy approval required for all write ops on sensitive plugins
