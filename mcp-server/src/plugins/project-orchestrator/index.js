/**
 * Project Orchestrator Plugin
 * Turns ideas into structured projects with AI planning, Notion tracking, and code execution.
 * 
 * Flow: Idea → AI Analysis → Phases → Notion Tasks → Code → Git Commit
 */

import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { ToolTags } from "../../core/tool-registry.js";
import { createJob } from "../../core/jobs.js";
import { setDraft, getDraft, deleteDraft } from "../../core/redis.js";

// ── Configuration ────────────────────────────────────────────────────────────

const LLM_API_KEY = process.env.OPENAI_API_KEY || null;
const LLM_BASE_URL = process.env.BRAIN_LLM_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.BRAIN_LLM_MODEL || "gpt-4o";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:8787";

// ── Active Projects Store ───────────────────────────────────────────────────

const activeProjects = new Map(); // projectId → project state

// ── LLM Helper ─────────────────────────────────────────────────────────────────

async function callLLM(messages, options = {}) {
  if (!LLM_API_KEY) {
    return { ok: false, error: { code: "llm_not_configured", message: "OPENAI_API_KEY not set" } };
  }

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4000,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { ok: false, error: { code: "llm_error", message: err } };
    }

    const data = await response.json();
    return { ok: true, content: data.choices[0].message.content };
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }
}

// ── Internal Tool Calls ──────────────────────────────────────────────────────

