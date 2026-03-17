# Post-Fix Audit Report

**Date:** 2025-03-17  
**Scope:** Five refactored areas + dead code / incomplete refactors  
**Method:** Code inspection, grep, test review, doc cross-check

---

## Executive Summary

| Area | Status | Score | Notes |
|------|--------|-------|-------|
| 1. Workspace security unification | **YES** | 9/10 | Central `workspace-paths.js` + `workspace-permissions.js`; plugins migrated |
| 2. Workspace-aware job context | **YES** | 9/10 | Jobs receive `workspaceId`; rag-ingestion passes context; runner uses it |
| 3. MCP workspace context propagation | **PARTIAL** | 7/10 | HTTP: full; STDIO: no `workspaceId` propagation |
| 4. Plugin loader cleanup | **YES** | 9/10 | `plugins.js` canonical; registry deprecated; dead code remains |
| 5. OCR integration | **YES** | 9/10 | Registry + PDF fallback + `RAG_OCR_PROVIDER`; no real provider impl |

**Overall:** Refactors are largely complete and wired. Main gaps: STDIO workspace context, middleware `x-workspace-id` handling, and deprecated registry/tool.discovery code still present.

---

## 1. Workspace Security Unification

**Status: YES**

### Files and Functions

| File | Function / Role |
|------|------------------|
| `src/core/workspace-paths.js` | `validateWorkspacePath`, `getWorkspaceRoot`, `resolveWorkspacePath`, `requireWorkspaceId`, `sanitizeWorkspaceId`, `canAccessWorkspace`, `validatePathWithinBase` |
| `src/core/workspace-permissions.js` | `canReadWorkspace`, `canWriteWorkspace`, `canRunTool`, `canModifyIndex`, `checkCrossWorkspaceAccess` |
| `src/plugins/workspace/workspace.core.js` | Uses `validateWorkspacePath`, `getWorkspaceRoot`, `requireWorkspaceId` |
| `src/plugins/repo-intelligence/repo.core.js` | Uses `validateWorkspacePath`, `getWorkspaceRoot`, `requireWorkspaceId` |
| `src/plugins/tech-detector/index.js` | Uses `validateWorkspacePath`, `requireWorkspaceId` |
| `src/plugins/rag-ingestion/index.js` | Uses `canModifyIndex` (lines 145, 200, 273) |
| `src/plugins/rag/index.js` | Uses `canModifyIndex` (lines 280, 323) |

### How It Works

1. **Path validation:** All file operations use `validateWorkspacePath` or `resolveWorkspacePath` from `workspace-paths.js`.
2. **Permission checks:** RAG/index operations call `canModifyIndex` before indexing.
3. **Workspace ID:** `requireWorkspaceId` enforces `workspaceId` when `WORKSPACE_REQUIRE_ID=true`.

### Runtime Wiring

- `workspaceContextMiddleware` runs on all requests (`server.js` line 191).
- Plugins read `workspaceId` from `context` or `req.headers["x-workspace-id"]`.
- Path validation is used in workspace, repo-intelligence, tech-detector, and project-orchestrator.

### Missing Parts

- `workspaceContextMiddleware` does **not** set `req.workspaceId` from `x-workspace-id`; it only sets it from `x-project-id` via `resolveWorkspaceContext`. Callers that use `req.headers["x-workspace-id"]` still work, but the middleware is incomplete.
- Some plugins (e.g. code-review, git) may still use local path helpers; not fully audited.

### Backward Compatibility

- When `workspaceId` is absent, plugins fall back to `"global"` or legacy base paths.
- `WORKSPACE_STRICT_BOUNDARIES` and `WORKSPACE_REQUIRE_ID` are opt-in.

### Tests and Docs

- **Tests:** `tests/core/workspace-security.test.js`, `tests/security/workspace-paths-integration.test.js`
- **Docs:** `docs/workspace-security-model.md`

---

## 2. Workspace-Aware Job Context

**Status: YES**

### Files and Functions

