# AI-Hub Architecture Stabilization Plan

A comprehensive plan to stabilize the AI-Hub MCP server architecture while preserving the existing plugin-based design.

---

## Overview

This plan addresses 8 key architectural improvements to make the system more reliable and extensible for the future J4RV1S AI system.

---

## Step 1 — Audit the Plugin System

**Files:** `mcp-server/src/core/plugins.js`

### Problems to Fix:

1. **Plugin loading silently ignores failures**
   - Currently: `console.warn()` then `continue` - failures are logged but not tracked
   - Fix: Collect failures in an array, add STRICT mode support via `config.strictPluginLoading`

2. **No async plugin initialization support**
   - Currently: `plugin.register(app)` (sync)
   - Fix: `await plugin.register?.(app)` (async-safe)

3. **Plugin manifest list not reset before loading**
   - Currently: `const loaded = []` at module level - persists across reloads
   - Fix: Clear `loaded` array at start of `loadPlugins()`

4. **Missing plugin folder validation**
   - Need to validate: `index.js` exists, `register` function exported, optional `manifest`

### Implementation:
- Add `failedPlugins` array to track failures
- Add strict mode check: if `config.strictPluginLoading && failedPlugins.length > 0`, throw error
- Reset `loaded.length = 0` at start of `loadPlugins()`
- Add `await` before `plugin.register(app)`

---

## Step 2 — Fix Core ↔ Plugin Dependency Problem

**Files:** 
- `mcp-server/src/core/tool-registry.js`
- `mcp-server/src/plugins/policy/index.js`

### Problem:
Core imports directly from plugins:
```javascript
import { evaluate } from "../plugins/policy/policy.engine.js";
import { createApproval, updateApprovalStatus, getApproval, listApprovals } from "../plugins/policy/policy.store.js";
import { loadPolicyConfig } from "../plugins/policy/policy.config.js";
```

### Solution:
Create extension hooks in core that plugins register into:

**New file: `mcp-server/src/core/policy-hooks.js`**
```javascript
// Extension points for policy system
let policyEvaluator = null;
let approvalStore = null;

export function registerPolicyHooks({ evaluate, createApproval, updateApprovalStatus, getApproval, listApprovals, loadPolicyConfig }) {
  policyEvaluator = evaluate;
  approvalStore = { createApproval, updateApprovalStatus, getApproval, listApprovals, loadPolicyConfig };
}

export function getPolicyEvaluator() { return policyEvaluator; }
export function getApprovalStore() { return approvalStore; }
```

**Modify `tool-registry.js`:**
- Remove direct imports from plugins/policy
- Import from `policy-hooks.js` instead
- Use `getPolicyEvaluator()` and `getApprovalStore()`

**Modify `plugins/policy/index.js`:**
- In `register()`, call `registerPolicyHooks({ ... })` to register itself

---

## Step 3 — Improve Job Queue System

**Files:**
- `mcp-server/src/core/server.js`
- `mcp-server/src/core/jobs.js` (already exists)

### Current State:
- Job endpoints exist in server.js
- `jobs.js` has Redis + memory implementation
- `registerJobRunner()` exists but no `registerJobHandler()` wrapper

### Implementation:

**Create `mcp-server/src/core/jobs/index.js`:**
Re-export from `../jobs.js` plus add:
```javascript
export function registerJobHandler(type, handler) {
  // Wrapper around registerJobRunner with better error handling
  registerJobRunner(type, handler);
}
```

**Create `mcp-server/src/core/jobs/queue.js`:**
Extract queue management from jobs.js:
- `enqueue()`, `dequeue()`, `getQueueStatus()`

**Create `mcp-server/src/core/jobs/worker.js`:**
Extract worker logic:
- Job execution wrapper
- Error capture
- Progress tracking

**Export from plugins:**
Add to `plugins.js` exports so plugins can use:
```javascript
export { registerJobHandler } from "./jobs/index.js";
```

---

## Step 4 — Improve Plugin Loader Diagnostics

**Files:** `mcp-server/src/core/plugins.js`

### Implementation:

Add startup diagnostics output after loading:
```javascript
// At end of loadPlugins()
console.log("\n[plugins] ═══════════════════════════════════════");
console.log("[plugins] Plugin Load Summary");
console.log("[plugins] ═══════════════════════════════════════");

if (loaded.length > 0) {
  console.log("\n✅ Loaded Plugins:");
  for (const p of loaded) {
    console.log(`   - ${p.name}@${p.version}`);
  }
}

if (failedPlugins.length > 0) {
  console.log("\n❌ Failed Plugins:");
  for (const f of failedPlugins) {
    console.log(`   - ${f.name}: ${f.reason}`);
  }
}

console.log("\n[plugins] ═══════════════════════════════════════\n");
```

---

## Step 5 — Fix OpenAPI Generator

**Files:** `mcp-server/src/core/server.js` (lines 161-230)

