# Plugin: github

Gives the AI agent read access to GitHub repositories — public and private. The AI can list repos, analyze a repo's structure and recent activity, read individual files, and use all of this as context for project planning.

**Primary use cases:**
- "List my repos and let me pick one to plan"
- "Analyze this repo and tell me what's done and what's missing"
- "Create a Notion project plan based on this GitHub repo"
- "What are the open issues in this project?"
- "Show me the file structure of this codebase"

---

## Setup

Create a GitHub Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens).

**Required scope:**
- `repo` — full access to public and private repositories

Add to `.env`:
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Without a token, only public repos work and rate limit is 60 requests/hour.  
With a token, rate limit is 5000 requests/hour and private repos are accessible.

---

## Endpoints

### `GET /github/repos` ⭐ Primary AI Tool — list your own repos

Lists **all repositories** (public + private) belonging to the authenticated user. Uses the configured `GITHUB_TOKEN` — no username needed.

**Query params:**

| Param | Options | Default |
|-------|---------|---------|
| `type` | `owner`, `all`, `member` | `owner` |
| `sort` | `pushed`, `created`, `updated`, `full_name` | `pushed` |
| `limit` | number | `30` |

**Example:**
```bash
curl "http://localhost:8787/github/repos?sort=pushed&limit=20&type=all"
```

**Response:**
```json
{
  "ok": true,
  "count": 12,
  "repos": [
    {
      "fullName": "hsynalv/mcp-hub",
      "description": "Plugin-based MCP server",
      "language": "JavaScript",
      "private": false,
      "pushedAt": "2026-03-01T16:04:15Z"
    },
    {
      "fullName": "hsynalv/percepta_fe",
      "description": null,
      "language": "TypeScript",
      "private": true,
      "pushedAt": "2026-02-07T21:54:41Z"
    }
  ]
}
```

Use `fullName` from this response as the `repo` parameter for `analyze_repo`.

---

### `GET /github/users/:username/repos`

List public repositories for any GitHub user or organization.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `sort` | `pushed` | Sort order |
| `limit` | `30` | Max results |

**Example:**
```bash
curl "http://localhost:8787/github/users/expressjs/repos?limit=10"
```

---

### `GET /github/analyze?repo=owner/repo` ⭐ Primary AI Tool — deep repo analysis

Returns a **complete snapshot** of a repository in one call — ideal for the AI to analyze and generate a project plan.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `repo` | ✅ | `owner/repo` format (e.g. `hsynalv/mcp-hub`) or full GitHub URL |

**Includes:**
- Repository metadata (language, topics, stars, description, private)
- File tree (up to depth 3)
- Last 15 commits
- Open issues (up to 20)
- Open pull requests (up to 10)
- README content (first 3000 characters)

**Example:**
```bash
curl "http://localhost:8787/github/analyze?repo=hsynalv/mcp-hub"
# Full GitHub URL also works:
curl "http://localhost:8787/github/analyze?repo=https://github.com/hsynalv/mcp-hub"
```

**Response:**
```json
{
  "ok": true,
  "repo": {
    "fullName": "hsynalv/mcp-hub",
    "description": "Plugin-based MCP server",
    "language": "JavaScript",
    "openIssues": 0,
    "private": false,
    "defaultBranch": "main"
  },
  "tree": {
    "branch": "main",
    "count": 30,
    "items": [
      { "path": "src", "type": "tree" },
      { "path": "src/index.js", "type": "blob", "size": 320 }
    ]
  },
  "commits": {
    "count": 5,
    "items": [
      { "sha": "a1b2c3d", "message": "Add GitHub plugin", "author": "hsynalv", "date": "2026-03-01" }
    ]
  },
  "issues": { "open": 0, "items": [] },
  "pullRequests": { "open": 0, "items": [] },
  "readme": "# mcp-hub\n\nA plugin-based HTTP knowledge service..."
}
```

> **Note:** Also available as `POST /github/analyze` with body `{ "repo": "owner/repo" }` for backward compatibility.

---

### `GET /github/repo/:owner/:repo`

Repository metadata only — faster than `/analyze` when you only need basic info.

```bash
curl "http://localhost:8787/github/repo/hsynalv/mcp-hub"
```

---

### `GET /github/repo/:owner/:repo/tree`

File and directory tree for a branch.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `branch` | repo default | Branch name |
| `depth` | `3` | Max directory depth |

```bash
curl "http://localhost:8787/github/repo/hsynalv/mcp-hub/tree?depth=2"
```

---

### `GET /github/repo/:owner/:repo/file`

Decoded content of a specific file.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `path` | ✅ | File path e.g. `src/index.js` |
| `branch` | — | Branch name (default: HEAD) |

```bash
curl "http://localhost:8787/github/repo/hsynalv/mcp-hub/file?path=package.json"
```

If `path` points to a directory, returns a file listing instead of content.

---

### `GET /github/repo/:owner/:repo/commits`

Recent commits with author and message.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `branch` | default branch | Branch to read |
| `limit` | `20` | Max commits |
| `path` | — | Filter commits touching this file |

---

### `GET /github/repo/:owner/:repo/issues`

Open issues and pull requests.

**Query params:**

| Param | Options | Default |
|-------|---------|---------|
| `state` | `open`, `closed`, `all` | `open` |
| `type` | `issues`, `prs`, `all` | `issues` |
| `limit` | number | `30` |

---

## Typical AI Workflow

### List repos → pick one → analyze → plan in Notion

```
1. GET /github/repos
   → AI shows all repos (public + private), user picks one

2. GET /github/analyze?repo=hsynalv/percepta_fe
   → AI receives full snapshot: file tree, commits, issues, README

3. AI generates project plan:
   - What's been built (file tree + commits)
   - What's missing or broken (issues)
   - Suggested next steps (tasks)

4. POST /notion/setup-project
   → Creates project + all tasks in Notion in one call
```

### Read a specific file for context

```
GET /github/repo/hsynalv/mcp-hub/file?path=src/core/config.js
→ AI reads the file and uses it as context
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Recommended | Personal access token with `repo` scope |

Without `GITHUB_TOKEN`:
- Only public repos are accessible
- Rate limit: 60 requests/hour

With `GITHUB_TOKEN`:
- Public and private repos are accessible
- Rate limit: 5000 requests/hour
- The token is **never** forwarded to clients — used server-side only
