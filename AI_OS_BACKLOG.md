# AI Operating System Backlog

> Roadmap for transforming MCP-Hub into a complete AI Operating System backend.

## Overview

This document outlines the strategic roadmap for evolving MCP-Hub from an HTTP knowledge service into a comprehensive AI Operating System. The goal is to enable a primary LLM agent (Jarvis) to execute real-world tasks autonomously through a secure, extensible tool ecosystem.

---

## P0 — Core Infrastructure

### Tool Registry
- **Status**: ✅ Implemented
- **Purpose**: Central registration and validation of all MCP tools
- **Key Features**:
  - Schema validation (inputSchema enforcement)
  - Tool tagging system (read_only, write, destructive, needs_approval)
  - Policy enforcement hooks
  - Automatic startup validation

### Policy & Approval System
- **Status**: ✅ Implemented
- **Purpose**: Rule-based access control with human-in-the-loop approvals
- **Key Features**:
  - Tag-based approval requirements
  - Pending approval queue (GET /approvals/pending)
  - Manual approval endpoint (POST /approve)
  - Audit logging for all tool executions

### Multi-LLM Router
- **Status**: ✅ Implemented
- **Purpose**: Intelligent routing to optimal LLM provider based on task type
- **Supported Providers**:
  - OpenAI (GPT-4, GPT-4o, GPT-4o-mini)
  - Anthropic (Claude 3 Opus, Sonnet, Haiku)
  - Google (Gemini 1.5 Pro, Flash)
  - Mistral (Large, Medium, Small)
  - Ollama (Local models: llama3, codellama, mistral, phi3)
- **Key Features**:
  - Task-based routing (coding, analysis, documentation, fast, local)
  - Fallback provider support
  - Cost estimation
  - REST + MCP tool interfaces

### Job System
- **Status**: 🚧 Partial (n8n integration provides async execution)
- **Purpose**: Async task execution and queue management
- **Planned Features**:
  - Native job queue (not dependent on n8n)
  - Progress tracking
  - Job dependencies and chaining
  - Retry mechanisms with backoff

---

## P1 — Integrations

### GitHub Integration
- **Status**: ✅ Implemented
- **Purpose**: Repository analysis and management
- **Features**:
  - Repository analysis (file tree, commits, issues)
  - Code pattern detection
  - PR/issue management

### Notion Integration
- **Status**: ✅ Implemented
- **Purpose**: Knowledge base and project management
- **Features**:
  - Page creation and updates
  - Database operations
  - Block-level content management

### n8n Integration
- **Status**: ✅ Implemented
- **Purpose**: Workflow automation platform integration
- **Features**:
  - Node catalog access
  - Workflow validation
  - Credential management
  - Execution context

### Database Access
- **Status**: ✅ Implemented
- **Purpose**: Multi-database connectivity
- **Supported**: MSSQL, PostgreSQL, MongoDB

### File Storage
- **Status**: ✅ Implemented
- **Purpose**: Multi-provider file operations
- **Providers**: S3, Google Drive, local filesystem

### Email Integration
- **Status**: ✅ Implemented
- **Purpose**: Email composition and sending
- **Features**: Template support, multiple providers

### Slack Integration
- **Status**: ✅ Implemented
- **Purpose**: Team communication automation
- **Features**: Message sending, channel management

### OpenAPI Support
- **Status**: ✅ Implemented
- **Purpose**: External API integration
- **Features**: Spec loading, request building

---

## P2 — Computer Interaction

### Local Sidecar
- **Status**: ✅ Implemented
- **Purpose**: Safe local filesystem access
- **Features**:
  - Whitelist-based access control
  - File operations (list, read, write, hash)
  - Google Drive upload (with approval)
  - Cross-platform support (macOS, Linux, Windows)

### File Watcher
- **Status**: ✅ Implemented
- **Purpose**: Monitor filesystem changes
- **Features**: Event-driven file monitoring

### Shell Execution
- **Status**: ✅ Implemented
- **Purpose**: Controlled command execution
- **Features**: Safety constraints, output capture

### Notifications
- **Status**: ✅ Implemented
- **Purpose**: Cross-platform notifications
- **Features**: macOS, Linux, Windows support