### Problem:
Path parameter extraction is incomplete:
```javascript
parameters: [
  ...(ep.path.includes(":") ? [] : []), // Path params extracted from :pattern - NOT IMPLEMENTED
  ...
]
```

### Implementation:

Fix the OpenAPI path parameter extraction:
```javascript
function extractPathParams(path) {
  const params = [];
  const paramRegex = /:(\w+)/g;
  let match;
  while ((match = paramRegex.exec(path)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" }
    });
  }
  return params;
}

// In OpenAPI generation:
const pathParams = extractPathParams(ep.path);
parameters: [
  ...pathParams,
  ...(ep.scope ? [{ name: "Authorization", in: "header", required: true, schema: { type: "string" } }] : []),
]
```

---

## Step 6 — Improve Project Context Middleware

**Files:** `mcp-server/src/core/server.js` (lines 74-111)

### Problem:
Currently enforces strict header requirements for write operations.

### Implementation:

Modify `projectContextMiddleware`:
```javascript
function projectContextMiddleware(req, _res, next) {
  req.projectId = req.headers["x-project-id"]?.trim() || "default-project";
  req.projectEnv = req.headers["x-env"]?.trim() || "default-env";
  next();
}
```

Modify `enforceProjectContextMiddleware` to be optional (only warn in dev mode):
```javascript
function enforceProjectContextMiddleware(req, res, next) {
  if (!requiresProjectContext(req)) return next();
  
  // In development, allow fallback values
  if (process.env.NODE_ENV === "development") {
    if (!req.projectId || req.projectId === "default-project") {
      console.warn("[server] Warning: Using default project context. Set x-project-id header for production.");
    }
    return next();
  }
  
  // Production: enforce headers
  if (!req.projectId || req.projectId === "default-project") {
    return res.status(400).json({
      ok: false,
      error: { code: "missing_project_id", message: "x-project-id header is required" }
    });
  }
  
  next();
}
```

---

## Step 7 — Documentation Sync

**Files:** `mcp-server/README.md` or create `ARCHITECTURE.md`

### Structure:

```markdown
# AI-Hub Architecture

## Core Modules
- **server.js** - Express server, middleware, routes
- **plugins.js** - Dynamic plugin loader
- **tool-registry.js** - MCP tool registration and execution
- **jobs/** - Job queue system (queue.js, worker.js)
- **auth.js** - Authentication and scope management
- **audit.js** - Request auditing and logging

## Plugin System
- Plugins are auto-discovered from `src/plugins/`
- Each plugin exports: `name`, `version`, `register(app)`
- Optional exports: `description`, `capabilities`, `endpoints`, `tools`, `requires`
- Plugins can register job handlers via `registerJobHandler()`

## Job Queue
- In-memory queue with Redis fallback
- Plugins register handlers for job types
- States: queued → running → completed|failed|cancelled

## Workspace & Context
- Project context via `x-project-id` and `x-env` headers
- Fallback to "default-project" and "default-env" in development

## RAG (Future)
- To be implemented by plugins

## Local Sidecar
- Safe local filesystem access

## Brain (Future)
- AI reasoning and orchestration

## Tool Registry
- Central tool registration for MCP protocol
- Policy hooks for approval flow
```

---

## Step 8 — Safety Tests

**Create:** `mcp-server/tests/plugin-loader.test.js`

### Test Cases:

1. **Plugin loads successfully**
   - Mock plugin with valid exports
   - Verify it appears in loaded list

2. **Plugin fails to load**
   - Mock plugin that throws on import
   - Verify failure is tracked

3. **Plugin missing index.js**
   - Empty folder
   - Verify graceful skip

4. **Async plugin registration**
   - Plugin with async `register()`
   - Verify await works correctly

5. **Duplicate load protection**
   - Call `loadPlugins()` twice
   - Verify no duplicates (loaded array cleared)

### Example Test Structure:
```javascript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPlugins, getPlugins } from "../src/core/plugins.js";

describe("Plugin Loader", () => {
  beforeEach(() => {
    // Reset state
  });

  it("should load a valid plugin", async () => {
    // Test implementation
  });

  it("should track plugin failures", async () => {
    // Test implementation
  });
  
  // ... more tests
});
```

---

## Implementation Order

1. **Step 1** (plugins.js) - Foundation changes
2. **Step 5** (OpenAPI fix) - Simple isolated change
3. **Step 6** (Project context) - Simple middleware change
4. **Step 2** (Policy hooks) - Architecture refactor
5. **Step 3** (Job queue) - Create jobs/ directory
6. **Step 4** (Diagnostics) - Add after Step 1
7. **Step 8** (Tests) - Validate all changes
8. **Step 7** (Documentation) - Final documentation

---

## Success Criteria

- [ ] All plugins load with clear diagnostics
- [ ] Failed plugins are listed with reasons
- [ ] STRICT mode option works
- [ ] Core has no imports from plugins/
- [ ] Job queue supports plugin-registered handlers
- [ ] OpenAPI spec includes path parameters
- [ ] Project context has development fallbacks
- [ ] Tests validate plugin loader behavior
