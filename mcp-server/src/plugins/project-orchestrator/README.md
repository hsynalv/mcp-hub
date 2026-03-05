# Plugin: project-orchestrator

**Turn ideas into structured projects with AI planning, Notion tracking, and automated code execution.**

This is the core plugin for your Jarvis vision: **Idea → AI Analysis → Notion Phases → Code → Git**

---

## Two Modes

### 1. Interactive Flow (Recommended)
AI learns from your GitHub repos, discusses architecture with you, then codes.

```
1. POST /draft                    → AI analyzes GitHub, suggests architectures
2. POST /draft/:id/select-arch    → You pick approach, AI creates detailed plan  
3. POST /draft/:id/execute        → You approve, AI starts coding
```

### 2. Direct Flow
Skip discussion and create immediately.

```
POST /init → AI plans → Notion + Code immediately
```

---

## Setup

Required env vars:

```env
# OpenAI for planning
OPENAI_API_KEY=sk-...

# Redis for draft sessions and pattern caching
REDIS_URL=redis://localhost:6379
PATTERN_CACHE_TTL_DAYS=7
DRAFT_SESSION_TTL_HOURS=1

# Notion (for project/task creation)
NOTION_API_KEY=secret_...
NOTION_PROJECTS_DB_ID=...
NOTION_TASKS_DB_ID=...

# Workspace (for code generation)
WORKSPACE_PATH=./workspace

# GitHub (for learning your patterns)
GITHUB_TOKEN=ghp_...
```

---

## Interactive Flow

### `POST /project-orchestrator/init`

**Create project from idea** — Main entry point

```bash
curl -X POST http://localhost:8787/project-orchestrator/init \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "Build a REST API for managing book reviews with authentication and ratings",
    "techStack": "Node.js, Express, PostgreSQL, JWT",
    "priority": "High",
    "autoExecute": true
  }'
```

**Response:**
```json
{
  "ok": true,
  "projectId": "uuid-123",
  "title": "Book Review API",
  "notionProjectId": "notion-page-id",
  "phases": 4,
  "tasks": 12,
  "initialized": true,
  "autoExecuted": true,
  "message": "Project \"Book Review API\" created with 12 tasks in Notion"
}
```

AI automatically:
- Analyzes complexity
- Splits into 3-5 phases
- Creates tasks with time estimates
- Generates initial files
- Optionally executes first phase

---

### `GET /project-orchestrator/projects`

List all active projects in memory.

```bash
curl http://localhost:8787/project-orchestrator/projects
```

---

### `GET /project-orchestrator/projects/:id`

Get project details including plan phases and tasks.

```bash
curl http://localhost:8787/project-orchestrator/projects/uuid-123
```

---

### `POST /project-orchestrator/projects/:id/execute`

Execute the next pending task.

```bash
curl -X POST http://localhost:8787/project-orchestrator/projects/uuid-123/execute
```

**Task types auto-detected:**
- `setup` → Initialize project structure
- `code` → Generate code files
- `test` → Run test suite
- `docs` → Generate README

---

### `POST /project-orchestrator/projects/:id/commit`

Commit current changes to git.

```bash
# Just commit
curl -X POST http://localhost:8787/project-orchestrator/projects/uuid-123/commit \
  -d '{"message": "Add user authentication"}'

# Commit and push to new branch
curl -X POST http://localhost:8787/project-orchestrator/projects/uuid-123/commit \
  -d '{
    "message": "Add user authentication",
    "branch": "feature/auth",
    "push": true
  }'
```

---

## MCP Tools

| Tool | Description | Tags |
|------|-------------|------|
| `project_init` | Create project from idea | `WRITE`, `EXTERNAL_API` |
| `project_execute_next` | Execute next pending task | `WRITE`, `LOCAL_FS` |

---

## Usage Example (Full Flow)

