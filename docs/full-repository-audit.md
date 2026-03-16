# Full Repository Audit

**Date:** 2025-03-17  
**Scope:** MCP-Hub development roadmap phases 0–5  
**Method:** Code inspection, no implementation

---

## 1. Executive Summary

MCP-Hub is a plugin-based HTTP service with MCP (Model Context Protocol) support. The repository has implemented most roadmap phases, but with notable gaps: **workspace plugin and repo-intelligence do not use the new workspace-paths module**; **tech-detector** has its own path validation; **no generic REST /tools endpoint** (tools are MCP-only plus plugin-specific routes). RAG ingestion, retrieval evals, plugin SDK, and open-source docs are present and wired. Overall maturity: **7/10** — functional but with integration gaps and some disconnected code.

---

## 2. Architecture Overview

### 2.1 Folder Structure

```
mcp-hub/
├── mcp-server/           # Main server
│   ├── src/
│   │   ├── core/         # Auth, audit, config, jobs, policy, tool-registry, plugins, workspace
│   │   ├── plugins/      # 40+ plugins (rag, rag-ingestion, retrieval-evals, git, code-review, example-sdk, etc.)
│   │   ├── mcp/          # HTTP transport, gateway (listTools, callTool)
│   │   └── public/       # UI, admin, landing
│   ├── bin/              # create-plugin.js, run-retrieval-evals.js
│   ├── templates/        # plugin-template/
│   └── tests/
├── docs/                 # Documentation index, examples, RELEASE, OPEN-SOURCE-READINESS
├── .github/              # PULL_REQUEST_TEMPLATE, ISSUE_TEMPLATE/
└── mcps/                 # MCP tool descriptors (external)
```

### 2.2 How the System Works

1. **Entry:** `src/index.js` → `createServer()` in `src/core/server.js`
2. **Middleware:** correlationId, projectContext, workspaceContext, audit, policyGuardrail
3. **Plugin loading:** `loadPlugins(app)` scans `src/plugins/*/index.js`, validates `plugin.meta.json`, calls `plugin.register(app)`, registers tools via `registerTool()`
4. **Tool invocation:** MCP gateway (`/mcp`) uses `listTools()` and `callTool()` from `src/core/tool-registry.js`; plugins expose their own REST routes (e.g. `/prompts`, `/rag-ingestion/ingest`)
5. **Jobs:** `submitJob(type, payload)` → `registerJobRunner(type, handler)`; rag-ingestion registers `rag.ingestion`
6. **Workspace:** `workspaceContextMiddleware` sets `req.workspaceId` from `x-project-id`; `getWorkspace()`, `isPluginAllowed()` in `src/core/workspace.js`

### 2.3 Key Wiring

| Component | Entry | Wired Via |
|-----------|-------|-----------|
| Plugins | `loadPlugins(app)` | `server.js` line 458 |
| Tools | `registerTool()` | Each plugin's `register()`; `loadPlugins` iterates `plugin.tools` |
| MCP | `createMcpHttpMiddleware()` | `app.all("/mcp", ...)` in server.js |
| Jobs | `registerJobRunner()` | rag-ingestion index.js line 110 |
| Workspace context | `workspaceContextMiddleware` | server.js line 188 |
| Audit | `auditMiddleware`, `auditLog` | server.js, plugins |

---

## 3. Phase Verification Table