| File | Function / Role |
|------|------------------|
| `src/core/jobs.js` | `submitJob(type, payload, context)` — builds `jobContext` with `workspaceId`, `projectId`, `userId` (lines 107–120); passes `ctx` to runner (line 220) |
| `src/plugins/rag-ingestion/index.js` | `registerJobRunner("rag.ingestion", ...)` — uses `context.workspaceId ?? payloadCtx?.workspaceId ?? "global"` (lines 110–116); `submitJob(..., { workspaceId: ctx.workspaceId, ... })` (lines 361–364, 411) |
| `src/core/server.js` | `POST /jobs` — passes `workspaceId: req.workspaceId ?? req.headers?.["x-workspace-id"] ?? "global"` (line 338) |

### How It Works

1. `submitJob` normalizes `context` into `jobContext` with `workspaceId`, `projectId`, `userId`.
2. The job is stored with `context: jobContext`.
3. `runJob` passes `ctx = { ...job.context, workspaceId: job.context.workspaceId ?? "global" }` to the runner.
4. The rag-ingestion runner uses `execCtx.workspaceId` when calling `runPipeline`.

### Runtime Wiring

- Jobs are submitted via REST (`POST /jobs`) and via rag-ingestion async ingest.
- Both paths pass `workspaceId` into `submitJob`.
- The runner receives `context` with `workspaceId` and uses it for pipeline execution.

### Missing Parts

- None identified for job context propagation.

### Backward Compatibility

- When `workspaceId` is missing, `jobContext.workspaceId` defaults to `"global"`.
- Tests confirm fallback behavior.

### Tests and Docs

- **Tests:** `tests/jobs/workspace-context.test.js` (4 tests)
- **Docs:** Not explicitly documented; `docs/workspace-security-model.md` mentions job context indirectly.

---

## 3. MCP Workspace Context Propagation

**Status: PARTIAL**

### Files and Functions

| File | Function / Role |
|------|------------------|
| `src/mcp/http-transport.js` | Extracts `x-workspace-id`, `x-project-id` from headers (lines 126–133); builds `authInfo` (lines 135–140); passes to `clientTransport.send(message, { authInfo })` |
| `src/mcp/gateway.js` | `CallToolRequestSchema` handler receives `extra?.authInfo`; builds `context` with `workspaceId`, `projectId` (lines 46–54); passes to `callTool(name, args, context)` |
| `src/core/tool-registry.js` | `callTool` passes `context` to `tool.handler(args, context)` (line 254) |
| `src/mcp/stdio-transport.js` | Raw stdin/stdout; no header extraction; no `authInfo` passed |
| `bin/mcp-hub-stdio.js` | Supports `--project-id`, `--env`; no `--workspace-id` or `HUB_WORKSPACE_ID` |

### How It Works

**HTTP transport:**

1. Request includes `x-workspace-id` and `x-project-id`.
2. `authInfo` is built and passed to the transport.
3. Gateway handler receives `extra.authInfo` and builds `context`.
4. `callTool` passes `context` to tool handlers.

**STDIO transport:**

- No headers; no `authInfo`.
- `context.workspaceId` is `null` unless the SDK or another layer injects it.
- `mcp-context.md` notes env vars (`HUB_PROJECT_ID`, `HUB_ENV`) but not `HUB_WORKSPACE_ID`.

### Runtime Wiring

- HTTP: fully wired; tests confirm header → context propagation.
- STDIO: not wired for workspace context.

### Missing Parts

- STDIO: no `workspaceId` propagation.
- `mcp-hub-stdio`: no `--workspace-id` or `HUB_WORKSPACE_ID`.
- STDIO transport does not read env and inject `workspaceId` into tool context.

### Backward Compatibility

- When headers are absent, `workspaceId` is `null`; tools use `context.workspaceId || "global"`.
- STDIO clients get `"global"` by default.

### Tests and Docs

- **Tests:** `tests/mcp/workspace-context.test.js` (HTTP propagation)
- **Docs:** `docs/mcp-context.md`