async function callTool(toolName, args) {
  const url = `${MCP_SERVER_URL}/tools/${toolName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return response.json();
}

async function callNotion(endpoint, body) {
  const url = `${MCP_SERVER_URL}/notion${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function callWorkspace(method, endpoint, body) {
  const url = `${MCP_SERVER_URL}/workspace${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

async function callGit(method, endpoint, body) {
  const url = `${MCP_SERVER_URL}/git${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

// ── Core: Idea Analysis ─────────────────────────────────────────────────────

async function analyzeIdea(idea, options = {}) {
  const prompt = `You are a technical project planner. Analyze this idea and break it into structured phases.

IDEA: ${idea}

${options.techStack ? `Preferred tech stack: ${options.techStack}` : ""}
${options.constraints ? `Constraints: ${options.constraints}` : ""}

Analyze and return JSON with this structure:
{
  "title": "Project title",
  "description": "Brief description",
  "complexity": "simple|medium|complex",
  "estimatedHours": number,
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
          "estimatedMinutes": number
        }
      ]
    }
  ],
  "filesToCreate": ["src/...", "tests/..."],
  "dependencies": ["package1", "package2"]
}

Be practical. Focus on MVP first. Include 3-5 phases max.`;

  const result = await callLLM([
    { role: "system", content: "You are an expert software architect and project planner." },
    { role: "user", content: prompt }
  ], { jsonMode: true });

  if (!result.ok) return result;

  try {
    const plan = JSON.parse(result.content);
    return { ok: true, plan };
  } catch (e) {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse AI response" } };
  }
}

// ── Core: Create Project in Notion ────────────────────────────────────────────

async function createProjectInNotion(plan, options = {}) {
  // Create main project
  const projectResult = await callNotion("/projects", {
    name: plan.title,
    description: plan.description,
    status: "In Progress",
    priority: options.priority || "Medium",
  });

  if (!projectResult.ok) {
    return { ok: false, error: { code: "notion_error", message: "Failed to create project" } };
  }

  const projectId = projectResult.data?.id;
  const createdTasks = [];

  // Create tasks for each phase
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const taskResult = await callNotion("/tasks", {
        title: `[${phase.name}] ${task.title}`,
        description: task.description,
        status: "Not Started",
        priority: "Medium",
        projectId: projectId,
        phase: phase.name,
        estimatedMinutes: task.estimatedMinutes,
      });

      if (taskResult.ok) {
        createdTasks.push({
          ...task,
          notionTaskId: taskResult.data?.id,
          phase: phase.name,
        });
      }
    }
  }

  return {
    ok: true,
    projectId,
    notionProjectId: projectId,
    tasks: createdTasks,
    phases: plan.phases.length,
    totalTasks: createdTasks.length,
  };
}

// ── Core: Initialize Codebase ───────────────────────────────────────────────

async function initializeCodebase(projectId, plan, workspacePath) {
  const results = [];

  // Create directories
  const dirs = [...new Set(plan.filesToCreate.map(f => f.split("/").slice(0, -1).join("/")).filter(Boolean))];
  for (const dir of dirs) {
    const result = await callWorkspace("POST", "/dirs", {
      projectId,
      path: dir,
    });
    results.push({ type: "dir", path: dir, ok: result.ok });
  }

  // Create initial files with AI-generated content
  for (const filePath of plan.filesToCreate.slice(0, 3)) { // Limit to first 3 for safety
    const prompt = `Generate starter code for ${filePath}.
Project: ${plan.title}
Description: ${plan.description}

Return only the code, no explanations.`;

    const codeResult = await callLLM([
      { role: "system", content: "You are an expert programmer." },
      { role: "user", content: prompt }
    ]);

    if (codeResult.ok) {
      const writeResult = await callWorkspace("POST", "/files", {
        projectId,
        path: filePath,
        content: codeResult.content,
      });
      results.push({ type: "file", path: filePath, ok: writeResult.ok });
    }
  }

  return { ok: true, results };
}

// ── Core: Execute Task ───────────────────────────────────────────────────────

async function executeTask(projectId, task, context = {}) {
  const results = [];

  // Update Notion task status
  await callNotion("/tasks/update", {
    taskId: task.notionTaskId,
    status: "In Progress",
  });

  try {
    switch (task.type) {
      case "setup":
        // Initialize project structure
        const initResult = await initializeCodebase(projectId, context.plan, context.workspacePath);
        results.push({ step: "setup", ...initResult });
        break;

      case "code":
        // Generate code for this specific task
        const codePrompt = `Generate code for: ${task.title}
Description: ${task.description}
Project context: ${context.plan.title}

Return only the code.`;

        const codeResult = await callLLM([
          { role: "system", content: "You are an expert programmer." },
          { role: "user", content: codePrompt }
        ]);

        if (codeResult.ok && task.targetFile) {
          const writeResult = await callWorkspace("POST", "/files", {
            projectId,
            path: task.targetFile,
            content: codeResult.content,
          });
          results.push({ step: "code", file: task.targetFile, ok: writeResult.ok });
        }
        break;

      case "test":
        // Run tests
        const testResult = await fetch(`${MCP_SERVER_URL}/tests/run?projectId=${projectId}`).then(r => r.json());
        results.push({ step: "test", ...testResult });
        break;

      case "docs":
        // Generate README
        const readmePrompt = `Generate README.md for this project:
Title: ${context.plan.title}
Description: ${context.plan.description}
Files: ${context.plan.filesToCreate.join(", ")}

Return markdown content.`;

        const readmeResult = await callLLM([
          { role: "system", content: "You are a technical writer." },
          { role: "user", content: readmePrompt }
        ]);

        if (readmeResult.ok) {
          await callWorkspace("POST", "/files", {
            projectId,
            path: "README.md",
            content: readmeResult.content,
          });
        }
        results.push({ step: "docs", ok: readmeResult.ok });
        break;
    }

    // Mark task complete
    await callNotion("/tasks/update", {
      taskId: task.notionTaskId,
      status: "Done",
    });

    return { ok: true, results };
  } catch (err) {
    // Mark task failed
    await callNotion("/tasks/update", {
      taskId: task.notionTaskId,
      status: "Blocked",
    });

    return { ok: false, error: { code: "execution_error", message: err.message }, results };
  }
}

// ── Core: Generate Detailed Plan with Patterns ───────────────────────────────

async function generateDetailedPlanWithPatterns(idea, selectedArchitecture, patterns) {
  const prompt = `Create a detailed project plan based on this idea and selected architecture.

IDEA: ${idea}

SELECTED ARCHITECTURE:
${JSON.stringify(selectedArchitecture, null, 2)}

USER'S PATTERNS (from their GitHub repos):
${JSON.stringify(patterns, null, 2)}

Create a detailed plan that follows their patterns. Return JSON:

{
  "title": "Project title",
  "description": "Brief description",
  "estimatedHours": number,
  "phases": [
    {
      "name": "Phase name (e.g., 'Setup', 'Core Implementation')",
      "description": "What this phase accomplishes",
      "estimatedHours": number,
      "keyDeliverables": ["deliverable 1", "deliverable 2"],
      "tasks": [
        {
          "title": "Task title",
          "description": "Detailed task description",
          "type": "setup|code|test|docs|deploy",
          "estimatedMinutes": number,
          "targetFile": "path/to/file.js (optional)"
        }
      ]
    }
  ],
  "filesToCreate": ["src/index.js", "tests/..."],
  "dependencies": ["express", "..."],
  "devDependencies": ["vitest", "..."]
}

Include 3-5 phases. Tasks should be specific and actionable.
Match the user's folder structure and naming conventions from their patterns.`;

  const result = await callLLM([
    { role: "system", content: "You are an expert software architect and project planner." },
    { role: "user", content: prompt }
  ], { jsonMode: true });

  if (!result.ok) return result;

  try {
    const plan = JSON.parse(result.content);
    return { ok: true, plan };
  } catch (e) {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse AI response" } };
  }
}

// ── Express Routes ───────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /project-orchestrator/draft
 * Start interactive project planning - Phase 1: Create draft with architecture options
 */
router.post("/draft", async (req, res) => {
  const schema = z.object({
    idea: z.string().min(10),
    username: z.string().optional(),
    reposToAnalyze: z.array(z.string()).optional(),
    priority: z.enum(["Low", "Medium", "High"]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const { idea, username, reposToAnalyze, priority } = parsed.data;

  // Step 1: Get or create cached patterns
  let patterns = null;
  let patternsSource = "cache";
  
  if (username) {
    const { getCachedPatterns, setCachedPatterns } = await import("../../core/redis.js");
    patterns = await getCachedPatterns(username);
    
    if (!patterns) {
      // Fetch and analyze repos
      const reposUrl = `${MCP_SERVER_URL}/github/repos?sort=pushed&limit=5`;
      const reposRes = await fetch(reposUrl);
      const reposData = await reposRes.json();
      
      if (reposData.ok && reposData.data) {
        const analyses = [];
        for (const repo of reposData.data.slice(0, 5)) {
          const analyzeUrl = `${MCP_SERVER_URL}/github/analyze?repo=${encodeURIComponent(repo.fullName)}`;
          const analyzeRes = await fetch(analyzeUrl);
          const analyzeData = await analyzeRes.json();
          if (analyzeData.ok) analyses.push(analyzeData.data);
        }
        
        // Extract patterns via github-pattern-analyzer
        const patternsUrl = `${MCP_SERVER_URL}/github-patterns/analyze`;
        const patternsRes = await fetch(patternsUrl);
        const patternsData = await patternsRes.json();
        
        if (patternsData.ok) {
          patterns = patternsData.patterns;
          patternsSource = "fresh";
        }
      }
    }
  }

  // Step 2: Get architecture options from analyzer
  let options = [];
  if (patterns) {
    const optionsUrl = `${MCP_SERVER_URL}/github-patterns/architecture-options?idea=${encodeURIComponent(idea)}&username=${username}`;
    const optionsRes = await fetch(optionsUrl);
    const optionsData = await optionsRes.json();
    if (optionsData.ok) {
      options = optionsData.options;
    }
  }

  // Step 3: Create draft in Redis
  const draftId = crypto.randomUUID();
  const draft = {
    id: draftId,
    idea,
    username,
    patterns,
    patternsSource,
    options,
    priority,
    stage: "architecture_selection",
    createdAt: new Date().toISOString(),
  };
  
  await setDraft(draftId, draft);

  res.json({
    ok: true,
    draftId,
    stage: "architecture_selection",
    message: patterns 
      ? "Choose an architecture approach based on your GitHub patterns"
      : "No GitHub patterns found. Proceeding with generic options.",
    idea,
    username,
    patternsAvailable: !!patterns,
    patternsSource,
    options: options.map(o => ({
      id: o.id,
      name: o.name,
      description: o.description,
      techStack: o.techStack,
      folderStructure: o.folderStructure,
      exampleSnippets: o.exampleSnippets,
      estimatedHours: o.estimatedHours,
      pros: o.pros,
      cons: o.cons,
    })),
  });
});

/**
 * POST /project-orchestrator/draft/:draftId/select-architecture
 * Phase 2: User selects architecture and we generate detailed plan
 */
router.post("/draft/:draftId/select-architecture", async (req, res) => {
  const schema = z.object({
    optionId: z.string(),
    customizations: z.record(z.any()).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const draft = await getDraft(req.params.draftId);
  if (!draft) {
    return res.status(404).json({ ok: false, error: { message: "Draft not found or expired" } });
  }

  const { optionId, customizations = {} } = parsed.data;

  // Find selected option
  const selectedOption = draft.options.find(o => o.id === optionId);
  if (!selectedOption) {
    return res.status(400).json({ ok: false, error: { message: "Invalid option ID" } });
  }

  // Merge with customizations
  const finalArchitecture = {
    ...selectedOption,
    ...customizations,
    selectedOptionId: optionId,
  };

  // Generate detailed plan
  const planResult = await generateDetailedPlanWithPatterns(
    draft.idea,
    finalArchitecture,
    draft.patterns
  );

  if (!planResult.ok) {
    return res.status(500).json({ ok: false, error: planResult.error });
  }

  // Update draft
  draft.selectedArchitecture = finalArchitecture;
  draft.plan = planResult.plan;
  draft.stage = "plan_approval";
  await setDraft(draft.id, draft);

  res.json({
    ok: true,
    draftId: draft.id,
    stage: "plan_approval",
    message: "Review and approve the detailed plan",
    selectedArchitecture: {
      name: finalArchitecture.name,
      techStack: finalArchitecture.techStack,
      folderStructure: finalArchitecture.folderStructure,
    },
    plan: {
      title: planResult.plan.title,
      description: planResult.plan.description,
      estimatedHours: planResult.plan.estimatedHours,
      totalTasks: planResult.plan.phases.reduce((sum, p) => sum + p.tasks.length, 0),
      phases: planResult.plan.phases.map(p => ({
        name: p.name,
        description: p.description,
        estimatedHours: p.estimatedHours,
        tasks: p.tasks.length,
        keyDeliverables: p.keyDeliverables,
      })),
    },
    nextStep: "POST /project-orchestrator/draft/:draftId/execute to start execution",
  });
});

/**
 * POST /project-orchestrator/draft/:draftId/execute
 * Phase 3: Execute after user approval
 */
router.post("/draft/:draftId/execute", async (req, res) => {
  const schema = z.object({
    projectId: z.string().optional(),
    priority: z.enum(["Low", "Medium", "High"]).optional(),
    autoExecuteFirstPhase: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const draft = await getDraft(req.params.draftId);
  if (!draft) {
    return res.status(404).json({ ok: false, error: { message: "Draft not found or expired" } });
  }

  if (draft.stage !== "plan_approval") {
    return res.status(400).json({
      ok: false,
      error: { message: `Draft is in stage "${draft.stage}". Complete architecture selection first.` },
    });
  }

  const { projectId = crypto.randomUUID(), priority = draft.priority || "Medium", autoExecuteFirstPhase = false } = parsed.data;

  // Execute the original flow
  const notionResult = await createProjectInNotion(draft.plan, { priority });
  if (!notionResult.ok) {
    return res.status(500).json({ ok: false, step: "notion", error: notionResult.error });
  }

  const workspaceResult = await initializeCodebase(projectId, draft.plan);

  // Store project state
  activeProjects.set(projectId, {
    id: projectId,
    title: draft.plan.title,
    plan: draft.plan,
    selectedArchitecture: draft.selectedArchitecture,
    notionProjectId: notionResult.notionProjectId,
    tasks: notionResult.tasks,
    status: "initialized",
    createdAt: new Date().toISOString(),
  });

  // Auto-execute first phase if requested
  let executionResult = null;
  if (autoExecuteFirstPhase) {
    const firstPhase = draft.plan.phases[0];
    const firstTask = notionResult.tasks.find(t => t.phase === firstPhase.name);
    if (firstTask) {
      executionResult = await executeTask(projectId, firstTask, {
        plan: draft.plan,
        workspacePath: projectId,
      });
    }
  }

  // Clean up draft
  await deleteDraft(draft.id);

  res.json({
    ok: true,
    projectId,
    title: draft.plan.title,
    notionProjectId: notionResult.notionProjectId,
    phases: notionResult.phases,
    tasks: notionResult.totalTasks,
    initialized: workspaceResult.ok,
    autoExecuted: autoExecuteFirstPhase ? executionResult?.ok || false : null,
    message: `Project "${draft.plan.title}" created with ${notionResult.totalTasks} tasks in Notion. Architecture: ${draft.selectedArchitecture.name}`,
  });
});

/**
 * GET /project-orchestrator/projects
 * List active projects
 */
router.get("/projects", async (req, res) => {
  const projects = Array.from(activeProjects.values()).map(p => ({
    id: p.id,
    title: p.title,
    status: p.status,
    phases: p.plan.phases.length,
    tasks: p.tasks.length,
    notionProjectId: p.notionProjectId,
    createdAt: p.createdAt,
  }));

  res.json({ ok: true, projects });
});

/**
 * GET /project-orchestrator/projects/:id
 * Get project details
 */
router.get("/projects/:id", async (req, res) => {
  const project = activeProjects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ ok: false, error: { message: "Project not found" } });
  }

  res.json({
    ok: true,
    project: {
      id: project.id,
      title: project.title,
      description: project.plan.description,
      status: project.status,
      plan: project.plan,
      tasks: project.tasks,
      notionProjectId: project.notionProjectId,
      createdAt: project.createdAt,
    },
  });
});

/**
 * POST /project-orchestrator/projects/:id/execute
 * Execute next pending task
 */
router.post("/projects/:id/execute", async (req, res) => {
  const project = activeProjects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ ok: false, error: { message: "Project not found" } });
  }

  // Find next pending task
  const pendingTask = project.tasks.find(t => !t.status || t.status === "Not Started");
  if (!pendingTask) {
    return res.json({ ok: true, message: "All tasks completed", done: true });
  }

  const result = await executeTask(project.id, pendingTask, {
    plan: project.plan,
    workspacePath: project.id,
  });

  // Update task status in memory
  pendingTask.status = result.ok ? "Done" : "Blocked";

  res.json({
    ok: result.ok,
    task: pendingTask.title,
    results: result.results,
    remaining: project.tasks.filter(t => t.status === "Not Started").length,
  });
});

/**
 * POST /project-orchestrator/projects/:id/commit
 * Commit current changes to git
 */
router.post("/projects/:id/commit", async (req, res) => {
  const schema = z.object({
    message: z.string().optional(),
    branch: z.string().optional(),
    push: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const project = activeProjects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ ok: false, error: { message: "Project not found" } });
  }

  const { message = `Update: ${project.title}`, branch, push = false } = parsed.data;

  // Git operations
  const results = {};

  if (branch) {
    results.branch = await callGit("POST", "/branches", {
      projectId: project.id,
      branch,
      baseBranch: "main",
    });
  }

  results.status = await callGit("GET", `/status?projectId=${project.id}`, null);

  if (results.status.ok && results.status.data?.hasChanges) {
    results.add = await callGit("POST", "/stage", {
      projectId: project.id,
      files: ".",
    });

    results.commit = await callGit("POST", "/commit", {
      projectId: project.id,
      message,
    });

    if (push && results.commit.ok) {
      results.push = await callGit("POST", "/push", {
        projectId: project.id,
        branch: branch || "main",
      });
    }
  }

  res.json({
    ok: true,
    committed: results.commit?.ok || false,
    pushed: results.push?.ok || false,
    results,
  });
});

// New workflow tool endpoints

/**
 * POST /project-orchestrator/repo
 * Create new GitHub repository
 */
router.post("/repo", async (req, res) => {
  const { name, description, isPrivate, template, explanation } = req.body || {};
  if (!name || !description) {
    return res.status(400).json({ ok: false, error: "name and description are required" });
  }

  const tool = tools.find(t => t.name === "project_create_repo");
  const result = await tool.handler({ name, description, isPrivate, template, explanation });
  res.json(result);
});

/**
 * POST /project-orchestrator/structure
 * Generate project folder structure
 */
router.post("/structure", async (req, res) => {
  const { idea, techStack, repoPath, explanation } = req.body || {};
  if (!idea || !techStack || !repoPath) {
    return res.status(400).json({ ok: false, error: "idea, techStack, and repoPath are required" });
  }

  const tool = tools.find(t => t.name === "project_generate_structure");
  const result = await tool.handler({ idea, techStack, repoPath, explanation });
  res.json(result);
});

/**
 * POST /project-orchestrator/tasks
 * Create project tasks
 */
router.post("/tasks", async (req, res) => {
  const { idea, techStack, outputFormat, explanation } = req.body || {};
  if (!idea || !techStack) {
    return res.status(400).json({ ok: false, error: "idea and techStack are required" });
  }

  const tool = tools.find(t => t.name === "project_create_tasks");
  const result = await tool.handler({ idea, techStack, outputFormat, explanation });
  res.json(result);
});

/**
 * POST /project-orchestrator/code
 * Generate initial code
 */
router.post("/code", async (req, res) => {
  const { idea, techStack, component, repoPath, explanation } = req.body || {};
  if (!idea || !techStack || !component || !repoPath) {
    return res.status(400).json({ ok: false, error: "idea, techStack, component, and repoPath are required" });
  }

  const tool = tools.find(t => t.name === "project_generate_code");
  const result = await tool.handler({ idea, techStack, component, repoPath, explanation });
  res.json(result);
});

/**
 * POST /project-orchestrator/pr
 * Open initial PR/issue
 */
router.post("/pr", async (req, res) => {
  const { repo, title, description, branch, explanation } = req.body || {};
  if (!repo || !title || !description) {
    return res.status(400).json({ ok: false, error: "repo, title, and description are required" });
  }

  const tool = tools.find(t => t.name === "project_open_pr");
  const result = await tool.handler({ repo, title, description, branch, explanation });
  res.json(result);
});

// ── Plugin Export ────────────────────────────────────────────────────────────

export const name = "project-orchestrator";
export const version = "1.0.0";
export const description = "Turn ideas into structured projects with AI planning, Notion tracking, and automated code execution";

export function register(app) {
  app.use("/project-orchestrator", router);
}

export const endpoints = [
  // Interactive flow
  { method: "POST", path: "/project-orchestrator/draft", description: "Start interactive planning with architecture options" },
  { method: "POST", path: "/project-orchestrator/draft/:draftId/select-architecture", description: "Select architecture and generate detailed plan" },
  { method: "POST", path: "/project-orchestrator/draft/:draftId/execute", description: "Execute approved plan" },
  // Legacy direct flow
  { method: "POST", path: "/project-orchestrator/init", description: "Initialize project from idea (direct, non-interactive)" },
  { method: "GET", path: "/project-orchestrator/projects", description: "List active projects" },
  { method: "GET", path: "/project-orchestrator/projects/:id", description: "Get project details" },
  { method: "POST", path: "/project-orchestrator/projects/:id/execute", description: "Execute next task" },
  { method: "POST", path: "/project-orchestrator/projects/:id/commit", description: "Commit changes to git" },
  // New workflow tools
  { method: "POST", path: "/project-orchestrator/repo", description: "Create new GitHub repository" },
  { method: "POST", path: "/project-orchestrator/structure", description: "Generate project folder structure" },
  { method: "POST", path: "/project-orchestrator/tasks", description: "Create project tasks" },
  { method: "POST", path: "/project-orchestrator/code", description: "Generate initial code" },
  { method: "POST", path: "/project-orchestrator/pr", description: "Open initial PR/issue" },
];

export const examples = [
  {
    description: "Interactive: Create draft with architecture options",
    request: {
      method: "POST",
      path: "/project-orchestrator/draft",
      body: {
        idea: "Build a notification service with email and push support",
        username: "hsynalv",
        priority: "High",
      },
    },
  },
  {
    description: "Interactive: Select architecture and customize",
    request: {
      method: "POST",
      path: "/project-orchestrator/draft/:draftId/select-architecture",
      body: {
        optionId: "opt-1",
        customizations: {
          "techStack.queue": "BullMQ",
        },
      },
    },
  },
  {
    description: "Interactive: Execute approved plan",
    request: {
      method: "POST",
      path: "/project-orchestrator/draft/:draftId/execute",
      body: {
        autoExecuteFirstPhase: true,
      },
    },
  },
  {
    description: "Direct (legacy): Create project from idea without discussion",
    request: {
      method: "POST",
      path: "/project-orchestrator/init",
      body: {
        idea: "Build a REST API for managing book reviews with authentication",
        techStack: "Node.js, Express, PostgreSQL",
        autoExecute: true,
      },
    },
  },
];

// MCP Tools
export const tools = [
  {
    name: "project_init",
    description: "Create a new project from an idea. Analyzes the idea, creates Notion project with phases and tasks, initializes codebase.",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The project idea/description" },
        techStack: { type: "string", description: "Preferred technologies (optional)" },
        priority: { type: "string", enum: ["Low", "Medium", "High"], description: "Project priority" },
        autoExecute: { type: "boolean", description: "Auto-start first phase" },
      },
      required: ["idea"],
    },
    handler: async (args) => {
      const result = await analyzeIdea(args.idea, { techStack: args.techStack });
      if (!result.ok) return result;

      const notionResult = await createProjectInNotion(result.plan, { priority: args.priority });
      if (!notionResult.ok) return notionResult;

      return {
        ok: true,
        projectId: notionResult.projectId,
        title: result.plan.title,
        phases: result.plan.phases.map(p => p.name),
        totalTasks: notionResult.totalTasks,
        notionUrl: `https://notion.so/${notionResult.notionProjectId}`,
      };
    },
  },
  {
    name: "project_execute_next",
    description: "Execute the next pending task in a project",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      const project = activeProjects.get(args.projectId);
      if (!project) return { ok: false, error: { message: "Project not found" } };

      const pendingTask = project.tasks.find(t => !t.status || t.status === "Not Started");
      if (!pendingTask) return { ok: true, done: true, message: "All tasks completed" };

      return await executeTask(args.projectId, pendingTask, {
        plan: project.plan,
        workspacePath: args.projectId,
      });
    },
  },
  {
    name: "project_create_repo",
    description: "Create a new GitHub repository for the project",
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name" },
        description: { type: "string", description: "Repository description" },
        isPrivate: { type: "boolean", description: "Private repository", default: false },
        template: { type: "string", description: "Optional: node, python, nextjs, etc.", enum: ["node", "python", "nextjs", "go", "rust", "empty"] },
        explanation: { type: "string", description: "Why you're creating this repo" },
      },
      required: ["name", "description", "explanation"],
    },
    handler: async ({ name, description, isPrivate = false, template = "empty", explanation }) => {
      try {
        const response = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            "Authorization": `token ${process.env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            description,
            private: isPrivate,
            auto_init: true,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          return { ok: false, error: { code: "github_error", message: error.message } };
        }

        const repo = await response.json();
        return {
          ok: true,
          data: {
            repo_id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            url: repo.html_url,
            clone_url: repo.clone_url,
            ssh_url: repo.ssh_url,
            template,
            explanation,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "create_error", message: err.message } };
      }
    },
  },
  {
    name: "project_generate_structure",
    description: "Generate project folder structure using AI",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Project idea/concept" },
        techStack: { type: "string", description: "Technology stack (e.g., nextjs, python, node)" },
        repoPath: { type: "string", description: "Local repository path" },
        explanation: { type: "string", description: "Why you're generating this structure" },
      },
      required: ["idea", "techStack", "repoPath", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS],
    handler: async ({ idea, techStack, repoPath, explanation }) => {
      const prompt = `Generate a project structure for:
Idea: ${idea}
Tech Stack: ${techStack}

Provide as JSON:
{
  "structure": [
    { "path": "src/components", "type": "directory" },
    { "path": "src/index.js", "type": "file", "template": "..." }
  ],
  "files": [
    { "path": "package.json", "content": "..." },
    { "path": "README.md", "content": "..." }
  ]
}`;

      const result = await callLLM([
        { role: "system", content: "You are an expert software architect." },
        { role: "user", content: prompt }
      ], { jsonMode: true });

      if (!result.ok) return result;

      let structure;
      try {
        structure = JSON.parse(result.content);
      } catch {
        return { ok: false, error: { code: "parse_error", message: "Failed to parse AI structure" } };
      }

      const created = [];
      const { mkdir, writeFile } = await import("fs/promises");
      const { join } = await import("path");

      for (const item of structure.structure || []) {
        if (item.type === "directory") {
          await mkdir(join(repoPath, item.path), { recursive: true });
          created.push({ type: "dir", path: item.path });
        }
      }

      for (const file of structure.files || []) {
        await writeFile(join(repoPath, file.path), file.content, "utf8");
        created.push({ type: "file", path: file.path });
      }

      return {
        ok: true,
        data: { repoPath, created, explanation },
      };
    },
  },
  {
    name: "project_create_tasks",
    description: "Create project tasks/todos",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Project idea" },
        techStack: { type: "string", description: "Tech stack" },
        outputFormat: { type: "string", description: "notion, markdown, or json", default: "markdown" },
        explanation: { type: "string", description: "Why you're creating these tasks" },
      },
      required: ["idea", "techStack", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.NETWORK],
    handler: async ({ idea, techStack, outputFormat = "markdown", explanation }) => {
      const prompt = `Create project tasks for:
Idea: ${idea}
Tech Stack: ${techStack}

Generate tasks in ${outputFormat} format covering:
1. Project setup
2. Core features
3. Testing
4. Documentation

Return structured tasks.`;

      const result = await callLLM([
        { role: "system", content: "You are a project manager." },
        { role: "user", content: prompt }
      ]);

      if (!result.ok) return result;

      return {
        ok: true,
        data: {
          tasks: result.content,
          format: outputFormat,
          explanation,
        },
      };
    },
  },
  {
    name: "project_generate_code",
    description: "Generate initial code for the project",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Project idea" },
        techStack: { type: "string", description: "Tech stack" },
        component: { type: "string", description: "Specific component to generate" },
        repoPath: { type: "string", description: "Repository path to write to" },
        explanation: { type: "string", description: "Why you're generating this code" },
      },
      required: ["idea", "techStack", "component", "repoPath", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.LOCAL_FS, ToolTags.NETWORK],
    handler: async ({ idea, techStack, component, repoPath, explanation }) => {
      const prompt = `Generate code for:
Project: ${idea}
Tech Stack: ${techStack}
Component: ${component}

Provide:
1. File path
2. Complete code
3. Dependencies needed

Return as JSON: { "files": [{ "path": "...", "content": "..." }] }`;

      const result = await callLLM([
        { role: "system", content: "You are an expert programmer." },
        { role: "user", content: prompt }
      ], { jsonMode: true });

      if (!result.ok) return result;

      let files;
      try {
        files = JSON.parse(result.content).files;
      } catch {
        return { ok: false, error: { code: "parse_error", message: "Could not parse generated code" } };
      }

      const { writeFile } = await import("fs/promises");
      const { join } = await import("path");

      const written = [];
      for (const file of files) {
        await writeFile(join(repoPath, file.path), file.content, "utf8");
        written.push(file.path);
      }

      return {
        ok: true,
        data: { component, files: written, explanation },
      };
    },
  },
  {
    name: "project_open_pr",
    description: "Open initial pull request",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository full name (owner/repo)" },
        title: { type: "string", description: "PR title" },
        description: { type: "string", description: "PR description" },
        branch: { type: "string", description: "Branch name", default: "main" },
        explanation: { type: "string", description: "Why you're opening this PR" },
      },
      required: ["repo", "title", "description", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.EXTERNAL_API, ToolTags.NETWORK],
    handler: async ({ repo, title, description, branch = "main", explanation }) => {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
          method: "POST",
          headers: {
            "Authorization": `token ${process.env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            body: description,
            labels: ["enhancement"],
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          return { ok: false, error: { code: "github_error", message: error.message } };
        }

        const issue = await response.json();
        return {
          ok: true,
          data: {
            issue_id: issue.id,
            issue_number: issue.number,
            url: issue.html_url,
            repo,
            branch,
            explanation,
          },
        };
      } catch (err) {
        return { ok: false, error: { code: "pr_error", message: err.message } };
      }
    },
  },
];
