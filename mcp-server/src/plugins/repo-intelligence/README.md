# Repo Intelligence Plugin

Repository analysis and AI-powered insights for MCP Hub.

## Overview

The Repo Intelligence plugin provides tools for analyzing Git repositories, extracting insights, and generating AI-powered summaries. It integrates with the LLM Router for intelligent code analysis and repository understanding.

## Features

- **Commit History**: Analyze recent commits with metadata
- **Issue Tracking**: Fetch and analyze open issues from GitHub
- **Project Structure**: Map repository architecture and dependencies
- **AI Summaries**: LLM-powered repository insights and analysis
- **Multi-Provider**: Supports various LLM providers via LLM Router

## Tools

### repo_recent_commits
Get recent commits from a local git repository.

```javascript
{
  repoPath: "/path/to/repo",
  limit: 10,              // Optional, default 10
  explanation: "Analyzing recent changes"
}
```

**Tags**: `read_only`, `git`

**Returns**:
```json
{
  "ok": true,
  "data": {
    "repoPath": "/path/to/repo",
    "commits": [
      {
        "hash": "abc123",
        "message": "Add new feature",
        "author": "John Doe",
        "date": "2024-01-15",
        "filesChanged": 5
      }
    ]
  }
}
```

### repo_open_issues
Fetch open issues from a GitHub repository.

```javascript
{
  repo: "owner/repository-name",
  limit: 10,              // Optional, default 10
  explanation: "Checking pending issues"
}
```

**Tags**: `read_only`, `network`

**Returns**:
```json
{
  "ok": true,
  "data": {
    "repo": "owner/repo",
    "issues": [
      {
        "number": 42,
        "title": "Bug in authentication",
        "state": "open",
        "createdAt": "2024-01-10",
        "url": "https://github.com/owner/repo/issues/42"
      }
    ],
    "count": 15
  }
}
```

### repo_project_structure
Analyze repository structure and dependencies.

```javascript
{
  repoPath: "/path/to/repo",
  maxDepth: 3,            // Optional, default 3
  explanation: "Mapping project architecture"
}
```

**Tags**: `read_only`, `local_fs`

**Returns**:
```json
{
  "ok": true,
  "data": {
    "repoPath": "/path/to/repo",
    "structure": {
      "src/": {
        "components/": ["Button.js", "Header.js"],
        "utils/": ["helpers.js"]
      },
      "tests/": ["unit.test.js"]
    },
    "stats": {
      "totalFiles": 25,
      "totalDirs": 8,
      "languages": ["javascript", "json", "md"]
    }
  }
}
```

### repo_summary
Generate AI-powered repository summary.

```javascript
{
  repoPath: "/path/to/repo",
  explanation: "Generating project overview"
}
```

**Tags**: `read_only`, `network`

**Returns**:
```json
{
  "ok": true,
  "data": {
    "summary": "This is a Node.js REST API project...",
    "keyFeatures": ["Authentication", "CRUD operations", "Validation"],
    "techStack": ["Node.js", "Express", "MongoDB"],
    "complexity": "Medium",
    "recommendations": ["Add more tests", "Improve error handling"]
  }
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/repo/commits?repoPath=...&limit=10` | Get recent commits |
| GET | `/repo/issues?repo=owner/repo&limit=10` | Get open issues |
| GET | `/repo/structure?repoPath=...&maxDepth=3` | Get project structure |
| GET | `/repo/summary?repoPath=...` | Get AI summary |

## Configuration

### Environment Variables

```bash
# GitHub API Token (for issue fetching)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# LLM Router Configuration
export OPENAI_API_KEY=sk-xxxxxxxx
export BRAIN_LLM_URL=https://api.openai.com/v1
export BRAIN_LLM_MODEL=gpt-4o
```

## Examples

### Analyze Recent Commits
```bash
curl "http://localhost:8787/repo/commits?repoPath=./my-project&limit=5"
```

### Check Open Issues
```bash
curl "http://localhost:8787/repo/issues?repo=facebook/react&limit=10"
```

### Map Project Structure
```bash
curl "http://localhost:8787/repo/structure?repoPath=./my-project&maxDepth=2"
```

### Generate AI Summary
```bash
curl "http://localhost:8787/repo/summary?repoPath=./my-project"
```

## AI Analysis

The `repo_summary` tool uses the LLM Router plugin for intelligent analysis:

1. Collects repository data (structure, commits, dependencies)
2. Sends to LLM with structured prompt
3. Returns actionable insights and recommendations

Supported LLM providers:
- OpenAI (GPT-4, GPT-4o)
- Anthropic (Claude)
- Google (Gemini)
- Mistral AI
- Ollama (local)

## Integration

### With Project Orchestrator
```javascript
// Use repo_summary to analyze existing project
const summary = await repo_summary({
  repoPath: "./existing-project",
  explanation: "Understanding codebase before refactoring"
});

// Use insights to create new project phases
await project_create_tasks({
  idea: "Refactor based on: " + summary.data.recommendations.join(", "),
  techStack: "Node.js",
  explanation: "Creating refactoring tasks"
});
```

### With Notion
```javascript
// Export summary to Notion page
await notion_create_page({
  title: "Project Analysis: " + repoName,
  blocks: [
    { type: "paragraph", text: summary.data.summary },
    { type: "heading_2", text: "Key Features" },
    ...summary.data.keyFeatures.map(f => ({ 
      type: "bullet_list_item", 
      text: f 
    }))
  ],
  explanation: "Documenting repository analysis"
});
```

## Error Handling

| Code | Description |
|------|-------------|
| `invalid_path` | Repository path doesn't exist |
| `not_a_repo` | Path is not a git repository |
| `git_error` | Git command failed |
| `github_error` | GitHub API error |
| `parse_error` | Failed to parse git output |
| `summary_error` | LLM analysis failed |

## Testing

```bash
npm test tests/plugins/repo-intelligence.test.js
```

## License

MIT
