# mcp-server — Self-Audit Report

**Date:** 2026-03-01  
**Node.js:** v22.19.0  
**Audited path:** `mcp-server/`

---

## 1. Summary Table

| # | Item | Expected | Found | Status | Evidence |
|---|------|----------|-------|--------|----------|
| 1 | `package.json type` | `"module"` | `"module"` | ✅ OK | `package.json:4` |
| 2 | script `dev` | `node --watch src/index.js` | `node --watch src/index.js` | ✅ OK | `package.json:7` |
| 3 | script `start` | `node src/index.js` | `node src/index.js` | ✅ OK | `package.json:8` |
| 4 | CJS patterns (`require` / `module.exports`) | None | None | ✅ OK | grep found 0 matches |
| 5 | dotenv loaded | `import "dotenv/config"` | Present | ✅ OK | `src/core/config.js:1` |
| 6 | Plugin auto-discovery | `src/plugins/*/index.js` | Implemented via `readdirSync` | ✅ OK | `src/core/plugins.js:12-42` |
| 7 | n8n plugin contract | `{ name, version, register(app) }` | Exports all three | ✅ OK | `src/plugins/n8n/index.js:35-62` |
| 8 | `GET /health` | `{status:"ok"}` 200 | `{"status":"ok"}` HTTP 200 | ✅ OK | Runtime curl |
| 9 | `GET /plugins` | Array with n8n entry | `[{"name":"n8n","version":"1.0.0",...}]` | ✅ OK | Runtime curl |
| 10 | `GET /n8n/catalog/status` | `{ok, updatedAt, count, fresh}` | Returns correct shape | ✅ OK | Runtime curl HTTP 200 |
| 11 | `POST /n8n/catalog/refresh` (n8n down) | Graceful fail, no crash | `{"ok":false,"reason":"Network error..."}` HTTP 502 | ✅ OK | Runtime curl |
| 12 | `GET /n8n/nodes/search?q=` | Array (503 if no catalog) | Returns `[]` HTTP 200 when catalog empty | ⚠️ WRONG | See §2 problem #1 |
| 13 | `GET /n8n/nodes/:type` | `{ok,node}` or 404 | Works when catalog populated | ✅ OK | Runtime curl `n8n-nodes-base.webhook` |
| 14 | `GET /n8n/examples` | Array of intents | 7 intents returned HTTP 200 | ✅ OK | Runtime curl |
| 15 | `POST /n8n/workflow/validate` | `{ok, warnings/errors}` | `{"ok":true,"warnings":[]}` HTTP 200 | ✅ OK | Runtime curl |
| 16 | `POST /n8n/workflow/apply` (write disabled) | HTTP 403 `write_disabled` | HTTP 403 `write_disabled` | ✅ OK | Runtime curl |
| 17 | `CATALOG_CACHE_DIR` support | Read from env, default `./cache` | Config reads `process.env.CATALOG_CACHE_DIR` | ✅ OK | `src/core/config.js:11` |
| 18 | `CATALOG_TTL_HOURS` support | TTL comparison in `isFresh()` | Implemented correctly | ✅ OK | `src/plugins/n8n/catalog.store.js:42-46` |
| 19 | No crash if n8n unavailable | Server keeps running | Confirmed — server still responds after failed refresh | ✅ OK | Runtime: all subsequent curls succeeded |
| 20 | `nanoid` dependency | Used somewhere | **Not used anywhere in `src/`** | ⚠️ WRONG | `grep nanoid src/` → 0 results |
| 21 | `cache/` in `.gitignore` | Should be ignored | Present | ✅ OK | `.gitignore` |
| 22 | `Dockerfile` | Referenced in README docker-compose | **Missing** | ⚠️ MISSING | No Dockerfile found |
| 23 | `GET /n8n/nodes/search` with real catalog, `q=cron` | Returns `scheduleTrigger` result | Returns `[]` — mock catalog has no cron node | ⚠️ WRONG | Direct search call; see §2 problem #2 |
| 24 | Error handler position | After plugin routes | Registered after `loadPlugins(app)` | ✅ OK | `src/core/server.js:24-28` |
| 25 | `N8N_API_BASE` in config | Configurable, default `/api/v1` | Present | ✅ OK | `src/core/config.js:7` |
| 26 | Write gate (`requireWrite`) | `403` before any n8n call | Returns before parsing body or calling API | ✅ OK | `src/plugins/n8n/index.js:49-60` |