| Phase | Status | Evidence | Missing / Risk |
|-------|--------|----------|----------------|
| **PHASE 0 — Architecture** | YES | `docs/architecture-growth-plan.md`, `mcp-server/ARCHITECTURE.md` describe plugin loader, tool registry, jobs, policy | Architecture doc is partly in Turkish; growth plan references `plugin.contract.js` but loader uses `plugins.js` |
| **PHASE 1 — RAG Ingestion** | YES | `src/plugins/rag-ingestion/` — pipeline.js (loader→normalizer→chunker→enricher→embedding→indexer), loaders (markdown, text, pdf), chunkers (fixed, heading, sliding, semantic), OCR abstraction (noop), job integration, audit | PDF loader exists; OCR is noop only — no real OCR provider |
| **PHASE 2 — Retrieval Evals** | YES | `src/plugins/retrieval-evals/` — parseDataset, runEvaluation, compareStrategies, metrics (hitAtK, recallAtK, reciprocalRank, chunkCoverage), saveEvaluationResult, REST /run /compare, CLI `bin/run-retrieval-evals.js`, `npm run eval:run` | MRR named `reciprocalRank`; latency metric not clearly exposed |
| **PHASE 3 — Workspace Security** | PARTIAL | `src/core/workspace-paths.js`, `workspace-permissions.js`; git and code-review use `validateWorkspacePath` with workspaceId; rag-ingestion uses `canModifyIndex` | **Workspace plugin** uses its own `validateWorkspacePath` in workspace.core.js (NOT core/workspace-paths). **Repo-intelligence** uses `safeResolvePath` with BASE_REPO_PATH. **Tech-detector** has local `safePath`. **Project-orchestrator** uses `safeWorkspacePath` (different impl) |
| **PHASE 4 — Plugin SDK** | YES | `src/core/plugin-sdk/` (tool-utils, config-utils, audit-utils, context-utils, validate-utils, metrics-utils); `templates/plugin-template/`; `bin/create-plugin.js`; `src/plugins/example-sdk/`; `mcp-server/docs/plugin-sdk.md` | example-sdk is loaded as plugin; template uses `../../core/plugin-sdk` (correct for generated plugin) |
| **PHASE 5 — Open Source** | YES | `docs/README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `docs/RELEASE.md`, `docs/OPEN-SOURCE-READINESS.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/`, `docs/examples/`, env vars doc with security note | CONTRIBUTING references `your-org` placeholder; some docs mixed Turkish/English |

---

## 4. Evidence Verification

### 4.1 RAG Ingestion Pipeline

| Item | Location | Wired | Tests | Docs |
|------|----------|-------|-------|------|
| Pipeline | `rag-ingestion/pipeline/pipeline.js` | `runPipeline()` called from index.js routes and tools | `tests/plugins/rag-ingestion/pipeline.test.js` | `docs/rag-ingestion.md` |
| Loaders | `pipeline/loaders/` (markdown, text, pdf) | pipeline.js lines 86–93 | pipeline.test.js | — |
| Chunkers | `pipeline/chunkers/` (fixed, heading, sliding, semantic) | pipeline.js lines 98–106 | pipeline.test.js | — |
| Indexer | `pipeline/indexers/rag.indexer.js` | Uses `callTool("rag_index_batch", ...)` | — | — |
| Job | `registerJobRunner("rag.ingestion", ...)` | index.js line 110 | — | — |
| OCR | `ocr/index.js`, `noop.provider.js` | Registry only; no loader uses OCR | — | — |

**Reachability:** Ingest via `POST /rag-ingestion/ingest`, `POST /rag-ingestion/ingest-markdown`, `POST /rag-ingestion/reindex`; MCP tools `ingest_document`, `ingest_markdown`, `reindex_document`. All reachable.

### 4.2 Retrieval Evaluation

| Item | Location | Wired | Tests | Docs |
|------|----------|-------|-------|------|
| Dataset parser | `retrieval-evals/dataset/parser.js` | Used in /run and /compare routes | `dataset.test.js` | `docs/retrieval-evals.md` |
| Metrics | `retrieval-evals/metrics/index.js` | hitAtK, recallAtK, reciprocalRank, chunkCoverage | `metrics.test.js` | — |
| Runner | `retrieval-evals/runner.js` | `runEvaluation()` | — | — |
| Strategy comparison | `strategy-comparison.js` | `compareStrategies()` | `strategy-comparison.test.js` | — |
| REST | `POST /retrieval-evals/run`, `POST /retrieval-evals/compare` | index.js | — | — |
| CLI | `bin/run-retrieval-evals.js` | `npm run eval:run`, `eval:compare` | — | — |

**Reachability:** REST and CLI both work. CLI loads app, then calls runner/compare programmatically.

### 4.3 Workspace Security

| Item | Location | Wired | Tests | Docs |
|------|----------|-------|-------|------|
| workspace-paths | `core/workspace-paths.js` | Used by git.core, code-review | `workspace-security.test.js` | `workspace-security-model.md` |
| workspace-permissions | `core/workspace-permissions.js` | Used by rag-ingestion, rag | — | — |
| Git | `git.core.js` | `safeRepoPath(path, workspaceId)` | — | — |
| Code-review | `code-review/index.js` | `safePath(path, workspaceId)` | — | — |
| Workspace plugin | `workspace/workspace.core.js` | **Own `validateWorkspacePath`** — NOT core/workspace-paths | — | — |
| Repo-intelligence | `repo.core.js` | **Own `safeResolvePath`** — NOT workspace-paths | — | — |

**Disconnected:** Workspace plugin, repo-intelligence, tech-detector, project-orchestrator do not use `core/workspace-paths.js`.

### 4.4 Plugin SDK

| Item | Location | Wired | Tests | Docs |
|------|----------|-------|-------|------|
| createTool, registerTools | `plugin-sdk/tool-utils.js` | example-sdk, template | — | plugin-sdk.md |
| loadPluginConfig | `plugin-sdk/config-utils.js` | example-sdk | — | — |
| createAuditHelper | `plugin-sdk/audit-utils.js` | example-sdk | — | — |
| Template | `templates/plugin-template/` | Used by create-plugin.js | — | — |
| Generator | `bin/create-plugin.js` | `npm run create-plugin` | — | — |
| Example | `plugins/example-sdk/` | Loaded by plugins.js | — | — |

**Reachability:** example-sdk loads; `/example-sdk/health`, `/example-sdk/echo` work; tools `example_sdk_hello`, `example_sdk_echo` registered.

### 4.5 Dead / Unused Code

| Item | Location | Status |
|------|----------|--------|
| `src/core/tools/` | tool.registry.js, tool.discovery.js, etc. | Observability imports `getToolRegistry` from here; main registry is `tool-registry.js` — possible duplicate/legacy |
| `src/core/registry/` | plugin.discovery.js, plugin.lifecycle.js | Architecture doc references; plugins.js does not use them |
| OCR providers | `rag-ingestion/ocr/` | No loader calls `getOcrProvider()` — abstraction present but unused |

---

## 5. Gap Analysis

### 5.1 Missing Features

| Title | Severity | Evidence | Impact |
|-------|----------|----------|--------|
| Workspace plugin not using core workspace-paths | **High** | workspace.core.js has its own validateWorkspacePath; different root logic | Inconsistent path safety; workspace plugin can behave differently from git/code-review |
| Repo-intelligence not workspace-aware | **Medium** | repo.core.js uses BASE_REPO_PATH only | No per-workspace path confinement for repo analysis |
| No generic REST /tools/:name endpoint | **Low** | Tools only via MCP; plugins have custom routes | REST clients must use plugin-specific routes |
| OCR not integrated into loaders | **Low** | OCR registry exists; no loader uses it | PDF/images without OCR; abstraction is placeholder |

### 5.2 Partially Implemented

| Title | Severity | Evidence | Impact |
|-------|----------|----------|--------|
| Workspace security in path-using plugins | **High** | Only git and code-review use workspace-paths; workspace, repo-intelligence, tech-detector, project-orchestrator do not | Incomplete boundary enforcement |
| Job context workspaceId | **Medium** | architecture-growth-plan notes "workspaceId not in job context today" | Jobs may not be workspace-scoped |
| MCP context workspaceId | **Medium** | Tool handlers receive context; MCP gateway may not pass x-workspace-id | Workspace isolation may not apply to MCP calls |

### 5.3 Disconnected Implementations

| Title | Severity | Evidence | Impact |
|-------|----------|----------|--------|
| core/registry vs plugins.js | **Medium** | plugin.contract.js, plugin.discovery.js exist; plugins.js does not use them | Two plugin loading approaches; potential confusion |
| core/tools vs tool-registry | **Low** | tools.metrics imports from tools/tool.registry.js | May be adapter; needs verification |

### 5.4 Security Gaps

| Title | Severity | Evidence | Impact |
|-------|----------|----------|--------|
| Workspace plugin path validation | **Medium** | Uses ~ expansion, single WORKSPACE_ROOT; no workspaceId | Different security model than core/workspace-paths |
| Repo-intelligence path | **Low** | REPO_PATH/cwd; no workspace scoping | All repos under one base |
| File path in retrieval-evals | **Low** | `readFileSync(join(process.cwd(), path))` for dataset file | Path traversal if user controls path |

### 5.5 Missing Tests

| Area | Evidence |
|------|----------|
| Plugin SDK | No tests for createTool, registerTools, loadPluginConfig |
| Workspace permissions | workspace-security.test.js covers paths; no integration tests for rag/git with permissions |
| Retrieval evals REST | No supertest for /retrieval-evals/run, /compare |
| RAG ingestion REST | pipeline.test.js covers chunkers; no route tests |

### 5.6 Architecture Inconsistencies

| Issue | Evidence |
|-------|----------|
| Two validateWorkspacePath implementations | core/workspace-paths.js vs workspace/workspace.core.js |
| Plugin contract vs loader | Contract defines register(router, context); plugins.js uses register(app) |
| Tool registry location | tool-registry.js (root) vs tools/tool.registry.js |

### 5.7 Naming Inconsistencies

| Issue | Evidence |
|-------|----------|
| Package name | package.json: "ai-hub"; repo: mcp-hub |
| retrieval-evals vs retrieval-eval | Scripts use eval:run; plugin folder retrieval-evals |

---

## 6. Technical Maturity Scoring

| Area | Score | Evidence |
|------|-------|----------|
| **Architecture maturity** | 7/10 | Clear plugin/tool/job flow; duplicate registry/contract code; workspace model split across modules |
| **RAG pipeline maturity** | 8/10 | Full pipeline, 4 chunk strategies, job integration, tests; OCR unused |
| **Security maturity** | 6/10 | workspace-paths and permissions exist; workspace plugin and others not integrated; path validation fragmented |
| **Plugin extensibility** | 8/10 | SDK, template, generator, example; migration path documented |
| **Developer experience** | 7/10 | create-plugin, docs, examples; some docs Turkish; CONTRIBUTING has placeholder URLs |
| **Documentation** | 7/10 | docs/README.md index, examples, RELEASE, OPEN-SOURCE-READINESS; mixed languages; some broken links possible |
| **Open source readiness** | 7/10 | CONTRIBUTING, PR/issue templates, SECURITY, CHANGELOG; LICENSE present; checklist in OPEN-SOURCE-READINESS |

---

## 7. Final Recommendations

### Implemented Features

- RAG ingestion pipeline (loaders, chunkers, enrichers, indexer, job integration)
- Retrieval evaluation (dataset format, metrics, strategy comparison, REST, CLI)
- Workspace path safety and permissions (core modules)
- Git and code-review integration with workspace-paths
- Plugin SDK (createTool, registerTools, config, audit, validation, metrics)
- Plugin template and create-plugin generator
- Example SDK plugin
- Documentation index, examples, CONTRIBUTING, PR/issue templates, RELEASE, SECURITY

### Partially Implemented

- Workspace security: core exists; workspace plugin, repo-intelligence, tech-detector, project-orchestrator not migrated
- Job context: no workspaceId in job payload
- MCP workspace propagation: unclear if x-workspace-id reaches tool context

### Missing Features

- Generic REST /tools endpoint
- OCR integration in loaders
- Unified plugin loader (registry vs plugins.js)
- Integration tests for workspace permissions in rag/git

### Dead / Disconnected Code

- `src/core/registry/` (plugin discovery, lifecycle) — not used by plugins.js
- OCR provider registry — no loader integration
- Possible duplicate tool registry (tools/tool.registry.js vs tool-registry.js)

### Top 10 Risks

1. **Workspace plugin uses different path validation** — inconsistent security
2. **Repo-intelligence not workspace-scoped** — cross-workspace access possible
3. **No workspaceId in job context** — jobs may bypass workspace isolation
4. **MCP workspace context unclear** — tool handlers may not receive workspaceId
5. **Duplicate plugin/tool infrastructure** — maintenance burden
6. **Retrieval-evals file path** — potential path traversal if path is user-controlled
7. **OCR abstraction unused** — dead code or future work unclear
8. **Package name mismatch** — ai-hub vs mcp-hub
9. **Documentation language mix** — Turkish/English
10. **CONTRIBUTING placeholder URLs** — your-org needs replacement

### Top 5 Next Improvements

1. **Migrate workspace plugin to core/workspace-paths** — Use `validateWorkspacePath(requestedPath, workspaceId)` and `getWorkspaceRoot(workspaceId)` for consistency.
2. **Add workspaceId to job context** — Pass workspaceId in `submitJob` and `registerJobRunner` payload for rag.ingestion and others.
3. **Verify MCP workspace propagation** — Ensure x-workspace-id flows into tool `context` in gateway.
4. **Consolidate plugin loading** — Use either plugins.js or registry/contract; remove or clearly deprecate the other.
5. **Add integration tests** — Workspace permissions in rag-ingestion and git; retrieval-evals REST; plugin SDK usage.

---

## Console Summary

```
AUDIT COMPLETE

Phases: 0✓ 1✓ 2✓ 3△ 4✓ 5✓
(△ = partial)

Key gaps:
- Workspace plugin, repo-intelligence, tech-detector do NOT use core/workspace-paths
- core/registry/ unused by plugin loader
- No generic REST /tools endpoint
- Job context lacks workspaceId

Scores: Architecture 7, RAG 8, Security 6, Plugin SDK 8, DX 7, Docs 7, OSS 7
```
