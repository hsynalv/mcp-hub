/**
 * Project Orchestrator Plugin
 *
 * Turns ideas into structured projects:
 *   Idea → AI analysis → Architecture selection → Notion tasks → Code scaffold → Git
 *
 * Three-phase interactive flow:
 *   1. POST /draft                              — create draft, fetch architecture options
 *   2. POST /draft/:id/select-architecture      — pick option, generate detailed plan
 *   3. POST /draft/:id/execute                  — approve & execute (Notion + codebase)
 */

import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { ToolTags, callTool as useTool } from "../../core/tool-registry.js";
import { setDraft, getDraft, deleteDraft, getRedis } from "../../core/redis.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit/index.js";
import { routeTask } from "../llm-router/index.js";
import { validatePathWithinBase } from "../../core/workspace-paths.js";

// ── Metadata ──────────────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "project-orchestrator",
  version: "1.1.0",
  description: "Turn ideas into structured projects: AI planning, Notion tracking, code scaffold, git",
  status: PluginStatus.STABLE,
  risk: RiskLevel.HIGH, // Creates repos, writes files, creates Notion records
  capabilities: ["read", "write"],
  requires: ["OPENAI_API_KEY", "NOTION_API_KEY", "GITHUB_TOKEN", "REDIS_URL"],
  endpoints: [
    { method: "GET",  path: "/project-orchestrator/health",                           description: "Plugin health",                            scope: "read"  },
    { method: "POST", path: "/project-orchestrator/draft",                            description: "Phase 1: create draft + architecture opts", scope: "write" },
    { method: "POST", path: "/project-orchestrator/draft/:id/select-architecture",   description: "Phase 2: select architecture + gen plan",  scope: "write" },
    { method: "POST", path: "/project-orchestrator/draft/:id/execute",               description: "Phase 3: execute approved plan",           scope: "write" },
    { method: "GET",  path: "/project-orchestrator/projects",                        description: "List active projects",                      scope: "read"  },
    { method: "GET",  path: "/project-orchestrator/projects/:id",                    description: "Get project details",                       scope: "read"  },
    { method: "POST", path: "/project-orchestrator/projects/:id/execute",            description: "Execute next pending task",                 scope: "write" },
    { method: "POST", path: "/project-orchestrator/repo",                            description: "Create GitHub repository",                  scope: "write" },
    { method: "POST", path: "/project-orchestrator/structure",                       description: "Generate project folder structure",         scope: "write" },
    { method: "POST", path: "/project-orchestrator/tasks",                           description: "Create project task breakdown",             scope: "write" },
    { method: "POST", path: "/project-orchestrator/code",                            description: "Generate initial code for a component",     scope: "write" },
    { method: "POST", path: "/project-orchestrator/pr",                              description: "Open pull request on GitHub",               scope: "write" },
  ],
  examples: [
    'POST /project-orchestrator/draft  body: {"idea":"Build notification service","username":"hsynalv"}',
    'POST /project-orchestrator/draft/:id/execute  body: {"autoExecuteFirstPhase":true}',
  ],
});

export const name         = metadata.name;
export const version      = metadata.version;
export const description  = metadata.description;
export const capabilities = metadata.capabilities;
export const requires     = metadata.requires;
export const endpoints    = metadata.endpoints;
export const examples     = metadata.examples;

// ── Config ────────────────────────────────────────────────────────────────────

const NOTION_TASK_DB_ID = process.env.NOTION_TASK_DATABASE_ID || null;

/** Allowed base for AI-generated file writes. Override with WORKSPACE_BASE env var. */
const WORKSPACE_BASE = resolve(process.env.WORKSPACE_BASE || process.cwd());

const pluginError = createPluginErrorHandler("project-orchestrator");

// ── Audit helper ─────────────────────────────────────────────────────────────

function orchAudit(req, action, details = {}) {
  return auditLog({
    plugin:    "project-orchestrator",
    action,
    userId:    req?.headers?.["x-user-id"] || "anonymous",
    projectId: req?.headers?.["x-project-id"] || null,
    details,
    risk:      RiskLevel.HIGH,
  });
}

// ── Redis project store ───────────────────────────────────────────────────────

const PROJECT_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

