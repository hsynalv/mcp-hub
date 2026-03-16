# MCP-Hub Architecture Growth Plan: Knowledge + Execution Platform

**Document Version:** 1.0  
**Date:** 2025-03-17  
**Scope:** Evolve MCP-Hub from a tool execution hub into a knowledge + execution platform without breaking existing architecture.

---

## 1. Current Architecture Summary

### 1.1 Repository Structure

```
mcp-hub/
├── mcp-server/           # Main server (Express, MCP, plugins)
│   ├── src/
│   │   ├── core/         # Auth, audit, config, jobs, policy, tools, plugins, workspace
│   │   ├── plugins/      # 30+ plugins (rag, notion, github, shell, policy, brain, etc.)
│   │   └── mcp/          # HTTP transport, gateway
│   ├── tests/
│   └── package.json
├── docs/                 # Architecture, roadmap, strategy
├── mcps/                 # MCP tool descriptors (GitLens, Notion, cursor-ide-browser)
├── public/               # Landing, UI, static assets
└── bin/                  # mcp-hub-stdio.js (STDIO transport)
```

### 1.2 Plugin Architecture

| Component | Location | Behavior |
|-----------|----------|----------|
| **Discovery** | `src/core/plugins.js` | Scans `src/plugins/*/`, validates `plugin.meta.json`, dynamic `import()` |
| **Contract** | `src/core/registry/plugin.contract.js` | Required: `metadata`, `register(router, context)`. Optional: `tools`, `health`, `endpoints`, `mcp`, `audit`, `config`, `cleanup` |
| **Loading** | `src/core/plugins.js` | `loadPlugins(app)` → validate meta → `plugin.register(app)` → `registerTool()` for each tool |
| **Registry** | `src/core/registry/` | Alternative registry-based loader; startup still uses legacy `plugins.js` |

**Plugin lifecycle:** Discovery → Load → Enable (register) → [Disable → cleanup]

### 1.3 Tool Registration Flow

1. Plugin exports `tools` array: `{ name, description, inputSchema, handler, tags }`
2. `loadPlugins()` calls `registerTool({ ...tool, plugin })` for each tool
3. **Tool registry:** `src/core/tool-registry.js` — in-memory `Map<toolName, Tool>`
4. **MCP exposure:** `src/mcp/gateway.js` — `listTools()` and `callTool()` via JSON-RPC
5. **REST:** Each plugin mounts routes under its prefix (e.g. `/rag`, `/notion`)

**Tool invocation:** `callTool(name, args, context)` → `executeBeforeHooks` (policy) → `tool.handler(args, context)` → `executeAfterHooks`

### 1.4 Policy Enforcement Flow

| Layer | Location | Role |
|-------|----------|------|
| Policy plugin | `src/plugins/policy/` | Rules, approvals, MCP tool hooks |
| Policy engine | `src/plugins/policy/policy.engine.js` | `evaluate(method, path, body, user)` |
| Policy guard | `src/core/policy-guard.js` | Middleware for POST/PUT/PATCH/DELETE |
| Policy hooks | `src/core/policy-hooks.js` | Before/after tool execution |
| Presets | `src/plugins/policy/presets.json` | Loaded at startup via `loadPresetsAtStartup()` |

**Actions:** `allow` | `block` | `require_approval` | `dry_run_first` | `rate_limit`

### 1.5 Job Queue Flow

| Component | Location | Behavior |
|-----------|----------|----------|
| Job system | `src/core/jobs.js` | `submitJob(type, payload, context)` → `registerJobRunner(type, handler)` |
| Storage | Redis (`jobs.redis.js`) if `REDIS_URL`, else in-memory `Map` |
| Execution | `setImmediate(() => runJob(id))` — async, non-blocking |
| States | `queued` → `running` → `completed` \| `failed` \| `cancelled` |
| Context | `{ projectId, env, user }` — **note:** `workspaceId` not in job context today |

