# mcp-hub

> A plugin-based HTTP knowledge service for AI agents — universal tool and service bridge for Cursor, Claude Desktop, n8n and custom LLM applications.

**mcp-hub** (also referred to as AI-Hub) is an AI Operating System backend that bridges AI agents with real-world tools and services. It provides a multi-LLM routing layer, policy-based approval system, and 20+ integrations for building autonomous AI workflows.

From simple API calls to complex multi-step automations, mcp-hub serves as the execution backbone for AI agents running in Cursor, Claude Desktop, n8n, or custom LLM applications.

---

## What it does

| Capability | Description |
|------------|-------------|
| **Universal API Bridge** | Connect any AI agent to 13+ services via REST |
| **GitHub Integration** | Repository analysis, file tree, commits, issues |
| **Notion Management** | Pages, databases, projects and tasks |
| **HTTP Control** | Safe, rate-limited HTTP requests with caching |
| **Database Access** | MSSQL, PostgreSQL, MongoDB connections |
| **File Storage** | S3, Google Drive, local file operations |
| **OpenAPI Support** | Load and analyze API specifications |
| **n8n Integration** | Optional: Node catalog, workflow validation (disable with ENABLE_N8N_PLUGIN=false) |
| **Secret Management** | Secure credential reference system |
| **Policy Engine** | Rule-based approval system |
| **Observability** | Health checks, metrics, error tracking |

---

## Architecture Overview

AI-Hub operates as a multi-layer AI Operating System backend:

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent (Cursor/Claude/n8n)              │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP/REST
┌──────────────────────▼──────────────────────────────────────┐
│  1. TOOL REGISTRY                                           │
│     - Central MCP tool registration                         │
│     - Schema validation & tagging                             │
│     - Policy enforcement hooks                              │
├───────────────────────────────────────────────────────────────┤
│  2. POLICY & APPROVAL SYSTEM                                │
│     - Rule-based access control                             │
│     - Human-in-the-loop approvals                           │
│     - Audit logging                                         │
├───────────────────────────────────────────────────────────────┤
│  3. MULTI-LLM ROUTER                                        │
│     - Provider routing (OpenAI, Anthropic, Google, Mistral) │
│     - Task-based model selection                            │
│     - Fallback & resilience                                 │
├───────────────────────────────────────────────────────────────┤
│  4. INTEGRATION PLUGINS                                     │
│     - GitHub, Notion, n8n, Databases, File Storage          │
│     - REST endpoints + MCP tools                            │
├───────────────────────────────────────────────────────────────┤
│  5. PROJECT CONTEXT LAYER                                   │
│     - Multi-project configuration                           │
│     - Workspace management                                  │
│     - Repository intelligence                               │
├───────────────────────────────────────────────────────────────┤
│  6. JOB SYSTEM                                              │
│     - Async task execution                                  │
│     - Queue management                                      │
│     - Progress tracking                                     │
└───────────────────────────────────────────────────────────────┘
```

### Core Architecture

The `mcp-server/src/core/` directory contains the foundational modules:

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `server.js` | Express server, middleware chain, route registration | `createServer()` |
| `plugins.js` | Dynamic plugin discovery and loading | `loadPlugins(app)`, `getPlugins()` |
| `tool-registry.js` | MCP tool registration and execution | `registerTool()`, `callTool()` |
| `policy-hooks.js` | Extension points for policy system | `registerPolicyHooks()`, `getPolicyEvaluator()` |
| `jobs.js` | Job queue with Redis/memory storage | `submitJob()`, `registerJobRunner()` |
| `jobs/` | Job system modules (queue, worker) | `registerJobHandler()` alias |
| `auth.js` | API key authentication | `requireScope()` |
| `audit.js` | Request auditing | `auditMiddleware` |
| `config.js` | Environment configuration | `config` object |

### Plugin System

Plugins are auto-discovered from `src/plugins/`:

```javascript
// Example plugin: src/plugins/my-plugin/index.js
export const name = "my-plugin";
export const version = "1.0.0";
export const description = "Does something useful";

export const tools = [
  {
    name: "my_tool",
    description: "A useful tool",
    inputSchema: { type: "object", properties: { ... } },
    handler: async (args, context) => { ... },
    tags: ["read_only"]
  }
];

