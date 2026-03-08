# Plan: AI Project Architect with GitHub Learning

Enable AI to analyze user's GitHub repositories, learn their coding patterns/architecture, and use that knowledge to plan and build new projects.

---

## Goal

**User says:** "Build me a user authentication service like my other projects"

**System does:**
1. Fetches user's GitHub repos
2. Analyzes 2-3 recent projects for patterns (folder structure, tech stack, coding style)
3. Creates AI context: "User prefers Express + TypeScript, tests in Vitest, structures by feature"
4. Plans new project using those patterns
5. Creates Notion project with phases/tasks
6. Generates code matching user's style
7. Commits to git

---

## Current State Analysis

### What We Have
- `github` plugin: `/github/repos`, `/github/analyze?repo=...` endpoints
- `project-orchestrator`: Creates projects from ideas
- `notion`: Creates projects/tasks
- `workspace`: Writes files
- `git`: Commits changes

### What's Missing
1. **No GitHub pattern extraction** - We can analyze repos but don't extract "user's preferred patterns"
2. **No architecture learning** - Don't compare multiple repos to find commonalities
3. **Orchestrator doesn't use GitHub data** - It plans in isolation, not learning from user's existing code

---

## Implementation Plan

### Phase 1: GitHub Profile Analyzer (New Plugin)

Create `src/plugins/github-profile-analyzer/index.js`

**Purpose:** Analyze user's GitHub profile and extract architectural patterns

**Endpoints:**
- `GET /github-profile/analyze` - Analyze user's repos and return patterns
- `GET /github-profile/patterns` - Get cached patterns
- `POST /github-profile/learn` - Force re-learn from GitHub

**Logic:**
```javascript
// 1. Fetch user's repos (top 5 by recent push)
const repos = await fetch(`/github/repos?sort=pushed&limit=5`)

// 2. Deep analyze each repo
const analyses = await Promise.all(repos.map(r => 
  fetch(`/github/analyze?repo=${r.fullName}`)
))

// 3. Extract patterns with AI
const patterns = await callLLM([{
  role: "system",
  content: `Analyze these repos and extract user's coding patterns:
  - Preferred tech stack (languages, frameworks)
  - Folder structure patterns
  - Testing approach
  - Code style preferences
  - Architecture patterns (MVC, layered, etc.)
  - Documentation habits
  
  Return JSON with structured patterns.`
}, {
  role: "user", 
  content: JSON.stringify(analyses)
}])

// 4. Cache patterns for future use
userPatterns.set(username, patterns)
```

**Output Example:**
```json
{
  "techStack": {
    "primaryLanguage": "TypeScript",
    "framework": "Express.js",
    "testing": "Vitest",
    "database": "PostgreSQL"
  },
  "architecture": {
    "pattern": "Layered",
    "folderStructure": ["src/routes", "src/services", "src/models", "tests"],
    "preferredPatterns": ["Repository pattern", "Dependency injection"]
  },
  "codeStyle": {
    "formatting": "Prettier",
    "linting": "ESLint",
    "naming": "camelCase for vars, PascalCase for classes"
  },
  "documentation": {
    "readme": "Always includes setup instructions",
    "comments": "JSDoc for public APIs"
  }
}
```

### Phase 2: Enhanced Orchestrator with Context

Modify `project-orchestrator` to accept and use GitHub patterns.

**Changes to `POST /project-orchestrator/init`:**
```javascript
const schema = z.object({
  idea: z.string(),
  learnFromGithub: z.boolean().default(true),  // NEW
  reposToAnalyze: z.array(z.string()).optional(),  // NEW: specific repos
  techStack: z.string().optional(),
  ...
})
```

**Enhanced Flow:**
```javascript
// Step 0: Learn from GitHub if enabled
let context = {}
if (parsed.data.learnFromGithub) {
  const patterns = await analyzeGithubProfile()
  context = {
    userPatterns: patterns,
    preferredStack: patterns.techStack,
    folderStructure: patterns.architecture.folderStructure,
  }
}

// Step 1: Analyze idea WITH context
const analysis = await analyzeIdea(idea, { 
  techStack, 
  context  // Pass patterns to AI
})
```

**Enhanced AI Prompt:**
```
You are a technical project planner. Analyze this idea and create a plan.

USER'S CODING PATTERNS (learned from GitHub):
- Preferred stack: {context.preferredStack}
- Folder structure: {context.folderStructure}
- Testing: {context.codeStyle.testing}

IDEA: {idea}

Create a plan that MATCHES the user's existing patterns. 
Use their preferred tech stack and folder structure.
```

### Phase 3: Smart Code Generation

Enhance code generation in orchestrator to use learned patterns.

**Current:** Generic code generation
**New:** Pattern-aware generation

