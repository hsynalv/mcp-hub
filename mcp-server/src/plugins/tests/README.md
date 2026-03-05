# Plugin: tests

Test runner integration for multiple frameworks (Vitest, Jest, Mocha). Run tests, lint code, and get coverage reports.

**Primary use cases:**
- AI runs tests before committing changes
- AI checks code quality with linters
- AI gets coverage reports for test gaps
- AI auto-detects test framework

---

## Setup

No configuration required. Auto-detects `package.json` scripts and test framework.

Optional: Custom test commands via request body.

---

## Endpoints

### `POST /tests/run`

Run tests for a project.

```bash
curl -X POST http://localhost:8787/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "command": "npm test"
  }'
```

**Auto-detection:** If `command` not provided, tries:
1. `package.json` test script
2. `vitest`, `jest`, or `mocha` based on installed packages

**Response:**
```json
{
  "ok": true,
  "framework": "vitest",
  "summary": { "passed": 10, "failed": 0, "skipped": 1 },
  "duration": 1240,
  "output": "..."
}
```

### `POST /tests/lint`

Run linter (ESLint, Prettier).

```bash
curl -X POST http://localhost:8787/tests/lint \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "command": "npm run lint"
  }'
```

**Response:**
```json
{
  "ok": true,
  "linter": "eslint",
  "issues": 3,
  "errors": [],
  "warnings": [
    { "file": "src/index.js", "line": 10, "message": "Unused variable" }
  ]
}
```

### `POST /tests/coverage`

Get test coverage report.

```bash
curl -X POST http://localhost:8787/tests/coverage \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "command": "npm run coverage"
  }'
```

**Response:**
```json
{
  "ok": true,
  "framework": "vitest",
  "coverage": {
    "lines": { "total": 1000, "covered": 850, "pct": 85 },
    "functions": { "total": 50, "covered": 45, "pct": 90 },
    "branches": { "total": 200, "covered": 160, "pct": 80 }
  }
}
```

### `GET /tests/health`

Plugin health check.

```bash
curl "http://localhost:8787/tests/health"
```

---

## MCP Tools

| Tool | Description | Tags |
|------|-------------|------|
| `tests_run` | Run tests | `READ`, `LOCAL_FS`, `BULK` |
| `tests_lint` | Run linter | `READ`, `LOCAL_FS` |
| `tests_coverage` | Get coverage | `READ`, `LOCAL_FS` |

---

## Workflow Example

```bash
# 1. Run tests before committing
curl -X POST http://localhost:8787/tests/run \
  -d '{"projectId":"my-app"}'

# 2. Check coverage
curl -X POST http://localhost:8787/tests/coverage \
  -d '{"projectId":"my-app"}'

# 3. Lint changed files
curl -X POST http://localhost:8787/tests/lint \
  -d '{"projectId":"my-app","command":"npx eslint src/"}'
```

---

## Framework Detection

Detects framework by:
1. `package.json` devDependencies
2. Presence of config files (`vitest.config.js`, `jest.config.js`)
3. Test file patterns (`*.test.js`, `*.spec.js`)

Supports: **Vitest**, **Jest**, **Mocha**
