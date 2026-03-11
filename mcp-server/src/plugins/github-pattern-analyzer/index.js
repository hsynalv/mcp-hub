/**
 * GitHub Pattern Analyzer Plugin
 *
 * Learns the developer's coding patterns by analyzing their GitHub repositories.
 * Results are cached in Redis and can be used to generate architecture options
 * tailored to the developer's own style.
 */

import { Router } from "express";
import { z } from "zod";
import { ToolTags, callTool } from "../../core/tool-registry.js";
import {
  getCachedPatterns,
  setCachedPatterns,
  invalidatePatterns,
} from "../../core/redis.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit/index.js";
import { requireScope } from "../../core/auth.js";
import { routeTask } from "../llm-router/index.js";

// ── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "github-pattern-analyzer",
  version: "1.1.0",
  description: "Learns developer coding patterns from GitHub repos; generates personalised architecture options",
  status: PluginStatus.STABLE,
  risk: RiskLevel.LOW,
  capabilities: ["read"],
  requires: ["OPENAI_API_KEY", "GITHUB_TOKEN", "REDIS_URL"],
  endpoints: [
    { method: "POST", path: "/github-patterns/analyze",              description: "Analyze repos and cache patterns",                    scope: "read" },
    { method: "GET",  path: "/github-patterns/cached",               description: "Get cached patterns",                                scope: "read" },
    { method: "POST", path: "/github-patterns/invalidate",           description: "Clear pattern cache",                                scope: "read" },
    { method: "GET",  path: "/github-patterns/architecture-options", description: "Generate architecture options from cached patterns",  scope: "read" },
    { method: "GET",  path: "/github-patterns/health",               description: "Plugin health",                                      scope: "read" },
  ],
  examples: [
    'POST /github-patterns/analyze  body: {"repos":5}',
    'GET  /github-patterns/architecture-options?idea=Build+auth+service&username=hsynalv',
  ],
});

// Keep flat exports for plugin loader compatibility
export const name        = metadata.name;
export const version     = metadata.version;
export const description = metadata.description;
export const capabilities = metadata.capabilities;
export const requires    = metadata.requires;
export const endpoints   = metadata.endpoints;
export const examples    = metadata.examples;

// ── Config ────────────────────────────────────────────────────────────────────

const GITHUB_ANALYZE_REPO_COUNT = parseInt(process.env.GITHUB_ANALYZE_REPO_COUNT || "5", 10);

const pluginError = createPluginErrorHandler("github-pattern-analyzer");

// ── Audit helper ─────────────────────────────────────────────────────────────

