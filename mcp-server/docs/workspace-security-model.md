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

## Integration Points

| Area | Integration |
|------|-------------|
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