export async function register(app) {
  // Register routes
  app.get("/my-plugin/status", (req, res) => { ... });
}
```

**Plugin loading features:**
- Automatic discovery from `src/plugins/*`
- Async `register(app)` support
- Error tracking for failed plugins
- STRICT mode: `PLUGIN_STRICT_MODE=true` fails startup on any plugin error
- Optional manifest: `description`, `capabilities`, `endpoints`, `requires`, `examples`

### Job Queue System

Plugins can register job handlers for background processing:

```javascript
import { registerJobHandler } from './core/jobs/index.js';

registerJobHandler("rag.index", async (job, updateProgress, log) => {
  await log("Starting indexing...");
  await updateProgress(25);
  
  // Do work...
  const result = await indexDocuments(job.payload);
  
  await updateProgress(100);
  await log("Indexing complete");
  return result;
});
```

Submit jobs via HTTP API:
```bash
POST /jobs
{ "type": "rag.index", "payload": { "docs": [...] } }
```

**Job states:** `queued` → `running` → `completed` | `failed` | `cancelled`

### Policy System Integration

Core provides extension hooks for the policy plugin (no direct imports):

```
┌─────────────┐      imports      ┌─────────────┐
│   core/     │ ─────────────────►│ policy-hooks│
│             │   (extension API) │   (core)    │
└─────────────┘                   └──────┬──────┘
       ▲                                 │
       │    registerPolicyHooks()       │
       └─────────────────────────────────┘
                    │
            ┌───────┴────────┐
            │ plugins/policy │ (registers itself)
            └────────────────┘
```

This architecture prevents circular dependencies and allows graceful degradation if the policy plugin is disabled.

### Project Context

All write operations include project context via headers:
- `x-project-id` - Project identifier (default: "default-project")
- `x-env` - Environment (default: "default-env")

Headers are automatically applied as defaults for local development.

---

## Example Workflows

AI-Hub supports complex multi-step workflows for AI agents:

### Create an n8n Workflow
```
User: "Create an n8n workflow that scrapes stock prices daily"

Flow:
1. llm_route (coding) → Generate workflow JSON
2. n8n_validate → Validate structure
3. n8n_apply → Import to n8n
4. Return workflow ID and activation URL
```

### Analyze Repository & Generate Roadmap
```
User: "Analyze percepta repository and create roadmap"

Flow:
1. repo_analyze → Fetch commits, issues, structure
2. llm_route (analysis) → Generate summary and roadmap
3. notion_create_page → Save roadmap to Notion
```

### Upload Report to Storage
```
User: "Upload this report to Google Drive"

Flow:
1. local-sidecar fs_read → Read report file
2. local-sidecar drive_upload → Upload to Drive (with approval)
3. Return file URL and metadata
```

### Turn Idea into Project
```
User: "Turn this idea into a project and start coding"

Flow:
1. llm_route (complex_reasoning) → Plan architecture
2. project_create_repo → Create GitHub repository
3. project_generate_structure → Generate initial files
4. project_generate_code → Implement core features
5. project_open_pr → Create initial PR
```

---

## Plugins

| Plugin | Status | Endpoints | Description |
|--------|--------|-----------|-------------|
| `github` | ✅ | `/github/*` | Repository analysis, file tree, commits, issues |
| `notion` | ✅ | `/notion/*` | Pages, databases, projects and tasks |
| `llm-router` | ✅ | `/llm/*` | Multi-LLM routing (OpenAI, Anthropic, Google, Mistral, Ollama) |
| `policy` | ✅ | `/policy/*` | Rule-based approval system with hooks |
| `workspace` | ✅ | `/workspace/*` | File operations within configured workspace root |
| `local-sidecar` | ✅ | `/local/*` | Safe local filesystem access with whitelist |
| `shell` | ✅ | `/shell/*` | Shell command execution with safety controls |
| `docker` | ✅ | `/docker/*` | Docker container and image management |
| `notifications` | ✅ | `/notifications/*` | System notifications (macOS/Linux/Windows) |
| `brain` | ✅ | `/brain/*` | AI skills registry and semantic kernel |
| `rag` | ✅ | `/rag/*` | Document indexing and semantic search |
| `email` | ✅ | `/email/*` | SMTP email sending with templates |
| `image-gen` | ✅ | `/image/*` | DALL-E/Stability AI image generation |
| `git` | ✅ | `/git/*` | Git operations (status, commit, push, etc.) |
| `slack` | ✅ | `/slack/*` | Slack messaging integration |
| `file-storage` | ✅ | `/files/*` | S3, Google Drive, local file operations |
| `file-watcher` | ✅ | `/file-watcher/*` | Watch files for changes |
| `database` | ✅ | `/database/*` | MSSQL, PostgreSQL, MongoDB connections |
| `http` | ✅ | `/http/*` | Controlled HTTP requests with rate limiting |
| `openapi` | ✅ | `/openapi/*` | API specification loading and analysis |
| `secrets` | ✅ | `/secrets/*` | Secure credential reference system |
| `observability` | ✅ | `/observability/*` | Health checks, metrics, error tracking |
| `projects` | ✅ | `/projects/*` | Multi-project configuration management |
| `repo-intelligence` | ✅ | `/repo/*` | Repository analysis, AI summaries |
| `project-orchestrator` | ✅ | `/project-orchestrator/*` | AI-powered project scaffolding |
| `prompt-registry` | ✅ | `/prompts/*` | System prompt management |
| `tech-detector` | ✅ | `/tech/*` | Technology stack detection |
| `github-pattern-analyzer` | ✅ | `/github-patterns/*` | Pattern analysis for GitHub repos |
| `marketplace` | ✅ | `/marketplace/*` | Plugin marketplace |
| `code-review` | ✅ | `/code-review/*` | Automated code review |
| `video-gen` | ✅ | `/video/*` | Video generation |
| `tests` | ✅ | `/tests/*` | Test execution |
| `n8n` | ⚠️ Optional | `/n8n/*` | Node catalog, context, validation |
| `n8n-credentials` | ⚠️ Optional | `/credentials/*` | Credential metadata from n8n |
| `n8n-workflows` | ⚠️ Optional | `/n8n/workflows/*` | Workflow list, detail, search |

**Status Legend:**
- ✅ Production Ready: Fully implemented with REST endpoints and MCP tools
- ⚠️ Optional: Disabled by default, requires explicit configuration

### Implemented Plugins Detail

**Core Integrations (Always Available):**
- `github` - Full GitHub API integration with repo analysis, PR management, issue tracking
- `notion` - Complete Notion workspace management (pages, databases, blocks)
- `llm-router` - Multi-provider LLM routing with fallback
- `policy` - Rule-based access control with approval workflows
- `workspace` - Secure file operations within configured paths
- `local-sidecar` - Local filesystem with whitelist protection
- `shell` - Shell execution with blocked commands and working directory validation
- `docker` - Container lifecycle management
- `notifications` - Cross-platform system notifications
- `brain` - AI skills registry with memory and task orchestration
- `rag` - In-memory vector search with simple embeddings
- `email` - SMTP integration with templated emails
- `image-gen` - DALL-E 3 and Stability AI image generation
- `git` - Git operations wrapper
- `slack` - Slack bot integration
- `file-storage` - Multi-provider storage (S3, GDrive, local)
- `database` - Multi-database query interface (MSSQL, PostgreSQL, MongoDB)
- `http` - Safe HTTP proxy with rate limiting
- `openapi` - OpenAPI spec parsing and analysis
- `secrets` - Encrypted credential storage
- `observability` - Health checks and metrics

**J4RV1S System Plugins:**
- `brain` - Central AI skill registry for J4RV1S
- `rag` - Document retrieval for J4RV1S knowledge
- `shell` - Command execution for J4RV1S Vision
- `notifications` - User alerts from J4RV1S

**Optional Plugins (n8n Integration):**
Disable with `ENABLE_N8N_PLUGIN=false` in `.env`:
- `n8n` - Node catalog and context
- `n8n-credentials` - Credential metadata
- `n8n-workflows` - Workflow management

---

### Production Readiness Summary

**✅ Production Ready (32 plugins):**
- Core: policy, jobs, workspace
- J4RV1S: brain, rag, shell, notifications
- Git/Dev: github, git, repo-intelligence, github-pattern-analyzer
- Productivity: notion, projects, project-orchestrator
- Infrastructure: docker, database, file-storage, file-watcher, http
- AI/LLM: llm-router, brain, rag, image-gen, video-gen, code-review
- Comms: slack, email, notifications
- Utils: secrets, observability, openapi, prompt-registry, tech-detector, marketplace, tests

**⚠️ Optional/Disabled by default (3 plugins):**
- n8n, n8n-credentials, n8n-workflows

**Core System Status:**
- Plugin loader: ✅ Production ready (error tracking, STRICT mode, async support)
- Tool registry: ✅ Production ready (policy hooks integration)
- Job queue: ✅ Production ready (Redis/memory storage, progress tracking)
- Policy system: ✅ Production ready (extension hooks, approval workflows)
- Project context: ✅ Production ready (header-based with defaults)

---

## Quick Start

```bash
cd mcp-server
npm install
cp .env.example .env
# edit .env with your API keys
npm run dev
```

For non-n8n deployments, disable n8n plugins:

```bash
# Set these in your .env
ENABLE_N8N_PLUGIN=false
ENABLE_N8N_CREDENTIALS=false
ENABLE_N8N_WORKFLOWS=false
```

---

## Use Cases

### For AI Agent Developers
- **Cursor Integration**: Add AI-Hub endpoints to your Cursor tools
- **Claude Desktop**: Use as MCP server for Claude
- **Custom LLM Apps**: HTTP endpoints for any AI application

### For Development Teams
- **GitHub Analysis**: Repository insights and code structure
- **Project Management**: Notion integration for task tracking
- **API Documentation**: OpenAPI spec loading and analysis

### For Automation
- **Database Operations**: Query and manage multiple databases
- **File Management**: S3, Google Drive, local storage
- **HTTP Requests**: Controlled external API calls

---

## Project Structure

```
ai-hub/
├── mcp-server/                   # Main application (port 8787)
│   ├── src/
│   │   ├── core/                 # Server, plugin loader, auth, audit
│   │   └── plugins/
│   │       ├── github/            # GitHub repository analysis
│   │       ├── notion/            # Notion pages, databases, tasks
│   │       ├── http/              # Controlled HTTP requests
│   │       ├── database/          # MSSQL, PostgreSQL, MongoDB
│   │       ├── file-storage/      # S3, Google Drive, local
│   │       ├── openapi/           # API spec loading
│   │       ├── secrets/           # Secret management
│   │       ├── policy/            # Rule engine
│   │       ├── observability/     # Health, metrics
│   │       ├── projects/          # Multi-project config
│   │       └── n8n*/             # Optional n8n integration
│   ├── cache/                    # Disk cache (gitignored)
│   └── .env.example
├── PLAN.md                       # Plugin roadmap
└── README.md                     # This file
```

→ See [`mcp-server/README.md`](./mcp-server/README.md) for the full documentation.

---

## AI Agent Integration Examples

### Cursor Integration
Add to your Cursor tools:
```json
{
  "name": "ai-hub-github",
  "endpoint": "http://localhost:8787/github/analyze",
  "method": "POST",
  "description": "Analyze GitHub repository"
}
```

### Claude Desktop (MCP)
```json
{
  "mcpServers": {
    "ai-hub": {
      "command": "node",
      "args": ["/path/to/ai-hub/mcp-server/src/index.js"],
      "env": {
        "ENABLE_N8N_PLUGIN": "false"
      }
    }
  }
}
```

### Custom LLM Application
```python
import requests