---

## 4. Plugin Loader Cleanup

**Status: YES**

### Files and Functions

| File | Function / Role |
|------|------------------|
| `src/core/plugins.js` | `loadPlugins(app)` — canonical loader; discovers plugins, validates meta, registers tools |
| `src/core/server.js` | Calls `loadPlugins(app)` (line 631); no registry usage |
| `src/core/registry/index.js` | Marked `@deprecated`; "Kept for backward compatibility with registry tests only" |
| `src/core/tools/tool.discovery.js` | Marked `@deprecated`; uses `getRegistry()`; "Kept for tools/tool.registry tests" |
| `src/core/tools/tool.registry.js` | Marked `@deprecated`; uses `tool.discovery` |
| `src/core/observability/runtime.stats.js` | Uses `getPlugins`, `getFailedPlugins` from `plugins.js`; `getToolStats` from `tool-registry.js` |

### How It Works

1. `server.js` calls `loadPlugins(app)`.
2. `plugins.js` scans `src/plugins/*/`, validates `plugin.meta.json`, imports `index.js`, calls `register(app)`, registers tools via `registerTool`.
3. Observability uses `plugins.js` and `tool-registry.js`, not the deprecated registry.

### Runtime Wiring

- Server startup uses only `plugins.js`.
- Registry is not used during startup.

### Missing Parts

- Deprecated code still present: `src/core/registry/`, `src/core/tools/tool.discovery.js`, `src/core/tools/tool.registry.js`.

### Backward Compatibility

- Registry tests still run; deprecated modules are kept for them.
- No production code depends on the registry for plugin loading.

### Tests and Docs

- **Tests:** `src/core/registry/registry.test.js`, `src/core/tools/tools.test.js`
- **Docs:** `docs/architecture.md` (deprecation notes)

---

## 5. OCR Integration

**Status: YES**

### Files and Functions

| File | Function / Role |
|------|------------------|
| `src/plugins/rag-ingestion/ocr/index.js` | `getOcrProvider(name)` — uses `RAG_OCR_PROVIDER` when `name` is null (lines 23–28); `registerOcrProvider`, `listOcrProviders`, `_clearOcrProvidersForTesting` |
| `src/plugins/rag-ingestion/pipeline/loaders/pdf.loader.js` | `loadPdf` — uses pdf-parse; on empty text, calls `getOcrProvider()`, runs OCR for all pages (lines 46–58) |
| `.env` | `RAG_OCR_PROVIDER=` (optional) |
| `docs/rag-ingestion.md` | OCR Integration section |
| `docs/environment-variables.md` | RAG section with `RAG_OCR_PROVIDER` |

### How It Works

1. Text-based PDF: pdf-parse extracts text; `extractedVia: "text"`.
2. Scanned PDF: if text is empty, `getOcrProvider()` resolves provider from `RAG_OCR_PROVIDER` or default.
3. If provider is healthy and not noop, OCR runs for each page and text is concatenated.
4. If no usable provider, a clear error is thrown.

### Runtime Wiring

- PDF loader is used by the pipeline when `format === "pdf"`.
- `getOcrProvider()` reads `process.env.RAG_OCR_PROVIDER` at call time.
- No real OCR provider is registered by default; only `NoopOcrProvider` is used when none is configured.

### Missing Parts

- No concrete OCR provider (e.g. Tesseract) in the codebase.
- Providers must be registered at startup by plugins or app code.

### Backward Compatibility

- When `RAG_OCR_PROVIDER` is unset, `getOcrProvider()` returns `NoopOcrProvider` or `defaultProvider`.
- Scanned PDFs fail with a clear message if no provider is configured.

### Tests and Docs

- **Tests:** `tests/plugins/rag-ingestion/ocr.test.js` (11 tests)
- **Docs:** `docs/rag-ingestion.md` (OCR Integration), `docs/environment-variables.md`

---

## Evidence Verification