async function getProject(projectId) {
  const client = getRedis();
  const raw = await client.get(`orch:project:${projectId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setProject(projectId, project) {
  const client = getRedis();
  await client.setex(`orch:project:${projectId}`, PROJECT_TTL_SECONDS, JSON.stringify(project));
}

async function listProjects() {
  const client = getRedis();
  const keys   = await client.keys("orch:project:*");
  if (!keys.length) return [];
  const raws   = await client.mget(...keys);
  return raws.filter(Boolean).map(r => JSON.parse(r));
}

// ── Spec store (Kiro-style spec-first: write spec then plan from spec) ───────────

const SPEC_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

async function getSpec(specId) {
  const client = getRedis();
  const raw = await client.get(`orch:spec:${specId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setSpec(specId, spec) {
  const client = getRedis();
  await client.setex(`orch:spec:${specId}`, SPEC_TTL_SECONDS, JSON.stringify(spec));
}

// ── Path safety for AI-generated file paths ───────────────────────────────────

/**
 * Validate AI-generated path within base. Uses central workspace-paths module.
 * @param {string} base - Absolute base directory
 * @param {string} aiPath - Path relative to base
 * @returns {string} Resolved absolute path
 */
function safeWorkspacePath(base, aiPath) {
  const result = validatePathWithinBase(aiPath, base);
  if (!result.valid) {
    const err = new Error(result.reason || "Path escapes workspace boundary");
    err.code = result.error || "path_traversal";
    throw err;
  }
  return result.resolvedPath;
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

function parseJSON(raw, fallback = null) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : fallback;
  } catch {
    return fallback;
  }
}

async function analyzeIdea(idea, options = {}) {
  const prompt = `You are a technical project planner. Analyze this idea and break it into structured phases.

IDEA: ${idea}
${options.techStack   ? `\nPreferred tech stack: ${options.techStack}`  : ""}
${options.constraints ? `\nConstraints: ${options.constraints}`         : ""}

Return ONLY valid JSON (no markdown):
{
  "title": "Project title",
  "description": "Brief description",
  "complexity": "simple|medium|complex",
  "estimatedHours": 0,
  "phases": [
    {
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "order": 1,
      "tasks": [
        {
          "title": "Task title",
          "description": "Task details",
          "type": "setup|code|test|docs|deploy",
          "estimatedMinutes": 60,
          "targetFile": "src/index.js"
        }
      ]
    }
  ],
  "filesToCreate": ["src/index.js"],
  "dependencies": ["express"]
}

Focus on MVP. Include 3-5 phases max.`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 3000 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const plan = parseJSON(result.content);
  if (!plan) return { ok: false, error: { code: "parse_error", message: "Failed to parse AI plan" } };
  return { ok: true, plan };
}

/**
 * Write a detailed specification document for a task (Kiro spec-first).
 * Returns specId for use with project_plan_from_spec.
 */
async function writeSpecDocument(task, context = {}, outputFormat = "markdown") {
  const contextStr = typeof context === "object" && context !== null
    ? Object.entries(context).map(([k, v]) => `${k}: ${v}`).join("\n")
    : String(context);

  const prompt = `You are a technical spec author. Write a detailed specification for the following task.

TASK: ${task}
${contextStr ? `\nCONTEXT:\n${contextStr}` : ""}

The spec should include:
- Goals and scope
- Key requirements (functional and non-functional)
- Endpoints/APIs or modules (if applicable)
- Security and validation considerations
- Acceptance criteria

Return the spec as ${outputFormat === "structured" ? "valid JSON: { \"title\": \"...\", \"sections\": [{ \"heading\": \"...\", \"content\": \"...\" }], \"acceptanceCriteria\": [] }" : "markdown text (no code fence around the whole response)."}`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 4000 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const spec = {
    task,
    context: contextStr,
    outputFormat,
    content: result.content,
    createdAt: new Date().toISOString(),
  };
  const specId = crypto.randomUUID();
  await setSpec(specId, spec);
  return { ok: true, specId, spec };
}

/**
 * Generate an implementation plan from a stored spec (Kiro plan-from-spec).
 */
async function planFromSpecDocument(specId) {
  const spec = await getSpec(specId);
  if (!spec) return { ok: false, error: { code: "spec_not_found", message: `Spec ${specId} not found or expired` } };

  const prompt = `You are a technical project planner. Given the following specification, produce an implementation plan.

SPECIFICATION (task: ${spec.task}):
${spec.content}

Return ONLY valid JSON (no markdown):
{
  "title": "Project/spec title",
  "description": "Brief description",
  "complexity": "simple|medium|complex",
  "estimatedHours": 0,
  "phases": [
    {
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "order": 1,
      "tasks": [
        {
          "title": "Task title",
          "description": "Task details",
          "type": "setup|code|test|docs|deploy",
          "estimatedMinutes": 60,
          "targetFile": "path/to/file.js"
        }
      ]
    }
  ],
  "filesToCreate": ["src/index.js"],
  "dependencies": []
}

Focus on MVP. Include 3-5 phases. Match the spec's requirements and acceptance criteria.`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 3000 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const plan = parseJSON(result.content);
  if (!plan) return { ok: false, error: { code: "parse_error", message: "Failed to parse plan from spec" } };
  return { ok: true, plan, specId };
}

async function generateDetailedPlanWithPatterns(idea, selectedArchitecture, patterns) {
  const prompt = `Create a detailed project plan based on this idea and selected architecture.

IDEA: ${idea}

SELECTED ARCHITECTURE:
${JSON.stringify(selectedArchitecture, null, 2)}

${patterns ? `USER'S PATTERNS (from GitHub):\n${JSON.stringify(patterns, null, 2)}` : ""}

Return ONLY valid JSON (no markdown):
{
  "title": "Project title",
  "description": "Brief description",
  "estimatedHours": 0,
  "phases": [
    {
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "estimatedHours": 4,
      "keyDeliverables": ["deliverable 1"],
      "tasks": [
        {
          "title": "Task title",
          "description": "Detailed task description",
          "type": "setup|code|test|docs|deploy",
          "estimatedMinutes": 60,
          "targetFile": "src/index.js"
        }
      ]
    }
  ],
  "filesToCreate": ["src/index.js"],
  "dependencies": ["express"],
  "devDependencies": ["vitest"]
}

Include 3-5 phases. Match the user's folder structure and naming conventions.`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 3000 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const plan = parseJSON(result.content);
  if (!plan) return { ok: false, error: { code: "parse_error", message: "Failed to parse AI plan" } };
  return { ok: true, plan };
}

// ── Notion integration ────────────────────────────────────────────────────────

async function createProjectInNotion(plan, options = {}) {
  // Create the project page in Notion (under configured parent or workspace root)
  const projectResult = await useTool("notion_create_page", {
    parentId: process.env.NOTION_PROJECTS_PAGE_ID || undefined,
    title:    plan.title,
    content:  `${plan.description}\n\n**Complexity:** ${plan.complexity || "medium"}\n**Estimated Hours:** ${plan.estimatedHours || "?"}\n**Priority:** ${options.priority || "Medium"}`,
  });

  if (!projectResult?.ok) {
    return { ok: false, error: { code: "notion_error", message: "Failed to create project page in Notion" } };
  }

  const notionProjectId = projectResult.data?.id;
  const createdTasks    = [];

  // Create tasks for each phase
  if (NOTION_TASK_DB_ID) {
    for (const phase of plan.phases || []) {
      for (const task of phase.tasks || []) {
        const taskResult = await useTool("notion_create_task", {
          databaseId: NOTION_TASK_DB_ID,
          name:       `[${phase.name}] ${task.title}`,
          status:     "Todo",
          priority:   "Medium",
        });

        createdTasks.push({
          ...task,
          notionTaskId: taskResult?.data?.id || null,
          phase:        phase.name,
        });
      }
    }
  } else {
    // No task database configured — still include tasks without Notion IDs
    for (const phase of plan.phases || []) {
      for (const task of phase.tasks || []) {
        createdTasks.push({ ...task, notionTaskId: null, phase: phase.name });
      }
    }
  }

  return { ok: true, notionProjectId, tasks: createdTasks, phases: plan.phases?.length ?? 0, totalTasks: createdTasks.length };
}

// ── Codebase initialization ───────────────────────────────────────────────────

async function initializeCodebase(projectId, plan, workspacePath) {
  const base    = resolve(workspacePath || join(WORKSPACE_BASE, projectId));
  const results = [];

  for (const filePath of (plan.filesToCreate || []).slice(0, 5)) {
    try {
      const safePath = safeWorkspacePath(base, filePath);
      const dir      = resolve(safePath, "..");
      await mkdir(dir, { recursive: true });

      // Generate starter content via LLM
      const prompt = `Generate minimal starter code for the file: ${filePath}
Project: ${plan.title}
Description: ${plan.description}
Return ONLY the code, no explanations.`;

      let content = `// ${filePath}\n// TODO: implement\n`;
      try {
        const llmResult = await routeTask("backend_api", prompt, { maxTokens: 1000, temperature: 0.2 });
        content = llmResult.content;
      } catch { /* use placeholder */ }

      await writeFile(safePath, content, "utf8");
      results.push({ type: "file", path: filePath, ok: true });
    } catch (err) {
      results.push({ type: "file", path: filePath, ok: false, error: err.message });
    }
  }

  return { ok: true, results };
}

// ── Task execution ────────────────────────────────────────────────────────────

async function executeTask(projectId, task, context = {}) {
  const results = [];

  try {
    switch (task.type) {
      case "setup": {
        const initResult = await initializeCodebase(projectId, context.plan);
        results.push({ step: "setup", ...initResult });
        break;
      }

      case "code": {
        if (task.targetFile) {
          const base     = join(WORKSPACE_BASE, projectId);
          const safePath = safeWorkspacePath(base, task.targetFile);
          const dir      = resolve(safePath, "..");
          await mkdir(dir, { recursive: true });

          const prompt = `Generate code for: ${task.title}\nDescription: ${task.description}\nProject: ${context.plan?.title}\nReturn only the code.`;
          const llmResult = await routeTask("backend_api", prompt, { maxTokens: 2000, temperature: 0.2 });
          await writeFile(safePath, llmResult.content, "utf8");
          results.push({ step: "code", file: task.targetFile, ok: true });
        }
        break;
      }

      case "test": {
        const shellResult = await useTool("shell_execute", {
          command:     "npm test -- --run 2>&1 | tail -20",
          cwd:         join(WORKSPACE_BASE, projectId),
          explanation: `Running tests for project ${projectId} task: ${task.title}`,
        });
        results.push({ step: "test", ...shellResult });
        break;
      }

      case "docs": {
        const prompt = `Generate README.md for:\nTitle: ${context.plan?.title}\nDescription: ${context.plan?.description}\nReturn markdown content.`;
        const llmResult = await routeTask("documentation", prompt, { maxTokens: 1500 });
        const base      = join(WORKSPACE_BASE, projectId);
        const readmePath = safeWorkspacePath(base, "README.md");
        await writeFile(readmePath, llmResult.content, "utf8");
        results.push({ step: "docs", ok: true });
        break;
      }

      default:
        results.push({ step: task.type, ok: false, error: "Unknown task type" });
    }

    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: { code: "execution_error", message: err.message }, results };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = Router();

// ── Health ────────────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  const llmOk    = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const notionOk = !!process.env.NOTION_API_KEY;
  const githubOk = !!process.env.GITHUB_TOKEN;
  const redisOk  = !!process.env.REDIS_URL;

  const healthy = llmOk && notionOk;
  res.status(healthy ? 200 : 503).json({
    ok:      healthy,
    status:  healthy ? "healthy" : "degraded",
    plugin:  name,
    version,
    checks: {
      llm:           llmOk    ? "configured" : "missing LLM key",
      notion:        notionOk ? "configured" : "missing NOTION_API_KEY",
      github:        githubOk ? "configured" : "missing GITHUB_TOKEN",
      redis:         redisOk  ? "configured" : "missing REDIS_URL",
      taskDatabase:  NOTION_TASK_DB_ID ? "configured" : "missing NOTION_TASK_DATABASE_ID",
      workspaceBase: WORKSPACE_BASE,
    },
  });
});

// ── Phase 1: Draft ────────────────────────────────────────────────────────────

const draftSchema = z.object({
  idea:           z.string().min(10),
  username:       z.string().optional(),
  priority:       z.enum(["Low", "Medium", "High"]).optional(),
  techStack:      z.string().optional(),
  constraints:    z.string().optional(),
});

router.post("/draft", async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const { idea, username, priority, techStack, constraints } = parsed.data;

  // Try to get architecture options from github-pattern-analyzer
  let patterns       = null;
  let patternsSource = "none";
  let options        = [];

  if (username) {
    // Get cached patterns (or run fresh analysis)
    const cacheResult = await useTool("github_get_architecture_options", { idea, username }).catch(() => null);
    if (cacheResult?.ok && cacheResult.options) {
      options        = cacheResult.options;
      patternsSource = "cached";
    } else {
      // Try fresh analysis
      const analysisResult = await useTool("github_analyze_patterns", { repos: 5 }).catch(() => null);
      if (analysisResult?.ok) {
        patternsSource = "fresh";
        patterns       = analysisResult.patterns;

        const optResult = await useTool("github_get_architecture_options", { idea, username }).catch(() => null);
        if (optResult?.ok) options = optResult.options || [];
      }
    }
  }

  // Create draft in Redis
  const draftId = crypto.randomUUID();
  const draft   = {
    id: draftId, idea, username, patterns, patternsSource, options, priority, techStack, constraints,
    stage: "architecture_selection",
    createdAt: new Date().toISOString(),
  };
  await setDraft(draftId, draft);

  await orchAudit(req, "create_draft", { draftId, idea: idea.slice(0, 100), username, patternsSource });

  res.json({
    ok: true,
    draftId,
    stage:            "architecture_selection",
    idea,
    patternsAvailable: !!patterns,
    patternsSource,
    message: options.length
      ? "Choose an architecture approach based on your GitHub patterns"
      : "No GitHub patterns found. Provide a custom plan or proceed with generic analysis.",
    options: options.map(o => ({
      id: o.id, name: o.name, description: o.description,
      techStack: o.techStack, folderStructure: o.folderStructure,
      estimatedHours: o.estimatedHours, pros: o.pros, cons: o.cons,
    })),
    nextStep: options.length
      ? `POST /project-orchestrator/draft/${draftId}/select-architecture`
      : `POST /project-orchestrator/draft/${draftId}/execute (will use generic analysis)`,
  });
});