def analyze_repo(repo_name):
    response = requests.post(
        "http://localhost:8787/github/analyze",
        json={"repo": repo_name}
    )
    return response.json()
```

---

## 🚀 Getting Started

### Quick Install
```bash
# Clone the repository
git clone https://github.com/your-org/ai-hub.git
cd ai-hub/mcp-server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start the server
npm run dev
```

### 🎯 Try It Out

```bash
# Check available plugins
curl http://localhost:8787/plugins

# Analyze a GitHub repository
curl -X POST http://localhost:8787/github/analyze \
  -H "Content-Type: application/json" \
  -d '{"repo": "vercel/next.js"}'

# List Docker containers (requires Docker)
curl http://localhost:8787/docker/containers

# Send Slack message (requires Slack token)
curl -X POST http://localhost:8787/slack/message \
  -H "Content-Type: application/json" \
  -d '{"channel": "#general", "text": "Hello from AI-Hub!"}'
```

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/chart.svg?repo=your-org/ai-hub)]

## 🏆 Community

- **Discord**: [Join our Discord](https://discord.gg/ai-hub)
- **GitHub Discussions**: [Ask questions](https://github.com/your-org/ai-hub/discussions)
- **Twitter**: Follow [@AIHubDev](https://twitter.com/AIHubDev)

## 📊 Stats

![GitHub stars](https://img.shields.io/github/stars/your-org/ai-hub?style=social)
![GitHub forks](https://img.shields.io/github/forks/your-org/ai-hub?style=social)
![GitHub issues](https://img.shields.io/github/issues/your-org/ai-hub)
![GitHub license](https://img.shields.io/github/license/your-org/ai-hub)

## 🎁 Contributors

Thanks to all our contributors! 🙏

<a href="https://github.com/your-org/ai-hub/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=your-org/ai-hub" />
</a>
