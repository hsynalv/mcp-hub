# Workspace Security Model

This document describes the workspace isolation and security hardening implemented in MCP-Hub for safe multi-workspace usage.

## Workspace Model

### Core Concepts

| Concept | Description |
|--------|-------------|
| `workspace_id` | Unique identifier for a workspace. Must match `[a-zA-Z0-9_-]+`. |
| `workspace_root` | Per-workspace filesystem root. When set, all path operations are confined to this directory. |
| `allowed_operations` | Optional list of operation types (e.g. `read`, `write`, `index`, `git`) permitted in the workspace. |
| `plugin_permission_scope` | Per-plugin permission overrides. |

### Workspace Entity

The `Workspace` entity (in `src/core/workspace.js`) includes:

- `id`, `name`, `owner`
- `settings.allowedPlugins` – plugin allowlist (empty = all allowed)
- `settings.workspace_root` – per-workspace root path
- `settings.allowed_operations` – operation allowlist
- `settings.plugin_permission_scope` – per-plugin scope
- `settings.readOnly` – when true, write operations are denied

## Permission Flow

### Permission Checks

Plugins use the permission abstraction in `src/core/workspace-permissions.js`:

| Check | Purpose |
|------|---------|
| `canReadWorkspace(context)` | Verify actor can read from workspace |
| `canWriteWorkspace(context)` | Verify actor can write (includes read-only check) |
| `canRunTool(toolName, context, operationType)` | Verify tool can run in workspace context |
| `canModifyIndex(context)` | Verify RAG/index modifications are allowed |
| `checkCrossWorkspaceAccess(caller, target, context)` | Verify cross-workspace access |

### Context Object

```ts
interface PermissionContext {
  workspaceId?: string;
  actor?: string;
  plugin?: string;
  operation?: string;
  correlationId?: string;
}
```

### Flow Diagram

```
Request → workspaceId from header/context
    → canReadWorkspace / canWriteWorkspace / canRunTool
    → if denied: auditDenied() → return error
    → if allowed: proceed with operation
```

## Path Safety

### Central Validation

All path validation goes through `src/core/workspace-paths.js`:

- `validateWorkspacePath(path, workspaceId)` – validates path is within workspace boundary
- `getWorkspaceRoot(workspaceId)` – resolves workspace root (per-workspace or derived)
- `resolvePathInWorkspace(path, workspaceId)` – returns resolved path or null if invalid
- `resolveWorkspacePath(path, workspaceId)` – validates and returns absolute path, throws on invalid
- `sanitizeWorkspaceId(id)` – prevents workspace ID injection

### Unified Workspace Path Validation

All plugins that read or write files use the central `workspace-paths` module. The canonical flow is:

```
requestedPath
  → validateWorkspacePath(requestedPath, workspaceId)
  → resolveWorkspacePath()  [or validatePath for plugins needing relative path]
  → perform file operation
```

**Migrated plugins:**

| Plugin | Replaced | Central API |
|--------|----------|-------------|
| workspace | `validateWorkspacePath` (local) | `validateWorkspacePath`, `getWorkspaceRoot`, `requireWorkspaceId` |
| repo-intelligence | `safeResolvePath` | `validateWorkspacePath`, `safeResolvePath` (wrapper) |
| tech-detector | `safePath` | `validateWorkspacePath` |
| project-orchestrator | `safeWorkspacePath` | `validatePathWithinBase` |

**workspaceId requirement:** When `WORKSPACE_REQUIRE_ID=true`, `requireWorkspaceId(workspaceId, operation)` throws a structured error if `workspaceId` is missing. All file operations should pass `workspaceId` from context (e.g. `x-workspace-id` header or tool context).

**For custom bases:** Plugins with project-scoped roots (e.g. `project-orchestrator` using `WORKSPACE_BASE/projectId`) use `validatePathWithinBase(requestedPath, basePath)` instead of `validateWorkspacePath`.

### Protections

| Threat | Protection |
|--------|-------------|
| Path traversal (`..`, `~`) | Rejected in `validateWorkspacePath` |
| Cross-workspace access | Blocked when `WORKSPACE_STRICT_BOUNDARIES=true` |
| Invalid workspace IDs | `sanitizeWorkspaceId` rejects unsafe chars |
| Symlink escape | File-storage adapter validates symlinks (local.js) |

## Security Guarantees

1. **Path confinement**: When `workspaceId` is provided, paths are validated against the workspace root. Paths escaping the root are rejected.

2. **Plugin allowlist**: Workspaces can restrict which plugins run via `allowedPlugins`. Empty list = all allowed.

3. **Operation allowlist**: Workspaces can restrict operation types via `allowed_operations`. When non-empty, only listed operations are permitted.

