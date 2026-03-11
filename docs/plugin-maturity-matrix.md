# Plugin Maturity Matrix

Comprehensive overview of all MCP Hub plugins and their production readiness.

_Last updated: 2026-03-11_

---

## Phase 1 — Core AI Platform (11/11 complete ✅)

| Plugin | Description | Status | Auth | MCP Tools | Risk |
|--------|-------------|--------|------|-----------|------|
| llm-router | Multi-provider LLM routing (OpenAI, Anthropic, Google, Mistral, Ollama, vLLM) | 🟢 stable | ✅ | ✅ | LOW |
| notion | Notion pages, databases, templates, pagination | 🟢 stable | ✅ | ✅ | LOW |
| github | GitHub repos, PRs, branches, issues, comments | 🟢 stable | ✅ | ✅ | MEDIUM |
| database | SQL + MongoDB with safety controls, query timeout | 🟢 stable | ✅ | ✅ | HIGH |
| shell | Shell execution with allowlist and dangerous pattern blocking | 🟢 stable | ✅ | ✅ | HIGH |
| rag | Document indexing + semantic search (OpenAI embeddings) | 🟢 stable | ✅ | ✅ | LOW |
| brain | Personal AI memory: episodic, projects, habits, FS awareness | 🟢 stable | ✅ | ✅ (16) | MEDIUM |
| github-pattern-analyzer | Coding pattern learning from repos, LLM analysis, Redis cache | 🟢 stable | ✅ | ✅ | LOW |
| n8n | n8n workflow create/update/execute, catalog, deployment | 🟢 stable | ✅ | ✅ (9) | MEDIUM |
| repo-intelligence | Git commit/structure analysis, AI summaries, path safety | 🟢 stable | ✅ | ✅ | LOW |
| project-orchestrator | AI project planning, Notion+GitHub integration, Redis state | 🟢 stable | ✅ | ✅ | HIGH |

---

## Phase 2 — Infrastructure & Tooling (9/9 complete ✅)

| Plugin | Description | Status | Auth | MCP Tools | Risk |
|--------|-------------|--------|------|-----------|------|
| http | SSRF-protected outbound HTTP, allowlist, rate limit, cache | 🟢 stable | ✅ | ✅ (3) | HIGH |
| secrets | `{{secret:NAME}}` reference system — values never exposed | 🟢 stable | ✅ | ✅ (4) | HIGH |
| workspace | Safe file CRUD (WORKSPACE_ROOT isolation, path traversal blocked) | 🟢 stable | ✅ | ✅ (8) | MEDIUM |
| git | Full git ops: status/diff/add/commit/push/pull/stash/branch | 🟢 stable | ✅ | ✅ (11) | HIGH |
| prompt-registry | Centralized prompt template management with versioning | 🟡 beta | ⚠️ partial | ❌ | LOW |
| observability | Aggregate health, Prometheus metrics, error log surfacing, web dashboard | 🟢 stable | ✅ | ✅ (3) | LOW |
| tech-detector | Detect 50+ languages/frameworks/infra from project files, recommend & compare | 🟢 stable | ✅ | ✅ (3) | LOW |
| n8n-workflows | n8n workflow CRUD, search, activate/deactivate, disk cache | 🟢 stable | ✅ | ✅ (5) | HIGH |
| code-review | Regex security scan + quality checks + LLM PR review | 🟢 stable | ✅ | ✅ (4) | MEDIUM |

---

## Other Plugins (outside current roadmap)

| Plugin | Description | Status |
|--------|-------------|--------|
| policy | Policy engine and approval guardrails | 🟢 stable |
| file-storage | S3/GDrive/local file operations | 🟡 beta |
| docker | Container lifecycle management | 🔴 experimental |
| email | SMTP/IMAP email send/receive | 🔴 experimental |
| slack | Slack messaging and bots | 🔴 experimental |
| image-gen | AI image generation | 🔴 experimental |
| video-gen | AI video generation | 🔴 experimental |
| openapi | OpenAPI spec analysis | 🔴 experimental |
| n8n-credentials | n8n credential store management | 🔴 experimental |
| marketplace | Plugin marketplace | 🔴 experimental |
| notifications | Multi-channel notifications | 🔴 experimental |
| local-sidecar | Local service bridge | 🔴 experimental |
| projects | Project management | 🔴 experimental |
| file-watcher | File change monitoring | 🔴 experimental |

---

## Status Legend

- 🟢 **stable** — Production ready, auth enforced, MCP tools exposed
- 🟡 **beta** — Functional but has known issues in queue
- 🔴 **experimental** — Early development, use with caution

## Risk Levels

- **LOW** — Read-only or sandboxed operations
- **MEDIUM** — Write operations with validation
- **HIGH** — System-level writes, external API calls, destructive ops

## Standardization Checklist

Every stable plugin passes:

```
✅ createMetadata() — PluginStatus, RiskLevel, endpoints[]
✅ createPluginErrorHandler(pluginName)
✅ auditLog() — all write operations (REST + MCP)
✅ requireScope("read"|"write") — all REST routes
✅ ToolTags correctly assigned on each MCP tool
✅ inputSchema (not parameters) on MCP tools
✅ register(app) actually mounts routes
✅ No self-HTTP calls — uses callTool() or direct imports
✅ GET /<plugin>/health endpoint
✅ At least 3 MCP tools
```
