# Plugin: git

Git repository operations — status, diff, branch management, commits, and push.

**Primary use cases:**
- AI checks repository status before making changes
- AI creates feature branches for new work
- AI commits changes with descriptive messages
- AI pushes to remote after commits
- AI reviews diffs before committing

---

## Setup

No additional configuration required. Uses system `git` binary.

Optional: Set default project workspace:

```env
WORKSPACE_PATH=/path/to/projects
```

---

## Endpoints

### `GET /git/status`

Get repository status.

```bash
curl "http://localhost:8787/git/status?projectId=my-project"
```

### `GET /git/diff`

Get working tree diff.

```bash
curl "http://localhost:8787/git/diff?projectId=my-project&staged=false"
```

### `POST /git/branches`

Create a new branch.

```bash
curl -X POST http://localhost:8787/git/branches \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-project",
    "branch": "feature/new-thing",
    "from": "main"
  }'
```

### `POST /git/checkout`

Switch to a branch.

```bash
curl -X POST http://localhost:8787/git/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-project",
    "branch": "feature/new-thing"
  }'
```

### `POST /git/commit`

Commit staged changes.

```bash
curl -X POST http://localhost:8787/git/commit \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-project",
    "message": "Add new feature implementation",
    "author": "AI Agent <agent@example.com>"
  }'
```

### `POST /git/push`

Push to remote.

```bash
curl -X POST http://localhost:8787/git/push \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-project",
    "remote": "origin",
    "branch": "feature/new-thing"
  }'
```

### `GET /git/log`

Get commit history.

```bash
curl "http://localhost:8787/git/log?projectId=my-project&limit=10"
```

---

## MCP Tools

| Tool | Description | Tags |
|------|-------------|------|
| `git_status` | Get repository status | `READ`, `GIT`, `LOCAL_FS` |
| `git_diff` | Get working tree diff | `READ`, `GIT`, `LOCAL_FS` |
| `git_branch_create` | Create a new branch | `WRITE`, `GIT` |
| `git_checkout` | Switch branches | `WRITE`, `GIT` |
| `git_commit` | Commit changes | `WRITE`, `GIT` |
| `git_push` | Push to remote | `WRITE`, `GIT`, `NETWORK` |
| `git_log` | Get commit history | `READ`, `GIT` |

---

## Workflow Example

```bash
# 1. Check status
curl "http://localhost:8787/git/status?projectId=my-app"

# 2. Create and switch to feature branch
curl -X POST http://localhost:8787/git/branches \
  -d '{"projectId":"my-app","branch":"feature/login","from":"main"}'

curl -X POST http://localhost:8787/git/checkout \
  -d '{"projectId":"my-app","branch":"feature/login"}'

# 3. Make file changes via workspace API...

# 4. Commit
curl -X POST http://localhost:8787/git/commit \
  -d '{"projectId":"my-app","message":"Implement login form"}'

# 5. Push
curl -X POST http://localhost:8787/git/push \
  -d '{"projectId":"my-app","branch":"feature/login"}'
```