function gpaAudit(req, action, details = {}) {
  return auditLog({
    plugin:    "github-pattern-analyzer",
    action,
    userId:    req?.headers?.["x-user-id"] || "anonymous",
    projectId: req?.headers?.["x-project-id"] || null,
    details,
    risk:      RiskLevel.LOW,
  });
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function fetchGitHubRepos(limit = GITHUB_ANALYZE_REPO_COUNT) {
  const res = await callTool("github_list_repos", { sort: "pushed", limit });
  if (!res?.ok) return res;
  return { ok: true, data: res.data?.repos ?? [] };
}

async function analyzeRepo(fullName) {
  const res = await callTool("github_analyze_repo", { repo: fullName });
  if (!res?.ok) return res;
  return { ok: true, data: res.data };
}

// ── Prompt helpers (token budget) ────────────────────────────────────────────

/**
 * Truncate a single repo analysis to a safe token budget.
 * ~15 tree items + 800 char readme + 3 short commits ≈ 1.5K tokens per repo.
 * 5 repos × 1.5K ≈ 7.5K → well within gpt-4o's context.
 */
function truncateRepoForPrompt(r) {
  const tree    = (Array.isArray(r?.tree) ? r.tree : r?.tree?.items)?.slice(0, 15) ?? [];
  const readme  = (r?.readme ?? "").slice(0, 800);
  const commits = (Array.isArray(r?.commits) ? r.commits : r?.commits?.items)
    ?.slice(0, 3)
    .map(c => ({ sha: c.sha?.slice(0, 7), message: c.message?.slice(0, 100) })) ?? [];

  return {
    name:        r?.repo?.fullName ?? r?.fullName ?? "unknown",
    language:    r?.repo?.language ?? r?.language ?? null,
    description: r?.repo?.description ?? r?.description ?? null,
    tree,
    readme,
    recentCommits: commits,
  };
}

// ── Pattern extraction ────────────────────────────────────────────────────────

async function extractPatterns(repoAnalyses) {
  const repoData = repoAnalyses.map(truncateRepoForPrompt);

  const prompt = `You are an expert code analyst who identifies architectural patterns from repository data.

Analyze the following GitHub repositories and extract the developer's patterns.

REPOSITORIES:
${JSON.stringify(repoData, null, 2)}

Return ONLY valid JSON matching this structure (no markdown, no commentary):
{
  "techStack": {
    "languages": [],
    "primaryFramework": "",
    "secondaryFrameworks": [],
    "databases": [],
    "testingFrameworks": [],
    "preferredTools": [],
    "runtime": ""
  },
  "architecture": {
    "pattern": "",
    "folderStructure": [],
    "namingConventions": {
      "files": "",
      "classes": "",
      "functions": "",
      "constants": ""
    },
    "codeOrganization": ""
  },
  "codingStyle": {
    "errorHandling": "",
    "validation": "",
    "documentation": "",
    "asyncStyle": "",
    "typeSafety": ""
  },
  "projectStandards": {
    "testing": "",
    "linting": "",
    "ciCd": "",
    "envManagement": ""
  },
  "confidence": 0.85,
  "analyzedRepos": []
}

Be specific and observational. Only include patterns you can actually see in the data.`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { maxTokens: 2000, temperature: 0.3 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const raw = result?.content ?? "";

  // Strip possible markdown code fence
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const patterns = JSON.parse(cleaned);
    return { ok: true, patterns };
  } catch {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse LLM response as JSON", raw: cleaned.slice(0, 500) } };
  }
}

// ── Architecture options generator ───────────────────────────────────────────

async function generateArchitectureOptions(idea, patterns) {
  const prompt = `You are an expert software architect who creates tailored architecture recommendations.

Given this project idea and the developer's existing patterns, generate 2-3 architecture options.

PROJECT IDEA: ${idea}

DEVELOPER'S PATTERNS:
${JSON.stringify(patterns, null, 2)}

Return ONLY valid JSON (no markdown, no commentary):
{
  "options": [
    {
      "id": "opt-1",
      "name": "Descriptive name referencing their pattern (e.g. 'Express+JWT like api-gateway')",
      "description": "",
      "patternsUsed": "",
      "techStack": { "framework": "", "language": "", "database": "", "additional": [] },
      "folderStructure": [],
      "pros": [],
      "cons": [],
      "estimatedHours": 12,
      "confidence": 0.9
    }
  ]
}

Create options that either follow their existing patterns closely, suggest an evolution, or propose something different with a clear rationale.`;

  let result;
  try {
    result = await routeTask("analysis", prompt, { maxTokens: 2000, temperature: 0.5 });
  } catch (err) {
    return { ok: false, error: { code: "llm_error", message: err.message } };
  }

  const raw     = result?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const data = JSON.parse(cleaned);
    return { ok: true, options: data.options };
  } catch {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse LLM response as JSON", raw: cleaned.slice(0, 500) } };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /github-patterns/health
 */
router.get("/health", async (_req, res) => {
  const llmOk    = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const githubOk = !!process.env.GITHUB_TOKEN;
  const redisOk  = !!process.env.REDIS_URL;

  const healthy = llmOk && githubOk;
  res.status(healthy ? 200 : 503).json({
    ok:      healthy,
    status:  healthy ? "healthy" : "degraded",
    plugin:  name,
    version,
    checks: {
      llm:    llmOk    ? "configured" : "missing API key",
      github: githubOk ? "configured" : "missing GITHUB_TOKEN",
      redis:  redisOk  ? "configured" : "missing REDIS_URL (cache disabled)",
    },
  });
});

/**
 * POST /github-patterns/analyze
 * Fetch repos → analyze → extract patterns → cache in Redis.
 * Changed from GET to POST because this is a heavy, non-idempotent operation.
 */
const analyzeSchema = z.object({
  repos:    z.coerce.number().min(1).max(10).optional(),
  username: z.string().optional(),
});

router.post("/analyze", requireScope("read"), async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const repoCount = parsed.data.repos ?? GITHUB_ANALYZE_REPO_COUNT;

  // 1. Fetch repo list
  const reposResult = await fetchGitHubRepos(repoCount);
  if (!reposResult?.ok || !reposResult.data?.length) {
    return res.status(500).json(pluginError.external("Failed to fetch GitHub repos", { code: "github_error" }));
  }

  // 2. Analyze each repo (sequentially to avoid GitHub rate limits)
  const analyses = [];
  for (const repo of reposResult.data.slice(0, repoCount)) {
    const analysis = await analyzeRepo(repo.fullName);
    if (analysis?.ok && analysis.data) analyses.push(analysis.data);
  }

  if (analyses.length === 0) {
    return res.status(500).json(pluginError.external("Failed to analyze any repos", { code: "github_error" }));
  }

  // 3. Extract patterns via LLM (routeTask, with token budget enforced in truncateRepoForPrompt)
  const patternsResult = await extractPatterns(analyses);
  if (!patternsResult.ok) {
    return res.status(502).json(pluginError.external(patternsResult.error?.message || "Pattern extraction failed", patternsResult.error));
  }

  // 4. Cache in Redis
  const username = parsed.data.username || reposResult.data[0]?.owner?.login || "unknown";
  await setCachedPatterns(username, patternsResult.patterns);

  // 5. Audit
  await gpaAudit(req, "analyze_patterns", {
    username,
    repoCount:    analyses.length,
    confidence:   patternsResult.patterns?.confidence,
    analyzedRepos: analyses.map(a => a?.repo?.fullName ?? a?.fullName),
  });

  res.json({
    ok:           true,
    username,
    patterns:     patternsResult.patterns,
    analyzedRepos: analyses.map(a => a?.repo?.fullName ?? a?.fullName),
    cached:       true,
    cacheKey:     `patterns:${username}`,
  });
});

/**
 * GET /github-patterns/cached
 */
router.get("/cached", async (req, res) => {
  const schema = z.object({ username: z.string().min(1) });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const cached = await getCachedPatterns(parsed.data.username);
  if (!cached) {
    return res.status(404).json({
      ok:    false,
      error: { code: "cache_miss", message: "No cached patterns found. POST /github-patterns/analyze first." },
    });
  }

  res.json({ ok: true, ...cached });
});

/**
 * POST /github-patterns/invalidate
 */
router.post("/invalidate", requireScope("read"), async (req, res) => {
  const schema = z.object({ username: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  await invalidatePatterns(parsed.data.username);
  await gpaAudit(req, "invalidate_cache", { username: parsed.data.username });

  res.json({ ok: true, message: `Pattern cache cleared for ${parsed.data.username}` });
});

/**
 * GET /github-patterns/architecture-options
 */
const archSchema = z.object({
  idea:     z.string().min(10),
  username: z.string().min(1),
});

router.get("/architecture-options", requireScope("read"), async (req, res) => {
  const parsed = archSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
  }

  const { idea, username } = parsed.data;

  const cached = await getCachedPatterns(username);
  if (!cached) {
    return res.status(404).json({
      ok:    false,
      error: { code: "cache_miss", message: "No cached patterns. POST /github-patterns/analyze first." },
    });
  }

  const optionsResult = await generateArchitectureOptions(idea, cached.patterns);
  if (!optionsResult.ok) {
    return res.status(502).json(pluginError.external(optionsResult.error?.message || "Option generation failed", optionsResult.error));
  }

  await gpaAudit(req, "generate_architecture_options", { username, idea: idea.slice(0, 100) });

  res.json({
    ok:            true,
    idea,
    username,
    patternsSource: cached.updatedAt,
    options:       optionsResult.options,
  });
});

// ── Plugin registration ───────────────────────────────────────────────────────

export function register(app) {
  app.use("/github-patterns", router);
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "github_analyze_patterns",
    description: "Analyze the user's GitHub repos and extract coding patterns (tech stack, architecture, naming, style). Results are cached in Redis. Run this once before using github_get_architecture_options.",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        repos:    { type: "number", description: "Number of repos to analyze (1-10, default: 5)" },
        username: { type: "string", description: "GitHub username override (default: authenticated user)" },
      },
    },
    handler: async (args) => {
      const repoCount   = args.repos || GITHUB_ANALYZE_REPO_COUNT;
      const reposResult = await fetchGitHubRepos(repoCount);
      if (!reposResult?.ok) return { ok: false, error: "Failed to fetch repos" };

      const analyses = [];
      for (const repo of reposResult.data.slice(0, repoCount)) {
        const analysis = await analyzeRepo(repo.fullName);
        if (analysis?.ok) analyses.push(analysis.data);
      }

      if (analyses.length === 0) return { ok: false, error: "Failed to analyze any repos" };

      const patternsResult = await extractPatterns(analyses);
      if (!patternsResult.ok) return patternsResult;

      const username = args.username || reposResult.data[0]?.owner?.login || "unknown";
      await setCachedPatterns(username, patternsResult.patterns);

      return { ok: true, username, patterns: patternsResult.patterns, analyzedRepos: analyses.length };
    },
  },
  {
    name: "github_get_architecture_options",
    description: "Generate 2-3 architecture options for a project idea, tailored to the developer's own GitHub patterns. Requires github_analyze_patterns to have been run first.",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        idea:     { type: "string", description: "Project idea or description (min 10 chars)" },
        username: { type: "string", description: "GitHub username (must have cached patterns)" },
      },
      required: ["idea", "username"],
    },
    handler: async (args) => {
      const cached = await getCachedPatterns(args.username);
      if (!cached) {
        return {
          ok:    false,
          error: { code: "cache_miss", message: "No cached patterns. Run github_analyze_patterns first." },
        };
      }
      return await generateArchitectureOptions(args.idea, cached.patterns);
    },
  },
];