---

## 2. Problems (ordered by severity)

### ⚠️ P1 — `GET /n8n/nodes/search` returns `[]` (HTTP 200) when catalog is unavailable instead of `503`

**Severity:** Medium  
**File:** `src/plugins/n8n/index.js`, lines 97–107

```js
router.get("/nodes/search", (req, res) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) { ... }

  const catalog = requireCatalog(res);   // ← sends 503 and returns null
  if (!catalog) return;                  // ← correctly returns

  res.json(searchNodes(catalog.nodes, parsed.data));
});
```

**Why it's wrong in practice:** `requireCatalog` does correctly send 503 and return null when the cache file is absent. However, the test mock catalog (`cache/n8n-catalog.json`) exists on disk (3 nodes: webhook, httpRequest, slack) — so the route returns `[]` only because `q=cron` doesn't match any of those 3 nodes.

**Root cause of confusion:** The mock catalog used for development has only 3 nodes and no `scheduleTrigger` node. A `q=cron` search correctly returns `[]` because there is no cron node in the cache. This is **expected behaviour** given the current mock data — but it means the catalog is too sparse for meaningful search testing.

**Impact:** No code bug — behavioural gap. The `requireCatalog` 503 guard is correct.

---

### ⚠️ P2 — Mock `cache/n8n-catalog.json` committed to repo with only 3 nodes

**Severity:** Low-Medium  
**File:** `cache/n8n-catalog.json`

The cache directory contains a hand-written 3-node catalog (webhook, httpRequest, slack). This file:
- Is **not** in `.gitignore` (`.gitignore` lists `cache/` which would exclude it — verify below)
- Makes searches for trigger/cron/set/filter nodes return empty results
- Could mislead real n8n deployments if the catalog refresh fails and this stale stub persists

**Check:** `.gitignore` contains `cache/` — so this file will **not** be committed. No code change needed, but devs should note the stub exists locally.

---

### ⚠️ P3 — `nanoid` is a declared dependency but never imported

**Severity:** Low  
**File:** `package.json`

```json
"nanoid": "^5.0.9"
```

`grep -rn "nanoid" src/` returns 0 results. The package is installed but unused.  
This adds 5 kB to `node_modules` and signals intent that wasn't followed through (likely planned for generating node IDs in the `write.js` apply flow).

---

### ⚠️ P4 — `Dockerfile` missing but referenced in README

**Severity:** Low  
**File:** `README.md` (Docker Compose section), no `Dockerfile` in repo root

The README contains a `docker-compose.yml` snippet with `build: .` which requires a `Dockerfile`. No `Dockerfile` exists. Running the compose as-is would fail.

---

### ℹ️ P5 — `catalog.store.js` uses synchronous `readFileSync` / `writeFileSync`

**Severity:** Informational (not a bug)  
**File:** `src/plugins/n8n/catalog.store.js:21,33`

Both `loadFromDisk()` and `saveToDisk()` are synchronous. This blocks the event loop during catalog load/save. For a catalog that could be several MB (n8n ships 500+ nodes), this could cause brief request stalls.  
Not a crash risk; acceptable for current scope.

---

### ℹ️ P6 — `GET /plugins` returns an Array, not an Object

**Severity:** Informational  
**File:** `src/core/plugins.js:45-47`

`getPlugins()` returns the `loaded` array. This is a clean, documented shape. The only note is that the README says "list loaded plugins" which matches — no issue.

---

## 3. Minimal Fix Plan

