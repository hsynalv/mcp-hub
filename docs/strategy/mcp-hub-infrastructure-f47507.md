# MCP-Hub Infrastructure Enhancement Plan

**Goal**: Implement observability dashboard, plugin marketplace, and Redis-backed state persistence for production-grade AI OS operations.

## Overview

This plan addresses three critical infrastructure gaps in MCP-Hub:
1. **Observability**: Web-based metrics dashboard for monitoring system health, job progress, and plugin performance
2. **Plugin Marketplace**: Community plugin discovery and installation system
3. **State Persistence**: Redis-backed job queue for durability across restarts

---

## 1. Observability Dashboard

### Current State
- Prometheus-compatible metrics at `/observability/metrics`
- Health endpoint at `/observability/health`
- Audit logs at `/audit/logs`
- **Missing**: Visual dashboard for humans

### Implementation Plan

#### Phase 1: Static Dashboard UI (2-3 hours)
Create `src/plugins/observability/dashboard/` with:

**Files to Create:**
- `dashboard/index.html` - Single-page dashboard with auto-refresh
- `dashboard/app.js` - React/Vue-lite or vanilla JS dashboard logic
- `dashboard/styles.css` - Clean dark-themed monitoring UI

**Features:**
- Real-time metrics cards (requests/min, error rate, active jobs)
- Plugin health status grid (green/yellow/red indicators)
- Recent errors table with filtering
- Job queue visualization (running/completed/failed counts)
- Memory usage graph (simple canvas/SVG sparkline)

**API Endpoint:**
- `GET /observability/dashboard` - Serves the static HTML
- `GET /observability/dashboard/api/metrics` - Aggregated JSON for dashboard consumption

**Dependencies:** No new npm packages - pure HTML/JS/CSS served via Express static middleware

#### Phase 2: WebSocket Real-time Updates (Optional - 1-2 hours)
- Add Socket.io or native WebSocket for live job progress updates
- Stream job logs in real-time to dashboard

### Key Design Decisions
- **Keep it simple**: No build step, vanilla JS, single HTML file
- **Auto-refresh**: 5-second polling via `fetch()` to existing endpoints
- **Dark theme**: Matches developer tools aesthetic

---

## 2. Plugin Marketplace

### Current State
- Plugins loaded from `src/plugins/<name>/index.js` at startup
- Manual plugin installation only
- **Missing**: Discovery, installation, and management interface

### Implementation Plan

#### Phase 1: Registry & Discovery (3-4 hours)

**Architecture:**
```
Plugin Sources:
├── Built-in (src/plugins/*) - Current system
├── Local (./marketplace/local/*) - Manually installed
└── Remote (npm packages) - Community plugins
```

**Files to Create:**
- `src/plugins/marketplace/index.js` - New plugin for marketplace management
- `src/core/marketplace.js` - Core marketplace logic

**Plugin Manifest Format** (for community plugins):
```json
{
  "name": "mcp-hub-plugin-<name>",
  "version": "1.0.0",
  "description": "...",
  "author": "...",
  "mcpHub": {
    "pluginName": "custom-name",
    "capabilities": ["read", "write"],
    "entry": "dist/index.js",
    "requires": ["API_KEY"]
  }
}
```

**New Endpoints:**
- `GET /marketplace/search?q=keyword` - Search npm registry for MCP-Hub plugins
- `GET /marketplace/installed` - List locally installed plugins
- `POST /marketplace/install` - Install plugin from npm (`npm install <package>`)
- `POST /marketplace/uninstall` - Remove plugin
- `POST /marketplace/enable` - Enable/disable without removing

**Storage:**
- Installed plugins in `./marketplace/installed/` directory
- Metadata cache in `./cache/marketplace.json`

#### Phase 2: Safe Plugin Execution (2 hours)
- Sandboxed plugin loading (try-catch with timeout)
- Plugin signature validation (optional, for verified authors)
- Dependency conflict detection before install

### Key Design Decisions
- **npm-based**: Leverage existing package ecosystem
- **Lazy loading**: New plugins require server restart (for now)
- **Security**: Plugins run with same privileges - review before install

