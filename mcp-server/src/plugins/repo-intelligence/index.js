/**
 * Repo Intelligence Plugin
 *
 * Local repository analysis and AI-powered summary generation.
 * Reads git history, file structure, and code comments; feeds them to llm-router.
 */

import { Router } from "express";
import { z } from "zod";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit/index.js";
import { routeTask } from "../llm-router/index.js";
import { getRecentCommits, getProjectStructure, getOpenIssues, getSimilarCommits, BASE_REPO_PATH } from "./repo.core.js";
import { repoAnalyze } from "./repo.analyze.js";

// ── Metadata ──────────────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "repo-intelligence",
  version: "1.1.0",
  description: "Analyze local repositories: git history, file structure, TODO scanner, AI-powered summary",
  status: PluginStatus.STABLE,
  risk: RiskLevel.LOW,
  capabilities: ["read"],
  requires: ["OPENAI_API_KEY (or any LLM key for AI summary)"],
  endpoints: [
    { method: "GET",  path: "/repo/health",    description: "Plugin health",                             scope: "read" },
    { method: "GET",  path: "/repo/commits",   description: "Recent git commits with stats",             scope: "read" },
    { method: "GET",  path: "/repo/commits/similar", description: "Commits similar to query (Augment-style)", scope: "read" },
    { method: "GET",  path: "/repo/issues",    description: "TODO/FIXME/BUG comments in codebase",       scope: "read" },
    { method: "GET",  path: "/repo/structure", description: "Project file structure",                    scope: "read" },
    { method: "POST", path: "/repo/analyze",   description: "AI-powered repo analysis with roadmap",    scope: "read" },
    { method: "POST", path: "/repo/summary",   description: "Concise AI summary of the repository",     scope: "read" },
  ],
  examples: [
    "GET /repo/commits?limit=20",
    'POST /repo/analyze  body: {"path":".","context":"roadmap generation"}',
  ],
});

export const name         = metadata.name;
export const version      = metadata.version;
export const description  = metadata.description;
export const capabilities = metadata.capabilities;
export const requires     = metadata.requires;
export const endpoints    = metadata.endpoints;
export const examples     = metadata.examples;

// ── Helpers ───────────────────────────────────────────────────────────────────

const pluginError = createPluginErrorHandler("repo-intelligence");

