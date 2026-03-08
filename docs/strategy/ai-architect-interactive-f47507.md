# Plan: AI Project Architect with Interactive Approval

Build an AI project planner that learns from user's GitHub repos via Redis-cached patterns, presents architecture options with real examples from user's code, and waits for explicit user approval before generating any code.

---

## Goal

**User says:** "Build me a user authentication service"

**System does:**
1. Analyzes 3-5 recent GitHub repos (cached in Redis)
2. Extracts patterns: stack, architecture, folder structure, coding style
3. AI creates 2-3 architecture proposals with real examples from user's repos
4. **Presents to user:** "In `api-gateway` you used Express+JWT. In `auth-service` you layered controllers/services. Which approach for this project?"
5. User picks/tweaks approach
6. AI creates detailed plan (phases, tasks)
7. User approves plan
8. Only then: Notion project + code generation starts

---

## User Requirements

1. ✅ **Redis caching:** Patterns stored in Redis (persistent, fast, shareable)
2. ✅ **3-5 repos:** Analyze recent 3-5 repos by default
3. ✅ **Interactive discussion:** AI presents options with user's own examples
4. ✅ **Explicit approval:** User approves architecture → then approves plan → then code generates

---

## Architecture Flow

```
1. User: "Build auth service"
            ↓
2. System: Check Redis cache for patterns
   - Cache miss? → Analyze 3-5 GitHub repos → Store in Redis
   - Cache hit? → Use cached patterns
            ↓
3. AI: Create 2-3 architecture proposals
   - "Based on your api-gateway repo..."
   - "Based on your auth-service repo..."
   - "Hybrid approach..."
            ↓
4. Present to User (via chat/UI)
   - Each option shows:
     * Tech stack
     * Folder structure
     * Code snippet from user's repo as example
     * Pros/cons
            ↓
5. User picks option OR says "mix A and B"
            ↓
6. AI: Create detailed phases/tasks
   - Phase 1: Setup (30 min)
   - Phase 2: Core auth (2 hrs)
   ...
            ↓
7. Present plan to user
   - Show Notion tasks preview
   - Show file structure preview
   - Show estimated time
            ↓
8. User approves: "Go ahead"
            ↓
9. Execute:
   - Create Notion project
   - Create tasks
   - Generate first phase code
   - Git init + commit
```

---

## Implementation

### New Plugin: `github-pattern-analyzer`

**File:** `src/plugins/github-pattern-analyzer/index.js`

**Redis Schema:**
```
Key: patterns:{username}
Value: {
  "username": "hsynalv",
  "patterns": { /* extracted patterns */ },
  "analyzedRepos": ["api-gateway", "auth-service", "mcp-hub"],
  "confidence": 0.85,
  "updatedAt": "2026-03-05T10:00:00Z"
}
TTL: 7 days (configurable)
```

**Endpoints:**

```javascript
// GET /github-patterns/analyze
// Force fresh analysis, store in Redis
const result = await analyzeAndCache(username, repos = 5)

// GET /github-patterns/cached
// Get cached patterns (if valid)
const patterns = await getCachedPatterns(username)

// GET /github-patterns/architecture-options?idea={idea}
// Generate 2-3 architecture proposals using cached patterns
const options = await generateArchitectureOptions(idea, patterns)
// Returns: [
//   { name: "Express+JWT (like api-gateway)", patternsUsed: {...}, exampleSnippets: [...] },
//   { name: "FastAPI+OAuth (different)", patternsUsed: {...} }
// ]

// POST /github-patterns/invalidate
// Clear cache (when user wants fresh analysis)
```

**Pattern Extraction Prompt:**
```javascript
const prompt = `Analyze these GitHub repositories and extract architectural patterns.

REPOSITORIES:
${JSON.stringify(repoAnalyses, null, 2)}

Extract and return JSON:
{
  "techStack": {
    "languages": ["TypeScript", "JavaScript"],
    "primaryFramework": "Express.js",
    "secondaryFrameworks": ["Fastify"],
    "databases": ["PostgreSQL", "Redis"],
    "testingFrameworks": ["Vitest", "Supertest"],
    "preferredTools": ["Zod", "Prisma"]
  },
  "architecture": {
    "pattern": "Layered / Clean / Hexagonal",
    "folderStructure": ["src/routes", "src/services", "src/models"],
    "namingConventions": {
      "files": "kebab-case",
      "classes": "PascalCase",
      "functions": "camelCase"
    },
    "codeOrganization": "feature-based / layer-based"
  },
  "codingStyle": {
    "errorHandling": "try-catch with custom errors",
    "validation": "Zod schemas",
    "documentation": "JSDoc for public APIs",
    "asyncStyle": "async/await with explicit returns"
  },
  "examples": {
    "api-gateway": {
      "routeDefinition": "snippet from user's code",
      "servicePattern": "snippet from user's code",
      "errorHandler": "snippet from user's code"
    },
    "auth-service": {
      "authMiddleware": "snippet from user's code"
    }
  }
}`
```