---

## 3. State Persistence (Redis Job Queue)

### Current State
- Job queue in memory (`Map` in `src/core/jobs.js`)
- Prunes completed jobs after 1 hour
- **Problem**: Jobs lost on server restart

### Implementation Plan

#### Phase 1: Redis Adapter (3-4 hours)

**Files to Modify:**
- `src/core/jobs.js` - Add Redis persistence layer
- `src/core/config.js` - Add Redis connection settings

**Files to Create:**
- `src/core/jobs.redis.js` - Redis-backed job store implementation

**Configuration Addition:**
```javascript
// config.js
redis: {
  enabled: process.env.REDIS_URL !== undefined,
  url: process.env.REDIS_URL || "redis://localhost:6379",
  keyPrefix: process.env.REDIS_PREFIX || "mcp-hub:",
}
```

**Redis Schema:**
```
mcp-hub:jobs:<id>          -> Job data (HASH)
mcp-hub:jobs:queue         -> Pending job IDs (LIST)
mcp-hub:jobs:running       -> Running job IDs (SET)
mcp-hub:jobs:completed     -> Completed job IDs (Sorted Set by timestamp)
mcp-hub:jobs:failed        -> Failed job IDs (Sorted Set by timestamp)
```

**Implementation Strategy:**
1. Create `RedisJobStore` class with same interface as current `Map` store
2. Job lifecycle:
   - `submitJob()`: Add to Redis queue, publish notification
   - `runJob()`: Move from queue to running set
   - Complete/fail: Move to appropriate sorted set with TTL
3. Worker coordination: Use Redis pub/sub for multi-instance setups
4. Graceful degradation: If Redis fails, fall back to memory with warning

**Key Methods:**
```javascript
class RedisJobStore {
  async get(id) { }
  async set(id, job) { }
  async delete(id) { }
  async list({ state, limit }) { }
  async enqueue(jobId) { }
  async dequeue() { } // For worker to claim job
  async publishProgress(id, progress) { }
}
```

#### Phase 2: Recovery & Resilience (2 hours)
- On startup: Recover running jobs from Redis (mark as failed or re-queue)
- Job timeouts: Auto-fail jobs stuck in "running" for >30 minutes
- Heartbeat mechanism: Workers report alive status

### Key Design Decisions
- **ioredis**: Already in dependencies, supports clusters and Sentinel
- **Graceful fallback**: If Redis unavailable, use in-memory with warning
- **TTL**: Set 24-hour TTL on completed/failed job data in Redis
- **Atomic operations**: Use Redis transactions for state transitions

---

## Implementation Order

1. **Redis Job Queue** (Priority: High)
   - Most critical for production stability
   - Prevents job loss on restart

2. **Observability Dashboard** (Priority: Medium)
   - Immediate visibility benefit
   - No dependencies on other changes

3. **Plugin Marketplace** (Priority: Low)
   - Nice-to-have for community growth
   - Can be added incrementally

---

## Files to Create/Modify Summary

### New Files
```
src/
├── plugins/
│   ├── observability/dashboard/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   └── marketplace/
│       ├── index.js
│       ├── npm.client.js
│       └── registry.js
├── core/
│   ├── jobs.redis.js
│   └── marketplace.js
```

### Modified Files
```
src/
├── core/
│   ├── jobs.js (add Redis adapter integration)
│   ├── config.js (add Redis settings)
│   └── plugins.js (add marketplace plugin loading)
└── plugins/
    └── observability/index.js (add dashboard route)
```

---

## Success Metrics

- **Observability**: Dashboard loads in <2s, auto-refreshes every 5s, shows all key metrics
- **Marketplace**: Can search, install, and uninstall plugins via API
- **Persistence**: Jobs survive server restart, <100ms latency on Redis operations

---

## Notes for Implementation

- **Auth**: Skip for now since single-user deployment
- **Testing**: Each component needs unit tests (vitest)
- **Docs**: Update README with new features and env vars