function repoAudit(req, action, details = {}) {
  return auditLog({
    plugin:    "repo-intelligence",
    action,
    userId:    req?.headers?.["x-user-id"] || "anonymous",
    projectId: req?.headers?.["x-project-id"] || null,
    details,
    risk:      RiskLevel.LOW,
  });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const pathQuerySchema = z.object({
  path:     z.string().optional().default("."),
  limit:    z.coerce.number().int().min(1).max(200).optional().default(20),
  maxDepth: z.coerce.number().int().min(1).max(6).optional().default(3),
});

const analyzeBodySchema = z.object({
  path:        z.string().optional().default("."),
  context:     z.string().optional().default("Repository analysis"),
  explanation: z.string().optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // ── Health ─────────────────────────────────────────────────────────────────

  router.get("/health", (_req, res) => {
    const llmOk = !!(
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GOOGLE_API_KEY
    );
    res.json({
      ok:      true,
      status:  "healthy",
      plugin:  name,
      version,
      baseRepoPath: BASE_REPO_PATH,
      checks: {
        llm: llmOk ? "configured" : "missing LLM key (AI features will fail)",
      },
    });
  });

  // ── GET /repo/commits ──────────────────────────────────────────────────────

  router.get("/commits", async (req, res) => {
    const parsed = pathQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_query", details: parsed.error.flatten() });
    }
    const result = await getRecentCommits(parsed.data.path, parsed.data.limit);
    res.status(result.ok ? 200 : 500).json(result);
  });

  router.get("/commits/similar", async (req, res) => {
    const parsed = z.object({
      path:  z.string().optional().default("."),
      query: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(20).optional().default(5),
    }).safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_query", details: parsed.error.flatten() });
    }
    const result = await getSimilarCommits(parsed.data.path, parsed.data.query, { limit: parsed.data.limit });
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── GET /repo/issues ───────────────────────────────────────────────────────

  router.get("/issues", async (req, res) => {
    const parsed = pathQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_query", details: parsed.error.flatten() });
    }
    const result = await getOpenIssues(parsed.data.path);
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── GET /repo/structure ────────────────────────────────────────────────────

  router.get("/structure", async (req, res) => {
    const parsed = pathQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_query", details: parsed.error.flatten() });
    }
    const result = await getProjectStructure(parsed.data.path, { maxDepth: parsed.data.maxDepth });
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── POST /repo/analyze ─────────────────────────────────────────────────────

  router.post("/analyze", async (req, res) => {
    const parsed = analyzeBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }
    const { path, context } = parsed.data;
    const result = await repoAnalyze(path, context);
    if (result.ok) await repoAudit(req, "analyze", { path, context, model: result.data?.model });
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── POST /repo/summary ─────────────────────────────────────────────────────

  router.post("/summary", async (req, res) => {
    const parsed = analyzeBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }
    const { path, context: explanation } = parsed.data;

    const [commitsResult, issuesResult, structureResult] = await Promise.all([
      getRecentCommits(path, 30),
      getOpenIssues(path),
      getProjectStructure(path, { maxDepth: 3 }),
    ]);

    if (!commitsResult.ok || !issuesResult.ok || !structureResult.ok) {
      return res.status(500).json(pluginError.external("Failed to collect repository data", {
        code: "data_collection_failed",
        commits:   commitsResult.error,
        issues:    issuesResult.error,
        structure: structureResult.error,
      }));
    }

    const repoData = buildRepoData(commitsResult.data, issuesResult.data, structureResult.data);
    const prompt   = buildSummaryPrompt(repoData, explanation);

    let llmResult;
    try {
      llmResult = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 2000 });
    } catch (err) {
      return res.status(502).json(pluginError.external(err.message, { code: "llm_error" }));
    }

    const analysis = parseAnalysis(llmResult.content, repoData.projectType);
    await repoAudit(req, "summary", { path, model: llmResult.model });

    res.json({
      ok: true,
      data: { ...analysis, rawData: { commits: commitsResult.data.summary, issues: issuesResult.data.summary, files: structureResult.data.stats }, provider: llmResult.provider, model: llmResult.model },
    });
  });

  app.use("/repo", router);
}

// ── Shared LLM helpers ────────────────────────────────────────────────────────

function buildRepoData(commits, issues, structure) {
  return {
    projectType:   structure.projectType,
    fileStats:     structure.stats,
    recentCommits: {
      count:   commits.count,
      summary: commits.summary,
      recent:  commits.commits.slice(0, 10).map(c => ({ subject: c.subject, author: c.author, date: c.date, stats: c.stats })),
    },
    openIssues: {
      count:    issues.count,
      summary:  issues.summary,
      critical: issues.issues.filter(i => i.type === "FIXME" || i.type === "BUG").slice(0, 10),
    },
    keyFiles: Object.fromEntries(
      Object.entries(structure.keyFiles).map(([k, v]) => [k, v.slice(0, 1000)])
    ),
  };
}

function buildSummaryPrompt(repoData, context) {
  return `Analyze this repository and provide a concise summary.

Repository Data:
${JSON.stringify(repoData, null, 2)}

User Context: ${context || "General analysis"}

Return ONLY valid JSON (no markdown):
{
  "summary": "2-3 sentence overview",
  "currentState": "Assessment of code quality and maturity",
  "risks": "Key risks or technical debt",
  "nextSteps": ["actionable recommendations"],
  "techStack": ["technologies used"]
}`;
}

function parseAnalysis(raw, fallbackType) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : fallbackAnalysis(raw, fallbackType);
  } catch {
    return fallbackAnalysis(raw, fallbackType);
  }
}