4. **Read-only workspaces**: When `settings.readOnly` is true, write operations (including index modifications) are denied.

5. **Audit of denials**: Every denied operation is logged via `auditLog` with:
   - `allowed: false`
   - `reason` (structured denial reason)
   - `timestamp`
   - `plugin`, `operation`, `actor`, `workspaceId`

## Workspace-Aware Jobs

Long-running jobs (e.g. RAG ingestion) run asynchronously outside the HTTP request lifecycle. Workspace context is captured at submit time and passed to runners.

### submitJob(type, payload, context)

```js
submitJob(type, payload, context)
```

| Parameter | Description |
|-----------|-------------|
| `type` | Job type (must have a registered runner) |
| `payload` | Job input data |
| `context` | `{ workspaceId?, projectId?, userId?, env? }` — captured at submit time |

### job.context Structure

Context is normalized before storage and passed to runners:

| Field | Source | Fallback |
|-------|--------|----------|
| `workspaceId` | `context.workspaceId` or `context.workspace` | `"global"` |
| `projectId` | `context.projectId` or `context.project?.id` | `null` |
| `userId` | `context.userId` or `context.user` or `context.actor` | `null` |
| `env` | `context.env` or `context.projectEnv` | `"development"` |

**workspaceId fallback:** If omitted, `workspaceId` defaults to `"global"`. Runners receive `context.workspaceId ?? "global"` so they always have a valid workspace.

### How Runners Receive Context

Runners are registered via `registerJobRunner(type, handler)`:

```js
handler(payload, context, updateProgress, log)
```

- `payload` — job input
- `context` — `{ workspaceId, projectId, userId, env }` (workspaceId always set, never null)
- `updateProgress`, `log` — helpers for progress and logging

### Async RAG Ingestion Example

The rag-ingestion plugin submits async jobs with workspace context from the request:

```js
// Extract context from HTTP request
const ctx = {
  workspaceId: req.workspaceId ?? "global",
  projectId: req.projectId ?? null,
  actor: req.user?.id || req.user?.email || "anonymous",
};

// Submit async job with context
const job = submitJob(
  "rag.ingestion",
  { request: { content, format, ... }, context: ctx },
  { workspaceId: ctx.workspaceId, projectId: ctx.projectId, userId: ctx.actor }
);
```

The runner merges job context with payload context and passes it to the pipeline:

```js
registerJobRunner("rag.ingestion", async (payload, context, updateProgress, log) => {
  const execCtx = {
    workspaceId: context.workspaceId ?? payload.context?.workspaceId ?? "global",
    projectId: context.projectId ?? payload.context?.projectId ?? null,
    actor: context.userId ?? payload.context?.actor ?? "anonymous",
  };
  const result = await runPipeline(payload.request, execCtx);
  return result;
});
```

`runPipeline` and the RAG indexer use `execCtx.workspaceId` for workspace isolation (e.g. `rag_index_batch` with `context.workspaceId`).

## Integration Points

| Area | Integration |
|------|-------------|
| Async jobs | `submitJob(type, payload, context)` captures workspaceId/projectId/userId at submit time; runners receive normalized context |
| File ingestion | RAG file connector uses workspace root when `workspaceId` in config |
| Reindexing | `canModifyIndex` in rag-ingestion and rag plugins |
| Git analysis | `safeRepoPath(path, workspaceId)` in git plugin |
| Code review | `safePath(path, workspaceId)` in code-review plugin |
| Prompt registry | Uses catalog cache dir; workspace scoping via storage keys |
| File storage | `FILE_STORAGE_WORKSPACE_ISOLATION` + `resolvePath` in local adapter |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `WORKSPACE_STRICT_BOUNDARIES` | When `true`, enforces cross-workspace access denial |
| `WORKSPACE_REQUIRE_ID` | When `true`, `requireWorkspaceId` throws if workspaceId is missing |
| `WORKSPACE_ROOT_BASE` | Base path for derived workspace roots |
| `WORKSPACE_ROOT` / `WORKSPACE_BASE` / `REPO_PATH` | Legacy; used when no per-workspace root |
| `FILE_STORAGE_WORKSPACE_ISOLATION` | Enable workspace subdirs in file storage |
| `FILE_STORAGE_WORKSPACE_STRICT` | Require workspaceId in file-storage context |

## Compatibility Notes

- **Backward compatibility**: When `workspaceId` is not provided, plugins fall back to legacy path validation (e.g. `WORKSPACE_BASE`). Existing single-workspace setups continue to work.
- **MCP context**: MCP tool invocations may not include `workspaceId` until Phase 4 (workspace header propagation). Until then, path validation uses the legacy base path when `workspaceId` is absent.
- **Strict mode**: `WORKSPACE_STRICT_BOUNDARIES` is opt-in. Default is permissive for existing deployments.