**API:** `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `GET /jobs/stats`

### 1.6 Config / Env Loading Flow

1. `import "dotenv/config"` in `config.js` (loads `.env`)
2. `config.js` builds `rawConfig` from `process.env.*`
3. `config-schema.js` — Zod validation via `validateConfig(rawConfig)` — fail-fast, exits on error
4. **No config files** — all from env vars
5. **RAG config:** Not in schema; read ad-hoc in `src/plugins/rag/index.js` (e.g. `RAG_MAX_CHUNK_SIZE`, `OPENAI_API_KEY`)

### 1.7 RAG Plugin — Current State

**Location:** `src/plugins/rag/`

| File | Purpose |
|------|---------|
| `index.js` | Plugin entry, routes, tools, chunking, embedding, MemoryStore |
| `stores/store.interface.js` | `RagStore` interface, `RagDocument`, `SearchResult`, `createStore()` factory |
| `stores/memory.store.js` | In-memory store — per-workspace `Map`, cosine similarity |
| `rag-connectors.js` | `SourceConnector`, `IngestionPipeline`, `ConnectorRegistry` |
| `connectors/file.connector.js` | File system connector |
| `connectors/notion.connector.js` | Notion connector |
| `connectors/github.connector.js` | GitHub connector |

**Current behavior:**
- **Chunking:** `chunkText()` — sliding window, `RAG_MAX_CHUNK_SIZE` (1500), `RAG_CHUNK_OVERLAP` (150), `RAG_MAX_CHUNKS_PER_DOC` (100)
- **Embedding:** OpenAI `text-embedding-3-small` if `OPENAI_API_KEY`, else TF keyword fallback
- **Storage:** `MemoryStore` only — in-memory, per-workspace, **not persistent**
- **Indexing:** `indexDocument()` — chunk → embed each chunk → `store.upsertDocument()`
- **Search:** `createEmbedding(query)` → `store.searchDocuments()` → cosine similarity, per-chunk scoring

**Connectors gap:** `IngestionPipeline` and `SourceConnector` implementations exist but are **not wired** to the RAG plugin. `IngestionPipeline.storeChunk()` throws "must be implemented with storage backend". No REST/MCP endpoints for connector-based ingestion.

**Workspace isolation:** `x-workspace-id` header; RAG uses `context.workspaceId || "global"`. MCP gateway does **not** pass `workspaceId` to tool context (only `method`, `user`, `requestId`).

---

## 2. Integration Points for Knowledge Platform

### 2.1 Document Ingestion

| Current | Integration Point |
|---------|-------------------|
| `POST /rag/index`, `POST /rag/index-batch` | Direct content indexing |
| `IngestionPipeline` in `rag-connectors.js` | **Unused** — `storeChunk()` unimplemented |
| `FileConnector`, `NotionConnector`, `GitHubConnector` | Exist but not exposed |

**Recommendation:** Wire `IngestionPipeline` to RAG store; add `POST /rag/ingest/:connector` and `rag_ingest` MCP tool. Use job queue for async ingestion of large sources.

### 2.2 Chunking

| Current | Location | Integration |
|---------|----------|-------------|
| RAG `chunkText()` | `src/plugins/rag/index.js` | Sliding window, fixed size |
| `IngestionPipeline.chunkContent()` | `rag-connectors.js` | Sentence-based, different logic |

**Recommendation:** Extract chunking into a shared module (`src/plugins/rag/chunking/`) with pluggable strategies (fixed, sentence, semantic). Align `IngestionPipeline` with RAG chunking.

### 2.3 Embedding

| Current | Location | Integration |
|---------|----------|-------------|
| `createEmbedding()` | `src/plugins/rag/index.js` | OpenAI or keyword fallback |
| In-memory cache | 5 min TTL | Per text[:200] |

**Recommendation:** Extract embedding into `src/plugins/rag/embedding/` with provider abstraction (OpenAI, local, optional Cohere/Ollama). Support multiple models via config.

### 2.4 Vector Indexing

| Current | Location | Integration |
|---------|----------|-------------|
| `MemoryStore` | `stores/memory.store.js` | In-memory, cosine similarity |
| `store.interface.js` | `createStore()` | PgVector, Qdrant, SQLite commented as future |

**Recommendation:** Implement `PgVectorStore` when `PG_CONNECTION_STRING` is set; add `RAG_STORE_TYPE=memory|pgvector` env. Keep MemoryStore as default for dev.

### 2.5 Retrieval Evaluation

| Current | Gap |
|---------|-----|
| **None** | No dedicated retrieval evaluation module |
| `minScore` | Hardcoded in search (default 0.1) |

**Recommendation:** Add `GET /rag/evaluate` and `rag_evaluate` tool for recall/precision on a labeled set. Store in separate module to avoid bloating core RAG.

### 2.6 Workspace Isolation

| Current | Location |
|---------|----------|
| `x-workspace-id` header | REST routes |
| `workspaceContextMiddleware` | `src/core/workspace.js` |
| RAG | `store._getWorkspaceStore(workspaceId)` |
| MCP | **Context lacks workspaceId** — gateway does not pass headers |

**Recommendation:** Pass `x-workspace-id`, `x-project-id` from HTTP transport to MCP tool context. Add optional `workspaceId` to tool inputSchema for MCP clients that cannot send headers.

---

## 3. Risks and Constraints

### 3.1 Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking RAG API** | High | Keep all existing endpoints unchanged; add new ones under `/rag/ingest`, etc. |
| **MemoryStore data loss** | Medium | Document clearly; persist option via PgVector |
| **Connector import path** | Low | `github.connector.js` imports `./rag-connectors.js` (should be `../rag-connectors.js`) — likely bug |
| **Job queue saturation** | Medium | Rate-limit ingestion jobs per workspace; use existing `checkJobLimit` |
| **Embedding cost** | Medium | Respect existing limits; add batch embedding with rate limiting |
| **Config drift** | Low | RAG env vars not in schema — add to `config-schema.js` |

### 3.2 Constraints

- **Node >= 18** — no new runtime requirements
- **Existing plugins** — brain, workspace, notion, etc. depend on RAG; no breaking changes
- **MCP protocol** — tool list/call contract unchanged
- **Policy enforcement** — new ingestion tools must respect `NEEDS_APPROVAL`, `BULK` tags

---

## 4. Recommended Roadmap (Phases)

### Phase 1: Foundation (Stabilize & Wire Connectors)

**Goal:** Wire existing connectors to RAG without new storage backends.

| Task | Files to Add/Modify |
|------|---------------------|
| Fix `IngestionPipeline.storeChunk()` | `src/plugins/rag/rag-connectors.js` — inject `indexDocument` or store |
| Add `POST /rag/ingest/:connector` | `src/plugins/rag/index.js` | 
| Add `rag_ingest` MCP tool | `src/plugins/rag/index.js` |
| Register job runner `rag.ingest` | `src/plugins/rag/index.js` + `src/core/jobs.js` |
| Fix GitHub connector import | `src/plugins/rag/connectors/github.connector.js` — `../rag-connectors.js` |
| Add RAG config to schema | `src/core/config-schema.js`, `src/core/config.js` |

**Deliverables:** Connector-based ingestion (file, notion, github) via REST and MCP; async via jobs for large sources.

### Phase 2: Extraction & Pluggability

**Goal:** Extract chunking and embedding into reusable modules; support multiple strategies.

| Task | Files to Add/Modify |
|------|---------------------|
| Create chunking module | `src/plugins/rag/chunking/index.js`, `chunking/strategies/fixed.js`, `chunking/strategies/sentence.js` |
| Create embedding module | `src/plugins/rag/embedding/index.js`, `embedding/openai.js`, `embedding/keyword.js` |
| Refactor RAG index | `src/plugins/rag/index.js` — use new modules |
| Align IngestionPipeline | `rag-connectors.js` — use shared chunking |
| Add `RAG_CHUNK_STRATEGY`, `RAG_EMBEDDING_PROVIDER` | `config-schema.js` |

**Deliverables:** Pluggable chunking and embedding; configurable strategies.

### Phase 3: Persistent Vector Store

**Goal:** Add PgVector (or similar) for production persistence.

| Task | Files to Add/Modify |
|------|---------------------|
| Implement `PgVectorStore` | `src/plugins/rag/stores/pgvector.store.js` |
| Extend `createStore()` | `store.interface.js` — `type: "pgvector"` |
| Add `RAG_STORE_TYPE`, `RAG_PGVECTOR_SCHEMA` | `config-schema.js` |
| Migration path | Document: MemoryStore → PgVector migration (manual re-index) |

**Deliverables:** Production-ready vector store; optional migration.

### Phase 4: Workspace & Context

**Goal:** Ensure workspace isolation across REST and MCP.

| Task | Files to Add/Modify |
|------|---------------------|
| Pass workspace headers to MCP context | `src/mcp/http-transport.js` — pass `req.headers["x-workspace-id"]` to `handleRequest` |
| Gateway context | `src/mcp/gateway.js` — `context.workspaceId`, `context.projectId` from request context |
| Add `workspaceId` to job context | `src/core/jobs.js` — include in `context` |
| Optional `workspaceId` in RAG tools | `inputSchema` — for MCP clients without headers |

**Deliverables:** Consistent workspace isolation for REST and MCP.

### Phase 5: Retrieval Evaluation (Optional)

**Goal:** Enable retrieval quality measurement.

| Task | Files to Add/Modify |
|------|---------------------|
| Create evaluation module | `src/plugins/rag/evaluation/` — `evaluate.js`, schema for labeled pairs |
| Add `POST /rag/evaluate`, `rag_evaluate` | `index.js` |
| Document format | `docs/rag-evaluation-format.md` |

**Deliverables:** Recall/precision evaluation; optional for most users.

---

## 5. Exact Folders/Files to Add or Modify

### Phase 1

| Action | Path |
|--------|------|
| Modify | `mcp-server/src/plugins/rag/rag-connectors.js` |
| Modify | `mcp-server/src/plugins/rag/index.js` |
| Modify | `mcp-server/src/plugins/rag/connectors/github.connector.js` |
| Modify | `mcp-server/src/core/config-schema.js` |
| Modify | `mcp-server/src/core/config.js` |

### Phase 2

| Action | Path |
|--------|------|
| Add | `mcp-server/src/plugins/rag/chunking/index.js` |
| Add | `mcp-server/src/plugins/rag/chunking/strategies/fixed.js` |
| Add | `mcp-server/src/plugins/rag/chunking/strategies/sentence.js` |
| Add | `mcp-server/src/plugins/rag/embedding/index.js` |
| Add | `mcp-server/src/plugins/rag/embedding/openai.js` |
| Add | `mcp-server/src/plugins/rag/embedding/keyword.js` |
| Modify | `mcp-server/src/plugins/rag/index.js` |
| Modify | `mcp-server/src/plugins/rag/rag-connectors.js` |
| Modify | `mcp-server/src/core/config-schema.js` |

### Phase 3

| Action | Path |
|--------|------|
| Add | `mcp-server/src/plugins/rag/stores/pgvector.store.js` |
| Modify | `mcp-server/src/plugins/rag/stores/store.interface.js` |
| Modify | `mcp-server/src/plugins/rag/index.js` (store factory) |
| Modify | `mcp-server/src/core/config-schema.js` |

### Phase 4

| Action | Path |
|--------|------|
| Modify | `mcp-server/src/mcp/http-transport.js` |
| Modify | `mcp-server/src/mcp/gateway.js` |
| Modify | `mcp-server/src/core/jobs.js` |
| Modify | `mcp-server/src/plugins/rag/index.js` (tool schemas) |

### Phase 5

| Action | Path |
|--------|------|
| Add | `mcp-server/src/plugins/rag/evaluation/evaluate.js` |
| Add | `mcp-server/src/plugins/rag/evaluation/schema.js` |
| Modify | `mcp-server/src/plugins/rag/index.js` |
| Add | `docs/rag-evaluation-format.md` |

---

## 6. Dependency Impact

| Phase | New Dependencies | Notes |
|-------|------------------|-------|
| 1 | None | Uses existing `openai`, `zod` |
| 2 | None | Pure refactor |
| 3 | `pg` (already in package.json) | PgVector uses pg extension |
| 4 | None | |
| 5 | None | |

**Assumption:** PgVector is a PostgreSQL extension; `pg` client is already present. No new npm packages for Phases 1–5.

---

## 7. Backward Compatibility Notes

| Area | Guarantee |
|------|------------|
| **REST endpoints** | `POST /rag/index`, `POST /rag/index-batch`, `POST /rag/search`, etc. — unchanged |
| **MCP tools** | `rag_index`, `rag_index_batch`, `rag_search`, `rag_get`, `rag_delete`, `rag_stats` — unchanged |
| **Response format** | `{ ok, data, error }` envelope — unchanged |
| **Workspace isolation** | `x-workspace-id` → `global` fallback — unchanged |
| **MemoryStore** | Remains default; no migration forced |
| **Config** | Existing RAG env vars — same behavior; new vars optional |

**Breaking change avoidance:** All new ingestion/evaluation endpoints and tools are additive. Existing clients continue to work without modification.

---

## 8. Assumptions

1. **GitHub connector import:** `github.connector.js` uses `./rag-connectors.js`; the correct path from `connectors/` is `../rag-connectors.js`. If the connector is not used, this may not have been tested.
2. **MCP context:** The MCP SDK's `handleRequest` forwards the second parameter (e.g. `{ user, scopes }`) to handlers as `request.context`. If not, the Phase 4 transport change may need adjustment.
3. **PgVector:** Assumed available in the target PostgreSQL instance. Migration or setup is out of scope for this plan.
4. **Job context:** `workspaceId` is not currently in job `context`; adding it is backward-compatible (optional field).
5. **Brain plugin:** Uses `useTool(..., { workspaceId })` internally; external MCP clients would need workspace via headers (Phase 4) or tool args.

---

## 9. Summary

The current architecture supports a clean evolution path from tool execution to knowledge + execution. The RAG plugin has core indexing and search in place, with connectors and an ingestion pipeline defined but not wired. The recommended approach is to:

1. **Wire connectors** (Phase 1) — minimal change, high value.
2. **Extract chunking/embedding** (Phase 2) — enables future strategies.
3. **Add persistent store** (Phase 3) — production readiness.
4. **Fix workspace context** (Phase 4) — consistent isolation.
5. **Add evaluation** (Phase 5) — optional quality tooling.

All phases preserve backward compatibility and align with existing plugin, tool, policy, and job patterns.