function fallbackAnalysis(raw, fallbackType) {
  return {
    summary:      raw.slice(0, 500),
    currentState: "Partial analysis — could not parse structured output",
    risks:        "See raw LLM output",
    nextSteps:    [],
    techStack:    [fallbackType],
  };
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "repo_similar_commits",
    description: "Find past commits similar to the current task (Augment-style). Use to see how similar changes were made before (e.g. 'add auth', 'fix memory leak').",
    tags: [ToolTags.READ_ONLY, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string",  description: "Repository path (default: project root)", default: "." },
        query:       { type: "string",  description: "What kind of change (e.g. 'add authentication', 'fix memory leak')" },
        limit:       { type: "number", description: "Max commits to return (1-20, default: 5)" },
        explanation: { type: "string", description: "Why you need similar commits" },
      },
      required: ["query"],
    },
    handler: async ({ path = ".", query, limit = 5, explanation }) => {
      const result = await getSimilarCommits(path, query, { limit });
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "repo_recent_commits",
    description: "Get recent git commits with file stats. Use to understand recent activity and change velocity.",
    tags: [ToolTags.READ_ONLY, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string",  description: "Repository path (default: project root)", default: "." },
        limit:       { type: "number",  description: "Number of commits to fetch (1-200, default: 20)" },
        explanation: { type: "string",  description: "Explain why you need recent commits" },
      },
      required: ["explanation"],
    },
    handler: async ({ path = ".", limit = 20, explanation }) => {
      const result = await getRecentCommits(path, limit);
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "repo_open_issues",
    description: "Find TODO, FIXME, BUG, HACK comments in source files. Helps identify technical debt and known issues.",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string", description: "Repository path (default: project root)", default: "." },
        explanation: { type: "string", description: "Explain why you need to find open issues" },
      },
      required: ["explanation"],
    },
    handler: async ({ path = ".", explanation }) => {
      const result = await getOpenIssues(path);
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "repo_project_structure",
    description: "Get project file structure, detected project type (nodejs/python/go/etc), and key file contents (README, package.json).",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string",  description: "Repository path (default: project root)", default: "." },
        maxDepth:    { type: "number",  description: "Max directory depth (1-6, default: 3)" },
        explanation: { type: "string",  description: "Explain why you need project structure" },
      },
      required: ["explanation"],
    },
    handler: async ({ path = ".", maxDepth = 3, explanation }) => {
      const result = await getProjectStructure(path, { maxDepth });
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
  {
    name: "repo_summary",
    description: "Generate a concise AI-powered repository summary: overview, code quality assessment, risks, next steps, and tech stack. Combines commits + issues + structure into one LLM call.",
    tags: [ToolTags.READ_ONLY, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string", description: "Repository path (default: project root)", default: "." },
        explanation: { type: "string", description: "What you want to understand about this repo" },
      },
      required: ["explanation"],
    },
    handler: async ({ path = ".", explanation }) => {
      const [commitsResult, issuesResult, structureResult] = await Promise.all([
        getRecentCommits(path, 30),
        getOpenIssues(path),
        getProjectStructure(path, { maxDepth: 3 }),
      ]);

      if (!commitsResult.ok || !issuesResult.ok || !structureResult.ok) {
        return { ok: false, error: { code: "data_collection_failed", details: { commits: commitsResult.error, issues: issuesResult.error, structure: structureResult.error } } };
      }

      const repoData  = buildRepoData(commitsResult.data, issuesResult.data, structureResult.data);
      const prompt    = buildSummaryPrompt(repoData, explanation);
      const llmResult = await routeTask("analysis", prompt, { temperature: 0.3, maxTokens: 2000 });
      const analysis  = parseAnalysis(llmResult.content, repoData.projectType);

      return { ok: true, data: { ...analysis, rawData: { commits: commitsResult.data.summary, issues: issuesResult.data.summary, files: structureResult.data.stats }, explanation, provider: llmResult.provider, model: llmResult.model } };
    },
  },
  {
    name: "repo_analyze",
    description: "Comprehensive repository analysis with roadmap suggestions. More detailed than repo_summary — includes a prioritized roadmap and deeper commit/issue analysis.",
    tags: [ToolTags.READ_ONLY, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string", description: "Repository path (default: project root)", default: "." },
        context:     { type: "string", description: "Analysis context (e.g., 'for roadmap generation', 'code review')", default: "Repository analysis" },
        explanation: { type: "string", description: "Explain what you want to analyze and why" },
      },
      required: ["explanation"],
    },
    handler: async ({ path = ".", context = "Repository analysis", explanation }) => {
      const result = await repoAnalyze(path, context);
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, explanation } };
    },
  },
];