// ── Phase 2: Select Architecture ──────────────────────────────────────────────

const selectSchema = z.object({
  optionId:       z.string().optional(),
  customizations: z.record(z.any()).optional(),
});

router.post("/draft/:draftId/select-architecture", async (req, res) => {
  const parsed = selectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const draft = await getDraft(req.params.draftId);
  if (!draft) return res.status(404).json({ ok: false, error: { message: "Draft not found or expired" } });

  const { optionId, customizations = {} } = parsed.data;

  const selectedOption   = draft.options.find(o => o.id === optionId);
  if (optionId && !selectedOption) {
    return res.status(400).json({ ok: false, error: { message: "Invalid option ID" } });
  }

  const finalArchitecture = selectedOption
    ? { ...selectedOption, ...customizations, selectedOptionId: optionId }
    : { name: "Custom", ...customizations };

  const planResult = await generateDetailedPlanWithPatterns(draft.idea, finalArchitecture, draft.patterns);
  if (!planResult.ok) return res.status(500).json(pluginError.external(planResult.error?.message || "Plan generation failed", planResult.error));

  draft.selectedArchitecture = finalArchitecture;
  draft.plan  = planResult.plan;
  draft.stage = "plan_approval";
  await setDraft(draft.id, draft);

  await orchAudit(req, "select_architecture", { draftId: draft.id, architecture: finalArchitecture.name });

  res.json({
    ok: true, draftId: draft.id, stage: "plan_approval",
    message: "Review and approve the plan",
    selectedArchitecture: { name: finalArchitecture.name, techStack: finalArchitecture.techStack },
    plan: {
      title:        planResult.plan.title,
      description:  planResult.plan.description,
      estimatedHours: planResult.plan.estimatedHours,
      totalTasks:   planResult.plan.phases?.reduce((s, p) => s + p.tasks.length, 0) ?? 0,
      phases:       planResult.plan.phases?.map(p => ({
        name: p.name, description: p.description,
        estimatedHours: p.estimatedHours, tasks: p.tasks.length,
        keyDeliverables: p.keyDeliverables,
      })) ?? [],
    },
    nextStep: `POST /project-orchestrator/draft/${draft.id}/execute`,
  });
});

