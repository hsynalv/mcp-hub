# Code Review Plugin

Automated code review with security scanning, quality checks, and AI-powered suggestions.

## Overview

The Code Review Plugin provides:
- **Security Scanning**: Detect secrets, SQL injection, XSS, hardcoded credentials
- **Quality Checks**: Find code smells, anti-patterns, complexity issues
- **Static Analysis**: Pattern-based detection without executing code
- **AI Review**: LLM-powered code analysis and suggestions
- **PR Integration**: Automated pull request reviews

## Security Patterns Detected

| Pattern | Severity | Description |
|---------|----------|-------------|
| `hardcoded-secret` | Critical | API keys, passwords in code |
| `sql-injection` | Critical | Unparameterized SQL queries |
| `eval-usage` | Critical | Dangerous eval() calls |
| `inner-html` | High | XSS via innerHTML |
| `insecure-random` | High | Math.random() for security |
| `http-usage` | Medium | Unencrypted HTTP URLs |
| `todo-security` | Low | Security-related TODOs |

## Quality Checks

| Check | Description |
|-------|-------------|
| Long Functions | Functions > 50 lines |
| Console Logs | Leftover console.log statements |
| Magic Numbers | Unnamed numeric constants |
| TODO Comments | Unfinished work markers |
| Code Duplication | Repeated code blocks |
| Nested Callbacks | Callback hell patterns |

## MCP Tools

### `code_review_file`

Review a single file for issues.

**Parameters:**
- `content` (string): File content to review
- `filename` (string): Name of the file
- `options` (object): Review options (includeSuggestions, aiReview)

**Example:**
```json
{
  "content": "const password = 'secret123';\nconst query = `SELECT * FROM users WHERE id = ${userId}`;",
  "filename": "auth.js",
  "options": {
    "includeSuggestions": true,
    "aiReview": true
  }
}
```

**Returns:**
```json
{
  "passed": false,
  "issues": [
    {
      "id": "hardcoded-secret",
      "severity": "critical",
      "line": 1,
      "message": "Hardcoded password detected",
      "suggestion": "Use environment variables"
    },
    {
      "id": "sql-injection",
      "severity": "critical",
      "line": 2,
      "message": "Potential SQL injection",
      "suggestion": "Use parameterized queries"
    }
  ],
  "summary": {
    "critical": 2,
    "high": 0,
    "medium": 0,
    "low": 0
  }
}
```

### `code_review_pr`

Review a pull request across multiple files.

**Parameters:**
- `files` (array): List of files with content
- `context` (object): PR metadata (title, description)

**Example:**
```json
{
  "files": [
    { "path": "/src/auth.js", "content": "..." },
    { "path": "/src/db.js", "content": "..." }
  ],
  "context": {
    "title": "Add authentication",
    "description": "Implements JWT auth"
  }
}
```

### `code_review_security`

Focused security scan.

**Parameters:**
- `code` (string): Code to scan
- `filename` (string): Optional filename for context

**Example:**
```json
{
  "code": "eval(userInput);",
  "filename": "utils.js"
}
```

### `code_review_suggest_fix`

Get AI-powered fix suggestions.

**Parameters:**
- `issue` (object): The issue to fix
- `code` (string): Surrounding code context

**Example:**
```json
{
  "issue": {
    "id": "sql-injection",
    "severity": "critical"
  },
  "code": "const query = `SELECT * FROM users WHERE id = ${id}`;"
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/code-review/file` | Review single file |
| POST | `/code-review/pr` | Review PR across files |
| POST | `/code-review/security` | Security-only scan |
| POST | `/code-review/suggest` | Get fix suggestions |

## Usage Examples

### Review Single File
```bash
curl -X POST http://localhost:8787/code-review/file \
  -H "Content-Type: application/json" \
  -d '{
    "content": "const API_KEY = 'secret';",
    "filename": "config.js",
    "options": { "aiReview": true }
  }'
```

### Security Scan
```bash
curl -X POST http://localhost:8787/code-review/security \
  -H "Content-Type: application/json" \
  -d '{
    "code": "db.query(`SELECT * FROM users WHERE id = ${id}`)",
    "filename": "database.js"
  }'
```

## GitHub Integration

Enable automatic PR reviews via webhook:

```env
CODE_REVIEW_AUTO=true
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```

When enabled, the plugin will automatically review PRs and post comments.

## Review Report Format

```json
{
  "totalFiles": 5,
  "filesWithIssues": 2,
  "summary": {
    "critical": 1,
    "high": 3,
    "medium": 5,
    "low": 8
  },
  "files": [
    {
      "path": "/src/auth.js",
      "passed": false,
      "issues": [...]
    }
  ]
}
```

## Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| **Critical** | Security vulnerability, data loss risk | Block merge |
| **High** | Significant bug, performance issue | Fix before merge |
| **Medium** | Code smell, maintainability issue | Fix soon |
| **Low** | Style issue, minor concern | Fix when convenient |

## Environment Variables

```env
# Enable automatic PR reviews
CODE_REVIEW_AUTO=false

# GitHub webhook secret for verification
GITHUB_WEBHOOK_SECRET=

# OpenAI API key for AI-powered suggestions (optional)
OPENAI_API_KEY=sk-...
```

## Supported Languages

- JavaScript/TypeScript
- Python
- Go
- Java
- Ruby
- PHP

## Integration with CI/CD

### GitHub Actions
```yaml
name: Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Code Review
        run: |
          curl -X POST http://your-mcp-hub/code-review/pr \
            -H "Content-Type: application/json" \
            -d @<(echo '{"files": [...]}')
```

### Pre-commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

curl -X POST http://localhost:8787/code-review/file \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$(cat $1 | base64)\", \"filename\": \"$1\"}"
```