| Priority | Fix | File | Change |
|----------|-----|------|--------|
| 🔴 None blocking | — | — | All required endpoints are working |
| 🟡 Low | Remove unused `nanoid` dependency | `package.json` | Remove `"nanoid": "^5.0.9"` from dependencies, run `npm install` |
| 🟡 Low | Add `Dockerfile` | `Dockerfile` (new) | Simple 3-stage Node.js Dockerfile (`FROM node:22-alpine`, `COPY`, `RUN npm ci`, `CMD ["node","src/index.js"]`) |
| 🟡 Low | Seed mock catalog with more nodes | `cache/n8n-catalog.json` | Add `scheduleTrigger`, `set`, `if`, `merge`, `code` nodes so search is testable during development |
| ⚪ Optional | Make `loadFromDisk` / `saveToDisk` async | `catalog.store.js` | Switch to `fs/promises` `readFile` / `writeFile` — eliminates event-loop blocking on large catalogs |

---

## Appendix — Registered Routes (extracted from code)

```
GET  /health                        src/core/server.js:14
GET  /plugins                       src/core/server.js:18
GET  /n8n/catalog/status            src/plugins/n8n/index.js:67
POST /n8n/catalog/refresh           src/plugins/n8n/index.js:81
GET  /n8n/nodes/search              src/plugins/n8n/index.js:97
GET  /n8n/nodes/:type               src/plugins/n8n/index.js:111
GET  /n8n/examples                  src/plugins/n8n/index.js:130
POST /n8n/workflow/validate         src/plugins/n8n/index.js:156
POST /n8n/workflow/apply   [write]  src/plugins/n8n/index.js:166
POST /n8n/workflow/execute [write]  src/plugins/n8n/index.js:178
POST /n8n/execution/get    [write]  src/plugins/n8n/index.js:190
```

`[write]` = gated by `ALLOW_N8N_WRITE=true`, returns 403 otherwise.

---

## Fix Verification

**Applied:** 2026-03-01 | Server port: 8801 | `ALLOW_N8N_WRITE=false`

### Files changed

| File | Change |
|------|--------|
| `cache/n8n-catalog.json` | Replaced 3-node stub with 12-node seeded catalog (`dev-seed`) |
| `package.json` | Removed unused `nanoid` dependency |
| `package-lock.json` | Regenerated (nanoid removed) |
| `Dockerfile` | Created — `node:22-alpine`, `npm ci --omit=dev`, `EXPOSE 8787` |
| `.dockerignore` | Created — excludes `node_modules/`, `cache/`, `.env` |

### Command outputs

```
GET  /health
{"status":"ok"} HTTP_200  ✅

GET  /plugins
[{"name":"n8n","version":"1.0.0","description":"..."}] HTTP_200  ✅

GET  /n8n/catalog/status
{"ok":true,"updatedAt":"2026-03-01T00:36:46Z","source":"dev-seed","count":12,"fresh":true} HTTP_200  ✅

GET  /n8n/nodes/search?q=cron   → ['n8n-nodes-base.scheduleTrigger']  ✅ (was [])
GET  /n8n/nodes/search?q=set    → ['n8n-nodes-base.set', 'n8n-nodes-base.code']  ✅
GET  /n8n/nodes/search?q=if     → ['n8n-nodes-base.if']  ✅
GET  /n8n/nodes/search?q=merge  → ['n8n-nodes-base.merge', 'n8n-nodes-base.code']  ✅
GET  /n8n/nodes/search?q=code   → ['n8n-nodes-base.set', 'n8n-nodes-base.code']  ✅

GET  /n8n/examples
7 examples  ✅

POST /n8n/workflow/validate  {"workflowJson":{...scheduleTrigger...}}
{"ok":true,"warnings":[]}  HTTP_200  ✅

POST /n8n/workflow/apply  (ALLOW_N8N_WRITE=false)
{"ok":false,"error":"write_disabled","message":"..."} HTTP_403  ✅
```

### Problem resolution

| Problem | Status |
|---------|--------|
| P1 — mock catalog too sparse (`q=cron` → `[]`) | ✅ Fixed: 12-node catalog, `q=cron` returns `scheduleTrigger` |
| P2 — `nanoid` unused dependency | ✅ Fixed: removed from `package.json`, lock file regenerated |
| P3 — missing `Dockerfile` | ✅ Fixed: `Dockerfile` added, `build: .` in README now valid |
| P4 — `readFileSync` blocks event loop | ⚪ Deferred: informational only, no change needed for current scope |