// ── Phase 3: Execute ──────────────────────────────────────────────────────────

const executeSchema = z.object({
  projectId:            z.string().optional(),
  priority:             z.enum(["Low", "Medium", "High"]).optional(),
  autoExecuteFirstPhase: z.boolean().optional(),
});

router.post("/draft/:draftId/execute", async (req, res) => {
  const parsed = executeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const draft = await getDraft(req.params.draftId);
  if (!draft) return res.status(404).json({ ok: false, error: { message: "Draft not found or expired" } });

  if (!draft.plan) {
    // Skip architecture selection — generate generic plan
    const planResult = await analyzeIdea(draft.idea, { techStack: draft.techStack, constraints: draft.constraints });
    if (!planResult.ok) return res.status(500).json(pluginError.external(planResult.error?.message || "Plan generation failed"));
    draft.plan             = planResult.plan;
    draft.selectedArchitecture = { name: "AI Generated" };
  }

  const { projectId = crypto.randomUUID(), priority = draft.priority || "Medium", autoExecuteFirstPhase = false } = parsed.data;

  // Create in Notion
  const notionResult = await createProjectInNotion(draft.plan, { priority });
  if (!notionResult.ok) return res.status(500).json({ ok: false, step: "notion", error: notionResult.error });

  // Initialize codebase
  const workspaceResult = await initializeCodebase(projectId, draft.plan);

  // Persist project to Redis
  const project = {
    id: projectId,
    title:              draft.plan.title,
    plan:               draft.plan,
    selectedArchitecture: draft.selectedArchitecture,
    notionProjectId:    notionResult.notionProjectId,
    tasks:              notionResult.tasks,
    status:             "initialized",
    createdAt:          new Date().toISOString(),
  };
  await setProject(projectId, project);

  // Optionally auto-execute first task
  let autoExecResult = null;
  if (autoExecuteFirstPhase && notionResult.tasks.length > 0) {
    const firstTask = notionResult.tasks[0];
    autoExecResult  = await executeTask(projectId, firstTask, { plan: draft.plan });
  }

  await deleteDraft(draft.id);
  await orchAudit(req, "execute_project", {
    projectId, title: draft.plan.title,
    notionProjectId: notionResult.notionProjectId,
    totalTasks: notionResult.totalTasks,
    autoExecuted: autoExecuteFirstPhase,
  });

  res.json({
    ok: true, projectId,
    title:          draft.plan.title,
    notionProjectId: notionResult.notionProjectId,
    phases:          notionResult.phases,
    tasks:           notionResult.totalTasks,
    filesInitialized: workspaceResult.results?.length ?? 0,
    autoExecuted:   autoExecuteFirstPhase ? (autoExecResult?.ok ?? false) : null,
    message: `Project "${draft.plan.title}" created with ${notionResult.totalTasks} tasks. Architecture: ${draft.selectedArchitecture?.name || "AI Generated"}`,
  });
});

