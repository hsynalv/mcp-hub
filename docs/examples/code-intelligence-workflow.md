# Code Intelligence Workflow Example

Example setup for code analysis, review, and repository intelligence.

## Prerequisites

- `WORKSPACE_BASE` or `WORKSPACE_ROOT` pointing to your project directory
- `OPENAI_API_KEY` for LLM-powered code review (optional)
- Git plugin, code-review plugin, repo-intelligence plugin

## Configuration

```env
# Workspace root — all file paths must be under this directory
WORKSPACE_BASE=/path/to/your/projects
# Or on Windows: WORKSPACE_BASE=C:\Users\you\Projects

# Optional: LLM for code review suggestions
OPENAI_API_KEY=sk-your-key-here

# Repo intelligence (defaults to cwd if not set)
REPO_PATH=/path/to/your/repo
```

## Workflow

### 1. Code Review (Single File)

```bash
curl -X POST http://localhost:8787/code-review/file \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -d '{
    "path": "/path/to/your/projects/my-repo/src/index.js",
    "options": {
      "security": true,
      "quality": true,
      "llm": true
    }
  }'
```

### 2. PR-Style Review (Multiple Files)

```bash
curl -X POST http://localhost:8787/code-review/pr \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -d '{
    "files": [
      {"path": "src/utils.js", "status": "modified"},
      {"path": "src/api.js", "status": "added"}
    ]
  }'
```

### 3. Repository Analysis

```bash
# Recent commits
curl "http://localhost:8787/repo/commits?path=.&limit=20" \
  -H "Authorization: Bearer YOUR_READ_KEY"

# Project structure
curl "http://localhost:8787/repo/structure?path=.&maxDepth=3" \
  -H "Authorization: Bearer YOUR_READ_KEY"

# AI summary
curl -X POST http://localhost:8787/repo/summary \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -d '{"path": "."}'
```

### 4. Git Operations

```bash
# Status
curl "http://localhost:8787/git/status?path=/path/to/repo" \
  -H "Authorization: Bearer YOUR_READ_KEY"

# Diff
curl "http://localhost:8787/git/diff?path=/path/to/repo&staged=true" \
  -H "Authorization: Bearer YOUR_READ_KEY"
```

## Path Safety

All paths are validated against `WORKSPACE_BASE`. Path traversal (`../`) is blocked. When `x-workspace-id` is provided, paths are further confined to the workspace root.

## MCP Tools

- `code_review_file` — Review a single file
- `code_review_pr` — Review multiple files
- `code_review_security` — Fast regex-based security scan
- `git_status`, `git_diff`, `git_log` — Git operations
- Repo intelligence tools for commits, structure, analysis
