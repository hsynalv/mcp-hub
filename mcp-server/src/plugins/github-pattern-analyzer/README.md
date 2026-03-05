# Plugin: github-pattern-analyzer

Learns user's coding patterns from GitHub repos and caches in Redis for AI project planning.

---

## Purpose

When user says "Build me a service", AI needs to know:
- What tech stack they prefer
- How they structure projects
- What patterns they follow

This plugin analyzes 3-5 recent GitHub repos, extracts patterns, and stores in Redis.

---

## Flow

```
1. User: "Build auth service"
        ↓
2. GET /github-patterns/analyze (or use cached)
   → Fetches 5 repos from /github/repos
   → Deep analyzes each with /github/analyze
   → AI extracts patterns
   → Stores in Redis (7 day TTL)
        ↓
3. GET /github-patterns/architecture-options?idea=...
   → Loads cached patterns
   → AI creates 2-3 architecture options
   → References user's actual code snippets
        ↓
4. Present to user with examples from their repos
```

---

## Setup

Required env vars:

```env
# Redis (required)
REDIS_URL=redis://localhost:6379
PATTERN_CACHE_TTL_DAYS=7

# OpenAI (for pattern extraction)
OPENAI_API_KEY=sk-...

# Optional overrides
BRAIN_LLM_MODEL=gpt-4o
GITHUB_ANALYZE_REPO_COUNT=5
```

---

## Endpoints

### `GET /github-patterns/analyze?repos=5`

Analyze repos and cache patterns.

```bash
curl http://localhost:8787/github-patterns/analyze?repos=5
```

**Response:**
```json
{
  "ok": true,
  "username": "hsynalv",
  "patterns": {
    "techStack": {
      "languages": ["TypeScript", "JavaScript"],
      "primaryFramework": "Express.js",
      "testingFrameworks": ["Vitest"]
    },
    "architecture": {
      "pattern": "Layered",
      "folderStructure": ["src/routes", "src/services", "src/models"]
    },
    "examples": {
      "api-gateway": {
        "routeDefinition": "src/routes/index.ts"
      }
    },
    "confidence": 0.85
  },
  "analyzedRepos": ["api-gateway", "auth-service", "mcp-hub"],
  "cached": true
}
```

---

### `GET /github-patterns/cached?username=hsynalv`

Get cached patterns (fast, no GitHub API calls).

```bash
curl "http://localhost:8787/github-patterns/cached?username=hsynalv"
```

Returns `404` if no cache found.

---

### `GET /github-patterns/architecture-options?idea=...&username=...`

Generate architecture options for a project idea.

```bash
curl "http://localhost:8787/github-patterns/architecture-options?idea=Build notification service&username=hsynalv"
```

**Response:**
```json
{
  "ok": true,
  "idea": "Build notification service",
  "options": [
    {
      "id": "opt-1",
      "name": "Express + BullMQ (like api-gateway)",
      "techStack": {
        "framework": "Express",
        "language": "TypeScript"
      },
      "exampleSnippets": [
        {
          "repo": "api-gateway",
          "file": "src/services/queue.ts",
          "snippet": "class QueueService { ... }"
        }
      ],
      "estimatedHours": 12,
      "pros": ["Familiar stack", "Proven pattern"],
      "cons": ["Requires Redis"]
    }
  ]
}
```

---

### `POST /github-patterns/invalidate`

Clear cache to force re-analysis.

```bash
curl -X POST http://localhost:8787/github-patterns/invalidate \
  -d '{"username": "hsynalv"}'
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `github_analyze_patterns` | Analyze repos and cache patterns |
| `github_get_architecture_options` | Generate options for an idea |

---

## Redis Schema

```
Key: patterns:{username}
TTL: 7 days (configurable)
Value: {
  "username": "hsynalv",
  "patterns": { /* extracted patterns */ },
  "updatedAt": "2026-03-05T10:00:00Z"
}
```

---

## Integration with Project Orchestrator

The orchestrator calls this plugin during the interactive flow:

```javascript
// 1. Get patterns (or analyze if missing)
let patterns = await getCachedPatterns(username);
if (!patterns) {
  const analysis = await fetch('/github-patterns/analyze');
  patterns = analysis.patterns;
}

// 2. Generate architecture options
const options = await fetch('/github-patterns/architecture-options?idea=...');

// 3. Present to user with examples from their repos
```

---

## Troubleshooting

**"No cached patterns found"**
→ Call `/github-patterns/analyze` first

**"Failed to fetch GitHub repos"**
→ Check `GITHUB_TOKEN` is set

**Redis connection error**
→ Verify Redis running: `redis-cli ping`

**Low confidence score**
→ Repos might be too different or too few. Try `repos=10` or specific repos.