// ── Project management routes ─────────────────────────────────────────────────

router.get("/projects", async (_req, res) => {
  const projects = await listProjects();
  res.json({
    ok: true,
    projects: projects.map(p => ({
      id: p.id, title: p.title, status: p.status,
      phases: p.plan?.phases?.length ?? 0, tasks: p.tasks?.length ?? 0,
      notionProjectId: p.notionProjectId, createdAt: p.createdAt,
    })),
  });
});

router.get("/projects/:id", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: { message: "Project not found" } });
  res.json({ ok: true, project });
});

router.post("/projects/:id/execute", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: { message: "Project not found" } });

  const pending = (project.tasks || []).find(t => !t.status || t.status === "Not Started");
  if (!pending) return res.json({ ok: true, message: "All tasks completed", done: true });

  const result = await executeTask(project.id, pending, { plan: project.plan });
  pending.status = result.ok ? "Done" : "Blocked";
  await setProject(project.id, project);

  res.json({
    ok:        result.ok,
    task:      pending.title,
    results:   result.results,
    remaining: project.tasks.filter(t => !t.status || t.status === "Not Started").length,
  });
});

// ── Utility routes (delegate to MCP tool handlers) ────────────────────────────

router.post("/repo",      async (req, res) => { res.json(await useTool("project_create_repo",      req.body || {}, { method: req.method, requestId: req.requestId, projectId: req.projectId, workspaceId: req.workspaceId, source: "rest" })); });
router.post("/structure", async (req, res) => { res.json(await useTool("project_generate_structure", req.body || {}, { method: req.method, requestId: req.requestId, projectId: req.projectId, workspaceId: req.workspaceId, source: "rest" })); });
router.post("/tasks",     async (req, res) => { res.json(await useTool("project_create_tasks",      req.body || {}, { method: req.method, requestId: req.requestId, projectId: req.projectId, workspaceId: req.workspaceId, source: "rest" })); });
router.post("/code",      async (req, res) => { res.json(await useTool("project_generate_code",      req.body || {}, { method: req.method, requestId: req.requestId, projectId: req.projectId, workspaceId: req.workspaceId, source: "rest" })); });
router.post("/pr",        async (req, res) => { res.json(await useTool("project_open_pr",            req.body || {}, { method: req.method, requestId: req.requestId, projectId: req.projectId, workspaceId: req.workspaceId, source: "rest" })); });

