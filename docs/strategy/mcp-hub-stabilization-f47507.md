# Stabilize MCP-Hub: Architecture & Infrastructure Plan

Transform MCP-Hub from an HTTP knowledge service into a stable AI Operating System backend with proper multi-LLM routing, consistent tool contracts, and complete approval workflows.

## Overview

This plan addresses 8 critical areas to stabilize MCP-Hub as an AI automation backbone. The project has evolved from a simple MCP server into an AI OS with LLM routing capabilities, but documentation and infrastructure haven't kept pace.

---

## Step 1: Fix README Architecture Description

**Current Issue:** README states "No LLM calls. No hallucinations." but the repository contains a multi-LLM router plugin.

**Actions:**
- Update README.md opening statement to reflect AI OS positioning
- Add "Architecture Overview" section with 6 layers:
  1. Tool Registry - Central MCP tool registration
  2. Policy & Approval System - Rule-based access control
  3. Multi-LLM Router - Provider routing (OpenAI, Anthropic, Google, Mistral, Ollama)
  4. Integration Plugins - GitHub, Notion, n8n, etc.
  5. Project Context Layer - Multi-project configuration
  6. Job System - Async task execution

**Files:** `/Users/beyazskorsky/Documents/mcp/README.md`

---

## Step 2: Ensure Tool Contract Consistency

**Current Issue:** Some plugins may still use deprecated "parameters" instead of "inputSchema".

**Actions:**
- Audit all plugins for "parameters" vs "inputSchema" usage
- Update tool-registry.js validateTool() to throw errors (not just warnings) for invalid schemas
- Add startup validation that checks all registered tools
- Required tags: read_only, write, destructive, needs_approval

**Files:**
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/core/tool-registry.js`
- All plugin index.js files

---

## Step 3: Implement Approval Endpoint

**Current Issue:** Policy system returns `status: "approval_required"` but no real approval endpoint exists.

**Actions:**
- Implement `POST /approve` endpoint
  - Request: `{ approval_id: string }`
  - Retrieve pending tool call from policy store
  - Execute the tool
  - Return execution result
  - Store approval in audit log
- Implement `GET /approvals/pending` endpoint
  - List all pending approvals
  - Include tool name, explanation, timestamp

**Files:**
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/policy/` (add endpoints)
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/core/server.js` (register routes)

---

## Step 4: Ensure Plugin Manifest Sync

**Current Issue:** Plugin table in README may be missing new plugins.

**Actions:**
- Verify all plugins export: `register(app)`, `tools[]`, manifest metadata
- Update README plugin table to include:
  - llm-router
  - project-orchestrator
  - repo-intelligence
  - local-sidecar
  - policy
- Check plugin directories exist and are properly structured

**Files:** `/Users/beyazskorsky/Documents/mcp/README.md`

---

## Step 5: Add AI_OS_BACKLOG.md

**Current Issue:** No roadmap document exists for the AI OS vision.

**Actions:**
- Create `/Users/beyazskorsky/Documents/mcp/AI_OS_BACKLOG.md`
- Structure with priority tiers:
  - **P0 Core Infrastructure** - Tool registry, policy, LLM router, job system
  - **P1 Integrations** - GitHub, Notion, n8n, databases, file storage
  - **P2 Computer Interaction** - Local sidecar, file watcher, shell, notifications
  - **P3 Observability** - Metrics, tracing, health checks, audit logging
- Include plugin category explanations

---

## Step 6: Improve LLM Router Stability

**Current Issue:** Need to verify all providers work and fallback is implemented.

**Actions:**
- Verify all 5 providers: OpenAI, Anthropic, Gemini, Mistral, Ollama
- Ensure fallback providers are configured in ROUTING_RULES
- Add error handling for provider failures
- Verify endpoints exist:
  - `POST /llm/route` - Route task to optimal provider
  - `POST /llm/estimate-cost` - Estimate token cost
- Ensure router usable via both REST and MCP tools

**Files:** `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/llm-router/index.js`

---

## Step 7: Add Repo Summary Flow

**Current Issue:** repo-intelligence plugin exists but needs a unified analysis service.

**Actions:**
- Create `repo_analyze` service in repo-intelligence plugin
- Flow:
  1. Fetch commits via `repo_recent_commits`
  2. Fetch issues via `repo_open_issues`
  3. Get structure via `repo_project_structure`
  4. Use llm_router to summarize
  5. Generate roadmap recommendations
- Integrate with project-orchestrator for roadmap creation

**Files:** `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/repo-intelligence/`

---

## Step 8: Add System Prompt Registry

**Current Issue:** No centralized prompt management for the AI agent.

**Actions:**
- Create new plugin: `prompt-registry`
- Directory: `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/prompt-registry/`
- Endpoints:
  - `GET /prompts` - List all prompts
  - `GET /prompts/{id}` - Get specific prompt
  - `POST /prompts` - Create/update prompt with versioning
- Features:
  - Version control for prompts
  - Tag-based categorization
  - Default prompt selection

---

## Success Criteria

After these changes, MCP-Hub should support workflows like:

1. "Create an n8n workflow that scrapes stock prices"
   → n8n plugin + LLM router for workflow generation

2. "Analyze percepta repo and create roadmap"
   → repo_analyze service + project-orchestrator

3. "Upload report to Google Drive"
   → local-sidecar drive_upload (with approval)

4. "Turn this idea into a project and start coding"
   → project-orchestrator full workflow

---

## Implementation Order

1. Step 1 (README) - Foundation documentation
2. Step 5 (AI_OS_BACKLOG) - Strategic context
3. Step 2 (Tool Contract) - Core validation
4. Step 3 (Approval Endpoint) - Critical workflow
5. Step 4 (Plugin Manifest) - Documentation sync
6. Step 6 (LLM Router) - Provider stability
7. Step 7 (Repo Analysis) - Feature completion
8. Step 8 (Prompt Registry) - New plugin

---

## Files to Create/Modify

**Create:**
- `/Users/beyazskorsky/Documents/mcp/AI_OS_BACKLOG.md`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/prompt-registry/index.js`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/prompt-registry/README.md`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/repo-intelligence/repo.analyze.js`

**Modify:**
- `/Users/beyazskorsky/Documents/mcp/README.md`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/core/tool-registry.js`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/policy/index.js` (add endpoints)
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/plugins/llm-router/index.js`
- `/Users/beyazskorsky/Documents/mcp/mcp-server/src/core/server.js` (register new routes)

**Verify:**
- All plugin index.js files for manifest consistency
- All tools for inputSchema compliance