### Repository Intelligence
- **Status**: ✅ Implemented
- **Purpose**: AI-powered repository analysis
- **Features**:
  - Commit history analysis
  - Open issue tracking
  - Project structure mapping
  - LLM-powered summaries
  - Roadmap generation

### Project Orchestrator
- **Status**: ✅ Implemented
- **Purpose**: AI-powered project scaffolding
- **Features**:
  - Repository creation
  - Structure generation
  - Task creation
  - Code generation
  - PR/issue management

---

## P3 — Observability

### Health Checks
- **Status**: ✅ Implemented
- **Purpose**: System health monitoring
- **Endpoints**: /health, /policy/health

### Metrics
- **Status**: 🚧 Partial
- **Purpose**: Performance and usage metrics
- **Planned**: Prometheus export, dashboard

### Audit Logging
- **Status**: ✅ Implemented
- **Purpose**: Complete execution history
- **Features**: Tool calls, approvals, errors

### Tracing
- **Status**: ⏳ Planned
- **Purpose**: Distributed tracing
- **Planned**: OpenTelemetry integration

### Error Tracking
- **Status**: ✅ Implemented (basic)
- **Purpose**: Error aggregation and alerting
- **Planned**: Sentry integration

---

## Future Considerations

### Prompt Registry (P2)
- **Status**: 🚧 In Progress
- **Purpose**: Centralized prompt management with versioning
- **Features**:
  - Prompt CRUD operations
  - Version control
  - Tag-based categorization
  - A/B testing support

### Agent Memory
- **Status**: ⏳ Planned
- **Purpose**: Persistent agent context across sessions
- **Features**:
  - Conversation history
  - Preference learning
  - Long-term memory storage

### Multi-Agent Coordination
- **Status**: ⏳ Planned
- **Purpose**: Orchestrate multiple AI agents
- **Features**:
  - Agent discovery
  - Task delegation
  - Conflict resolution

### Code Review Automation
- **Status**: ✅ Implemented (basic)
- **Purpose**: AI-powered code review
- **Features**: Pattern detection, suggestion generation

### RAG System
- **Status**: ✅ Implemented (basic)
- **Purpose**: Retrieval-augmented generation
- **Features**: Document indexing, semantic search

---

## Success Metrics

The AI OS is considered stable when it can successfully execute workflows like:

1. **"Create an n8n workflow that scrapes stock prices"**
   - Uses: n8n plugin + LLM router for workflow generation
   - Complexity: Medium
   - Status: ✅ Supported

2. **"Analyze percepta repo and create roadmap"**
   - Uses: repo-intelligence + project-orchestrator
   - Complexity: High
   - Status: ✅ Supported

3. **"Upload report to Google Drive"**
   - Uses: local-sidecar drive_upload (with approval)
   - Complexity: Low
   - Status: ✅ Supported

4. **"Turn this idea into a project and start coding"**
   - Uses: project-orchestrator full workflow
   - Complexity: Very High
   - Status: ✅ Supported

---

## Implementation Priority

### Immediate (Current Sprint)
- ✅ README architecture documentation
- ✅ Tool contract validation
- ✅ Approval endpoint implementation
- ✅ AI_OS_BACKLOG.md creation

### Short-term (Next 2 Sprints)
- 🚧 LLM router stability improvements
- 🚧 Repo summary flow service
- 🚧 Prompt registry plugin
- ⏳ Observability enhancements (metrics, tracing)

### Medium-term (Next Quarter)
- ⏳ Native job system (reduce n8n dependency)
- ⏳ Agent memory system
- ⏳ Multi-agent coordination
- ⏳ Advanced observability (Sentry, Prometheus)

---

## Contributing

When adding new plugins or features:

1. Follow the 6-layer architecture
2. Include proper tool tagging
3. Add explanation field to all write/destructive tools
4. Update this backlog
5. Add tests to `tests/plugins/`
6. Update plugin table in README

---

## Version History

- **v1.0.0**: Initial MCP server with basic integrations
- **v1.5.0**: Policy system and approval flow
- **v2.0.0**: Multi-LLM router and AI features
- **v2.5.0**: Project orchestrator and repo intelligence
- **v3.0.0**: AI Operating System (current target)