export function register(app) {
  app.use("/project-orchestrator", router);
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "project_write_spec",
    description: "Write a detailed specification document before implementation (Kiro spec-first). Use when the task is complex or ambiguous. Returns specId for project_plan_from_spec.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        task:        { type: "string", description: "Task or feature to specify (e.g. 'Add auth to the API')" },
        context:     { type: "object", description: "Optional context (tech stack, constraints, existing modules)" },
        outputFormat: { type: "string", enum: ["markdown", "structured"], default: "markdown", description: "Spec format" },
        explanation: { type: "string", description: "Why you're writing this spec" },
      },
      required: ["task"],
    },
    handler: async ({ task, context = {}, outputFormat = "markdown", explanation }, ctx = {}) => {
      const result = await writeSpecDocument(task, context, outputFormat);
      if (!result.ok) return result;
      await auditLog({
        plugin: "project-orchestrator",
        action: "project_write_spec",
        userId: ctx.actor ?? "mcp-agent",
        details: { specId: result.specId, task: task.slice(0, 100), ...(explanation && { reason: explanation }) },
        risk: RiskLevel.HIGH,
      }).catch(() => {});
      return {
        ok: true,
        data: { specId: result.specId, spec: result.spec, explanation },
      };
    },
  },
  {
    name: "project_plan_from_spec",
    description: "Generate an implementation plan from a previously written spec (specId from project_write_spec). Returns phases and tasks ready for execution or project_init.",
    tags: [ToolTags.READ, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        specId:      { type: "string", description: "Spec ID from project_write_spec" },
        explanation: { type: "string", description: "Why you need a plan from this spec" },
      },
      required: ["specId"],
    },
    handler: async ({ specId, explanation }) => {
      const result = await planFromSpecDocument(specId);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          specId,
          plan: result.plan,
          phases: result.plan.phases?.map(p => ({ name: p.name, description: p.description, taskCount: p.tasks?.length ?? 0 })) ?? [],
          explanation,
        },
      };
    },
  },
  {
    name: "project_init",
    description: "Create a new project from an idea. Analyzes the idea with AI, creates a Notion project page with phases and tasks, and initializes the codebase scaffold.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        idea:        { type: "string",  description: "The project idea/description" },
        techStack:   { type: "string",  description: "Preferred technologies (optional)" },
        priority:    { type: "string",  enum: ["Low", "Medium", "High"] },
        autoExecute: { type: "boolean", description: "Auto-start first phase" },
      },
      required: ["idea"],
    },
    handler: async (args) => {
      const result = await analyzeIdea(args.idea, { techStack: args.techStack });
      if (!result.ok) return result;

      const notionResult = await createProjectInNotion(result.plan, { priority: args.priority });
      if (!notionResult.ok) return notionResult;

      const projectId = crypto.randomUUID();
      await setProject(projectId, {
        id: projectId, title: result.plan.title, plan: result.plan,
        notionProjectId: notionResult.notionProjectId, tasks: notionResult.tasks,
        status: "initialized", createdAt: new Date().toISOString(),
      });

      await auditLog({ plugin: "project-orchestrator", action: "project_init", userId: "mcp-agent", details: { projectId, title: result.plan.title }, risk: RiskLevel.HIGH });

      return {
        ok: true, projectId,
        title:      result.plan.title,
        phases:     result.plan.phases?.map(p => p.name) ?? [],
        totalTasks: notionResult.totalTasks,
      };
    },
  },
  {
    name: "project_execute_next",
    description: "Execute the next pending task in a project (code generation, test run, docs).",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID (from project_init)" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      const project = await getProject(args.projectId);
      if (!project) return { ok: false, error: { message: "Project not found" } };

      const pending = (project.tasks || []).find(t => !t.status || t.status === "Not Started");
      if (!pending) return { ok: true, done: true, message: "All tasks completed" };

      const result   = await executeTask(args.projectId, pending, { plan: project.plan });
      pending.status = result.ok ? "Done" : "Blocked";
      await setProject(args.projectId, project);
      return result;
    },
  },
  {
    name: "project_create_repo",
    description: "Create a new GitHub repository for the project. Uses GITHUB_TOKEN for auth.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string",  description: "Repository name" },
        description: { type: "string",  description: "Repository description" },
        isPrivate:   { type: "boolean", description: "Private repository", default: false },
        explanation: { type: "string",  description: "Why you're creating this repo" },
      },
      required: ["name", "description", "explanation"],
    },
    handler: async ({ name: repoName, description, isPrivate = false, explanation }) => {
      if (!process.env.GITHUB_TOKEN) {
        return { ok: false, error: { code: "missing_token", message: "GITHUB_TOKEN not configured" } };
      }
      try {
        const response = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            "Authorization": `token ${process.env.GITHUB_TOKEN}`,
            "Accept":        "application/vnd.github.v3+json",
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({ name: repoName, description, private: isPrivate, auto_init: true }),
        });
        const data = await response.json();
        if (!response.ok) return { ok: false, error: { code: "github_error", message: data.message } };
        return { ok: true, data: { name: data.name, fullName: data.full_name, url: data.html_url, cloneUrl: data.clone_url, explanation } };
      } catch (err) {
        return { ok: false, error: { code: "network_error", message: err.message } };
      }
    },
  },
  {
    name: "project_generate_structure",
    description: "Generate project folder structure using AI and write it to disk. Path safety enforced — all files stay within WORKSPACE_BASE.",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        idea:        { type: "string", description: "Project idea/concept" },
        techStack:   { type: "string", description: "Technology stack (e.g. nextjs, python, node)" },
        repoPath:    { type: "string", description: "Local repository path (must be within allowed workspace)" },
        explanation: { type: "string", description: "Why you're generating this structure" },
      },
      required: ["idea", "techStack", "repoPath", "explanation"],
    },
    handler: async ({ idea, techStack, repoPath, explanation }) => {
      const base = resolve(repoPath);
      if (!base.startsWith(WORKSPACE_BASE)) {
        return { ok: false, error: { code: "path_traversal", message: `Path "${repoPath}" is outside allowed workspace` } };
      }

      const prompt = `Generate a minimal project structure for:
Idea: ${idea}
Tech Stack: ${techStack}

Return ONLY valid JSON (no markdown):
{
  "files": [
    { "path": "relative/path/file.js", "content": "file content here" }
  ]
}

Include 3-6 essential files only. Use relative paths.`;

      let result;
      try { result = await routeTask("backend_api", prompt, { maxTokens: 2000, temperature: 0.2 }); }
      catch (err) { return { ok: false, error: { code: "llm_error", message: err.message } }; }

      const parsed = parseJSON(result.content);
      if (!parsed?.files) return { ok: false, error: { code: "parse_error", message: "Could not parse AI structure" } };

      const created = [];
      for (const file of parsed.files) {
        try {
          const safePath = safeWorkspacePath(base, file.path);
          await mkdir(resolve(safePath, ".."), { recursive: true });
          await writeFile(safePath, file.content, "utf8");
          created.push({ path: file.path, ok: true });
        } catch (err) {
          created.push({ path: file.path, ok: false, error: err.message });
        }
      }
      return { ok: true, data: { repoPath, created, explanation } };
    },
  },
  {
    name: "project_create_tasks",
    description: "Generate a task breakdown for a project idea using AI. Returns tasks as markdown, JSON, or a Notion-ready format.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        idea:         { type: "string", description: "Project idea" },
        techStack:    { type: "string", description: "Tech stack" },
        outputFormat: { type: "string", enum: ["markdown", "json", "notion"], default: "markdown" },
        explanation:  { type: "string", description: "Why you're creating these tasks" },
      },
      required: ["idea", "techStack", "explanation"],
    },
    handler: async ({ idea, techStack, outputFormat = "markdown", explanation }) => {
      const prompt = `Create a project task breakdown for:
Idea: ${idea}
Tech Stack: ${techStack}
Format: ${outputFormat}

Cover: 1) Project setup  2) Core features  3) Testing  4) Documentation
Return concise, actionable tasks.`;

      let result;
      try { result = await routeTask("analysis", prompt, { maxTokens: 2000, temperature: 0.3 }); }
      catch (err) { return { ok: false, error: { code: "llm_error", message: err.message } }; }

      return { ok: true, data: { tasks: result.content, format: outputFormat, explanation } };
    },
  },
  {
    name: "project_generate_code",
    description: "Generate initial code for a specific component and write it to the repo. Path safety enforced.",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        idea:        { type: "string", description: "Project idea" },
        techStack:   { type: "string", description: "Tech stack" },
        component:   { type: "string", description: "Specific component to generate (e.g. 'auth middleware', 'user model')" },
        repoPath:    { type: "string", description: "Repository path to write to" },
        explanation: { type: "string", description: "Why you're generating this code" },
      },
      required: ["idea", "techStack", "component", "repoPath", "explanation"],
    },
    handler: async ({ idea, techStack, component, repoPath, explanation }) => {
      const base = resolve(repoPath);
      if (!base.startsWith(WORKSPACE_BASE)) {
        return { ok: false, error: { code: "path_traversal", message: `Path "${repoPath}" is outside allowed workspace` } };
      }

      const prompt = `Generate production-ready code for:
Project: ${idea}
Tech Stack: ${techStack}
Component: ${component}

Return ONLY valid JSON (no markdown):
{ "files": [{ "path": "relative/path.js", "content": "code here" }] }`;

      let result;
      try { result = await routeTask("backend_api", prompt, { maxTokens: 2000, temperature: 0.2 }); }
      catch (err) { return { ok: false, error: { code: "llm_error", message: err.message } }; }

      const parsed = parseJSON(result.content);
      if (!parsed?.files) return { ok: false, error: { code: "parse_error", message: "Could not parse generated code" } };

      const written = [];
      for (const file of parsed.files) {
        try {
          const safePath = safeWorkspacePath(base, file.path);
          await mkdir(resolve(safePath, ".."), { recursive: true });
          await writeFile(safePath, file.content, "utf8");
          written.push({ path: file.path, ok: true });
        } catch (err) {
          written.push({ path: file.path, ok: false, error: err.message });
        }
      }
      return { ok: true, data: { component, files: written, explanation } };
    },
  },
  {
    name: "project_open_pr",
    description: "Open a pull request on GitHub using the github plugin. Requires a feature branch to already exist.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        owner:       { type: "string", description: "Repository owner" },
        repo:        { type: "string", description: "Repository name" },
        title:       { type: "string", description: "PR title" },
        body:        { type: "string", description: "PR description" },
        head:        { type: "string", description: "Feature branch name" },
        base:        { type: "string", description: "Target branch", default: "main" },
        explanation: { type: "string", description: "Why you're opening this PR" },
      },
      required: ["owner", "repo", "title", "body", "head", "explanation"],
    },
    handler: async ({ owner, repo, title, body, head, base = "main", explanation }) => {
      const result = await useTool("github_pr_create", { owner, repo, title, body, head, base });
      if (!result?.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
];