### Enhanced Plugin: `project-orchestrator`

**New Interactive Endpoints:**

```javascript
// Phase 1: Get architecture options
// POST /project-orchestrator/draft
router.post("/draft", async (req, res) => {
  const { idea, username, reposToAnalyze = [] } = req.body
  
  // 1. Get patterns from Redis (or analyze if missing)
  let patterns = await getCachedPatterns(username)
  if (!patterns) {
    patterns = await analyzeAndCache(username, reposToAnalyze.length || 5)
  }
  
  // 2. Generate architecture options
  const options = await generateArchitectureOptions(idea, patterns)
  
  // 3. Store draft state (in Redis or memory) with sessionId
  const draftId = crypto.randomUUID()
  await storeDraft(draftId, { idea, patterns, options, stage: "architecture_selection" })
  
  res.json({
    ok: true,
    draftId,
    stage: "architecture_selection",
    message: "Choose an architecture approach",
    options: options.map(o => ({
      id: o.id,
      name: o.name,
      description: o.description,
      techStack: o.techStack,
      folderStructure: o.folderStructure,
      examplesFromYourRepos: o.exampleSnippets,  // "In api-gateway you did: ..."
      estimatedHours: o.estimatedHours,
      pros: o.pros,
      cons: o.cons
    }))
  })
})

// Phase 2: User selects architecture
// POST /project-orchestrator/draft/:draftId/select-architecture
router.post("/draft/:draftId/select-architecture", async (req, res) => {
  const { optionId, customizations = {} } = req.body
  const draft = await getDraft(req.params.draftId)
  
  // 1. Get selected option
  const selected = draft.options.find(o => o.id === optionId)
  
  // 2. Apply customizations ("use Redis instead of PostgreSQL")
  const finalArchitecture = { ...selected, ...customizations }
  
  // 3. Generate detailed plan
  const plan = await generateDetailedPlan(draft.idea, finalArchitecture)
  
  // 4. Update draft
  draft.selectedArchitecture = finalArchitecture
  draft.plan = plan
  draft.stage = "plan_approval"
  await storeDraft(draft.id, draft)
  
  res.json({
    ok: true,
    draftId: draft.id,
    stage: "plan_approval",
    message: "Review and approve the plan",
    selectedArchitecture: {
      name: finalArchitecture.name,
      techStack: finalArchitecture.techStack,
      folderStructure: finalArchitecture.folderStructure
    },
    plan: {
      title: plan.title,
      description: plan.description,
      estimatedHours: plan.estimatedHours,
      phases: plan.phases.map(p => ({
        name: p.name,
        description: p.description,
        estimatedHours: p.estimatedHours,
        tasks: p.tasks.length,
        keyDeliverables: p.keyDeliverables
      }))
    },
    notionPreview: {
      projectName: plan.title,
      totalTasks: plan.phases.reduce((sum, p) => sum + p.tasks.length, 0),
      phases: plan.phases.map(p => p.name)
    }
  })
})

// Phase 3: User approves and executes
// POST /project-orchestrator/draft/:draftId/execute
router.post("/draft/:draftId/execute", async (req, res) => {
  const { projectId = crypto.randomUUID(), priority = "Medium" } = req.body
  const draft = await getDraft(req.params.draftId)
  
  if (draft.stage !== "plan_approval") {
    return res.status(400).json({ 
      ok: false, 
      error: "Plan not ready for execution" 
    })
  }
  
  // NOW execute the original flow
  const result = await executeFullProjectCreation({
    projectId,
    plan: draft.plan,
    selectedArchitecture: draft.selectedArchitecture,
    priority,
    patterns: draft.patterns
  })
  
  // Clean up draft
  await deleteDraft(draft.id)
  
  res.json({
    ok: true,
    projectId,
    ...result
  })
})
```

**Redis Draft Schema:**
```
Key: draft:{draftId}
Value: {
  id: "uuid",
  idea: "Build auth service",
  username: "hsynalv",
  patterns: {...},
  options: [...],
  selectedArchitecture: {...},
  plan: {...},
  stage: "architecture_selection" | "plan_approval" | "executed",
  createdAt: "2026-03-05T10:00:00Z",
  expiresAt: "2026-03-05T11:00:00Z"  // 1 hour TTL
}
TTL: 1 hour
```

### Modified: `.env.example`

Add Redis and new plugin configs:
```env
# ── Redis (required for pattern caching and draft sessions) ─────────────────
REDIS_URL=redis://localhost:6379
# Pattern cache TTL (days)
PATTERN_CACHE_TTL_DAYS=7
# Draft session TTL (hours)
DRAFT_SESSION_TTL_HOURS=1

# ── github-pattern-analyzer plugin ─────────────────────────────────────────
# Number of repos to analyze (default: 5)
GITHUB_ANALYZE_REPO_COUNT=5
# Minimum confidence threshold to accept patterns (0-1)
PATTERN_CONFIDENCE_THRESHOLD=0.7
```