```bash
# 1. Initialize project
PROJECT=$(curl -s -X POST http://localhost:8787/project-orchestrator/init \
  -d '{"idea":"Build a todo app with React and Node.js","autoExecute":true}' | jq -r '.projectId')

# 2. Check created tasks
curl http://localhost:8787/project-orchestrator/projects/$PROJECT

# 3. Execute remaining tasks one by one
curl -X POST http://localhost:8787/project-orchestrator/projects/$PROJECT/execute
curl -X POST http://localhost:8787/project-orchestrator/projects/$PROJECT/execute

# 4. Check Notion - project and tasks are there
# 5. Check workspace - code files generated

# 6. Commit when done
curl -X POST http://localhost:8787/project-orchestrator/projects/$PROJECT/commit \
  -d '{"message":"Initial todo app implementation","push":true}'
```

---

## AI Analysis Output

When you send an idea, AI returns a structured plan:

```json
{
  "title": "Book Review API",
  "description": "REST API for book reviews with auth",
  "complexity": "medium",
  "estimatedHours": 16,
  "phases": [
    {
      "name": "Setup",
      "tasks": [
        { "title": "Initialize Node project", "type": "setup" },
        { "title": "Setup Express server", "type": "code" }
      ]
    },
    {
      "name": "Database",
      "tasks": [
        { "title": "Create schema", "type": "code" },
        { "title": "Setup migrations", "type": "setup" }
      ]
    },
    {
      "name": "API Implementation",
      "tasks": [
        { "title": "Auth endpoints", "type": "code" },
        { "title": "Review CRUD", "type": "code" }
      ]
    },
    {
      "name": "Testing",
      "tasks": [
        { "title": "Unit tests", "type": "test" },
        { "title": "Integration tests", "type": "test" }
      ]
    }
  ],
  "filesToCreate": [
    "src/index.js",
    "src/routes/auth.js",
    "src/models/review.js",
    "tests/auth.test.js"
  ],
  "dependencies": ["express", "pg", "jsonwebtoken", "bcrypt"]
}
```

---

## Integration with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-hub": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/mcp/stdio-bridge.js"],
      "env": {
        "MCP_SERVER_URL": "http://localhost:8787"
      }
    }
  }
}
```

Then ask Claude:
- "Create a project for a URL shortener service"
- "Execute the next task for project uuid-123"
- "Commit the changes with message 'Add shortener logic'"

---

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│   Your Idea     │────▶│   AI Brain   │────▶│    Notion    │
│  (Natural Lang) │     │  (Planning)  │     │ (Project+Tasks)│
└─────────────────┘     └──────────────┘     └──────────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────┐                           ┌──────────────┐
│   Workspace     │◀─────────────────────────│ Task Runner  │
│  (Code Files)   │                           │  (Execute)   │
└────────┬────────┘                           └──────────────┘
         │
         ▼
┌─────────────────┐
│      Git        │
│ (Commit/Push)   │
└─────────────────┘
```

---

## Next Steps (Jarvis Roadmap)

| Feature | Phase | Plugin Needed |
|---------|-------|---------------|
| Email monitoring | Phase 2 | `email` |
| File watching | Phase 2 | `watcher` |
| Spotify control | Phase 2 | `spotify` |
| Calendar integration | Phase 2 | `calendar` |
| System notifications | Phase 2 | `notifications` |
| Voice commands | Phase 3 | `voice` |
| Screen capture | Phase 3 | `vision` |

Your current setup covers **Phase 1: AI Project Development** ✅

---

## Troubleshooting

**"LLM not configured"**
→ Set `OPENAI_API_KEY` in `.env`

**"Failed to create Notion project"**
→ Check `NOTION_API_KEY` and database IDs

**"Failed to write files"**
→ Check `WORKSPACE_PATH` exists and is writable

**AI generates bad code?**
→ Use `gpt-4o` instead of `gpt-4o-mini` (set `BRAIN_LLM_MODEL`)

**Tasks stuck?**
→ Check job queue: `GET /jobs`
→ Retry: `POST /project-orchestrator/projects/:id/execute`