| Claim | Evidence |
|-------|----------|
| Workspace paths centralized | `workspace-paths.js` exports; plugins import from it |
| Jobs receive workspaceId | `jobs.js` lines 116–120, 220; `rag-ingestion` lines 361–364 |
| MCP HTTP propagates workspace | `http-transport.js` lines 126–140; `gateway.js` lines 46–54 |
| MCP STDIO does not | `stdio-transport.js` has no authInfo; `mcp-hub-stdio` has no workspace-id |
| plugins.js is canonical | `server.js` line 631; no registry import for loading |
| Registry deprecated | `registry/index.js` deprecation comment |
| OCR wired | `pdf.loader.js` uses `getOcrProvider()`; `ocr/index.js` uses `RAG_OCR_PROVIDER` |

---

## Gap Analysis

| Gap | Severity | Area |
|-----|----------|------|
| STDIO has no workspace context | Medium | MCP |
| `workspaceContextMiddleware` ignores `x-workspace-id` | Low | Workspace |
| Deprecated registry/tool.discovery still in tree | Low | Plugin loader |
| No concrete OCR provider implementation | Low | OCR |
| `HUB_WORKSPACE_ID` not documented for STDIO | Low | MCP |

---

## Scoring

| Area | Completeness | Wiring | Tests | Docs | Score |
|------|--------------|--------|-------|------|-------|
| Workspace security | 95% | 100% | Good | Good | 9/10 |
| Job context | 100% | 100% | Good | Partial | 9/10 |
| MCP propagation | 70% | 50% (STDIO) | HTTP only | Good | 7/10 |
| Plugin loader | 100% | 100% | Good | Good | 9/10 |
| OCR integration | 95% | 100% | Good | Good | 9/10 |

---

## Dead Code and Incomplete Refactors

### Dead / Deprecated Code

| Path | Status | Notes |
|------|--------|------|
| `src/core/registry/` | Deprecated | Used only by registry tests |
| `src/core/tools/tool.discovery.js` | Deprecated | Uses registry; kept for tools tests |
| `src/core/tools/tool.registry.js` | Deprecated | Uses tool.discovery |
| `src/core/jobs/job.worker.js` | Possibly unused | `JobWorker` class; `jobs.js` uses inline `runJob`, not this worker |

### Duplicated Logic

- `req.headers["x-workspace-id"]` and `req.workspaceId` are read in many places; could be centralized in middleware.
- Job context normalization (`workspaceId ?? "global"`) appears in several plugins.

### Old Code Paths

- Registry-based plugin loading is no longer used but code remains for tests.
- `tool.discovery` and `tool.registry` are still imported by `tools/index.js` and tests.
- **Dual job systems:** `src/core/jobs.js` (legacy) is used by server and rag-ingestion; `src/core/jobs/job.manager.js` (JobManager/JobWorker) is used by observability. Runtime job execution goes through `jobs.js`; JobManager may be an alternate or future path.

---

## Top 5 Remaining Fixes

1. **STDIO workspace context**  
   Add `HUB_WORKSPACE_ID` (and optionally `--workspace-id`) support for `mcp-hub-stdio` and inject `workspaceId` into tool context for STDIO transport.

2. **`workspaceContextMiddleware` and `x-workspace-id`**  
   When `x-workspace-id` is present, set `req.workspaceId` so all code paths can rely on `req.workspaceId` instead of reading headers directly.

3. **Remove or isolate deprecated registry**  
   Either delete `src/core/registry/` and `src/core/tools/` deprecated modules and migrate/remove their tests, or move them to a `_deprecated` or `legacy` package.

4. **Document job workspace context**  
   Add a short section to `docs/workspace-security-model.md` or `docs/mcp-context.md` describing how jobs receive and use `workspaceId`.

5. **Optional: Tesseract OCR provider**  
   Add a `TesseractOcrProvider` implementation and register it when `RAG_OCR_PROVIDER=tesseract` and the dependency is available, so scanned PDFs work out of the box.