---

## Discussion Flow Example

### Step 1: Draft Request
```bash
curl -X POST /project-orchestrator/draft \
  -d '{
    "idea": "Build a notification service with email, push, and SMS support",
    "username": "hsynalv"
  }'
```

Response:
```json
{
  "ok": true,
  "draftId": "draft-uuid-123",
  "stage": "architecture_selection",
  "options": [
    {
      "id": "opt-1",
      "name": "Express + Bull Queue (like your api-gateway)",
      "description": "Layered architecture with service layer",
      "techStack": { "framework": "Express", "queue": "Bull/Redis" },
      "examplesFromYourRepos": [
        {
          "repo": "api-gateway",
          "file": "src/services/rate-limiter.js",
          "snippet": "class RateLimiterService { ... }"
        }
      ],
      "estimatedHours": 12
    },
    {
      "id": "opt-2", 
      "name": "FastAPI + Celery (new stack)",
      "description": "Python-based with async task queue",
      "techStack": { "framework": "FastAPI", "queue": "Celery" },
      "examplesFromYourRepos": [],
      "estimatedHours": 16
    }
  ]
}
```

### Step 2: User Selects
```bash
curl -X POST /project-orchestrator/draft/draft-uuid-123/select-architecture \
  -d '{
    "optionId": "opt-1",
    "customizations": {
      "techStack.queue": "BullMQ instead of Bull"
    }
  }'
```

Response shows detailed plan preview.

### Step 3: User Approves
```bash
curl -X POST /project-orchestrator/draft/draft-uuid-123/execute \
  -d '{"priority": "High", "autoExecuteFirstPhase": true}'
```

Now system creates Notion project, tasks, and starts coding.

---

## MCP Tools to Add

| Tool | Description |
|------|-------------|
| `project_create_draft` | Start interactive project planning |
| `project_select_architecture` | Choose architecture approach |
| `project_approve_plan` | Final approval and execution |
| `github_refresh_patterns` | Force re-analysis of GitHub repos |

---

## Frontend/Chat Integration

This flow works best with:
- **Claude Desktop:** Native conversation
- **Custom UI:** Shows cards for each architecture option
- **n8n chat:** Back-and-forth message flow

Example Claude Desktop interaction:
```
User: Build me a notification service

Claude: I'll analyze your GitHub repos to understand your preferred patterns. 
[Calls project_create_draft]

Found your recent work. Based on api-gateway and auth-service, here are 
3 architecture options:

[Option A] Express + Bull Queue (like api-gateway)
You used this pattern in api-gateway/src/services/:
```javascript
class QueueService {
  async enqueue(job) { ... }
}
```
Pros: Familiar stack, proven in your projects
Cons: Requires Redis

[Option B] FastAPI + BackgroundTasks
New stack for you, simpler for this use case

Which approach do you prefer? Or should I combine elements?

User: Option A but use BullMQ instead of Bull

Claude: [Calls project_select_architecture with customizations]
Got it. Here's the detailed plan:

Phase 1: Setup (30 min)
- Initialize Express
- Setup BullMQ
...

Total: 12 hours across 4 phases
Notion project: "Notification Service"
Tasks: 8

Ready to create? (yes/no/modify)

User: yes

Claude: [Calls project_approve_plan]
Created! Notion project ready. Starting Phase 1...
```

---

## Testing Strategy

1. **Unit Tests:**
   - Pattern extraction accuracy
   - Draft state machine
   - Redis key management

2. **Integration Tests:**
   - Full flow: draft → select → execute
   - Cache hit/miss scenarios
   - Draft expiration

3. **E2E Test:**
   - Mock GitHub responses
   - Verify architecture options include real snippets
   - Verify execution only happens after approval

---

## Success Criteria

- [ ] Redis stores patterns with 7-day TTL
- [ ] Draft sessions stored in Redis with 1-hour TTL
- [ ] Architecture options include real code snippets from user's repos
- [ ] 3-step flow enforced: draft → select → approve → execute
- [ ] No code generated before explicit user approval
- [ ] E2E test validates full interactive flow

---

## File Changes

### New Files
1. `src/plugins/github-pattern-analyzer/index.js` - Pattern extraction with Redis
2. `src/plugins/github-pattern-analyzer/README.md` - Documentation
3. `src/core/redis.js` - Shared Redis client (if not exists)

### Modified Files
1. `src/plugins/project-orchestrator/index.js` - Add interactive endpoints
2. `.env.example` - Add Redis and analyzer config
3. `package.json` - Add `ioredis` dependency

---

## Open Questions

1. **Redis dependency:** Acceptable to require Redis for this feature?
2. **Draft persistence:** 1 hour TTL okay? Should be configurable?
3. **UI integration:** Should we provide a simple web UI for the discussion flow, or stick to API/chat?

Ready to implement once confirmed.