```javascript
async function generateCodeWithPatterns(filePath, task, patterns) {
  const prompt = `Generate code for: ${task.title}

USER'S PATTERNS:
- Language: ${patterns.techStack.primaryLanguage}
- Framework: ${patterns.techStack.framework}
- Naming: ${patterns.codeStyle.naming}
- Architecture: ${patterns.architecture.pattern}

FILE: ${filePath}

Generate code that follows these patterns exactly.
Match the user's coding style from their existing repos.`

  return await callLLM([
    { role: "system", content: "You are an expert programmer who matches existing codebases." },
    { role: "user", content: prompt }
  ])
}
```

### Phase 4: Multi-Repo Learning

Allow specifying which repos to learn from.

**Use Case:** "Build me a service like my 'api-gateway' and 'auth-service' repos"

```bash
curl -X POST /project-orchestrator/init \
  -d '{
    "idea": "Build a notification service",
    "learnFromGithub": true,
    "reposToAnalyze": ["myorg/api-gateway", "myorg/auth-service"],
    "autoExecute": true
  }'
```

---

## Technical Implementation Details

### New Files

1. `src/plugins/github-profile-analyzer/index.js` - Pattern extraction
2. `src/plugins/github-profile-analyzer/README.md` - Documentation

### Modified Files

1. `src/plugins/project-orchestrator/index.js` - Add GitHub learning integration
2. `.env.example` - Add `GITHUB_PATTERN_CACHE_TTL` option

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User Request   │────▶│  GitHub Profile  │────▶│  Pattern Store  │
│ "Build auth    │     │  Analyzer        │     │  (in-memory)    │
│  service"      │     │  (/github/*)     │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│  Orchestrator   │◀──────────────────────────│  Pattern Inject │
│  (/init)        │                           │  (context)      │
│                 │                           │                 │
│  analyzeIdea()  │                           │  "User prefers  │
│  with context   │                           │  Express+TS"    │
└────────┬────────┘                           └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  AI Planning    │────▶│  Notion + Code  │
│  (pattern-aware)│     │  (user's style) │
└─────────────────┘     └─────────────────┘
```

---

## API Changes

### New Endpoint: `GET /github-profile/analyze`

```bash
curl http://localhost:8787/github-profile/analyze
```

Response:
```json
{
  "ok": true,
  "patterns": {
    "techStack": { "primaryLanguage": "TypeScript", "framework": "Express" },
    "architecture": { "pattern": "Layered", "folderStructure": [...] },
    "confidence": 0.85
  },
  "analyzedRepos": 3
}
```

### Modified Endpoint: `POST /project-orchestrator/init`

New options:
```json
{
  "idea": "...",
  "learnFromGithub": true,
  "reposToAnalyze": ["owner/repo1", "owner/repo2"]
}
```

---

## MCP Tools to Add

| Tool | Description |
|------|-------------|
| `github_analyze_profile` | Extract patterns from user's repos |
| `project_init_with_context` | Create project using learned patterns |

---

## Testing Strategy

1. **Unit Tests:**
   - Pattern extraction from mock GitHub data
   - Prompt generation with context
   - Code generation with style matching

2. **E2E Test:**
   - Create test GitHub account with sample repos
   - Call `/github-profile/analyze`
   - Verify patterns match expected
   - Call `/project-orchestrator/init` with `learnFromGithub: true`
   - Verify generated code matches patterns

---

## Open Questions for User

1. **Pattern Storage:** Cache in memory (simple, lost on restart) or Redis (persistent)?
2. **Privacy:** Should patterns be per-user or global? (If multi-user setup)
3. **Specificity:** How many repos to analyze by default? (suggest: 3-5 recent)
4. **Override:** Should user be able to override learned patterns in the request?

---

## Success Criteria

- [ ] `/github-profile/analyze` returns structured patterns
- [ ] `learnFromGithub: true` uses patterns in planning
- [ ] Generated code matches user's existing style
- [ ] File structure matches user's preference
- [ ] E2E test passes: idea → analyzed repos → Notion project → code matching style

---

## Estimated Effort

| Phase | Time | Complexity |
|-------|------|------------|
| 1. GitHub Profile Analyzer | 2-3 hrs | Medium |
| 2. Enhanced Orchestrator | 2-3 hrs | Medium |
| 3. Smart Code Generation | 1-2 hrs | Low |
| 4. Multi-Repo Learning | 1 hr | Low |
| 5. Tests & Polish | 2 hrs | Medium |
| **Total** | **8-11 hrs** | **Medium** |

---

## Next Steps

1. Build `github-profile-analyzer` plugin
2. Modify `project-orchestrator` to use patterns
3. Add MCP tools for new capabilities
4. Write E2E test validating full flow
5. Update documentation
