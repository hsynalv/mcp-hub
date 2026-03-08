/**
 * GitHub Pattern Analyzer Plugin
 * Learns user's coding patterns from GitHub repos and stores in Redis
 */

import { Router } from "express";
import { z } from "zod";
import { ToolTags } from "../../core/tool-registry.js";
import { callTool } from "../../core/tool-registry.js";
import {
  getCachedPatterns,
  setCachedPatterns,
  invalidatePatterns,
} from "../../core/redis.js";

// ── Configuration ────────────────────────────────────────────────────────────

const LLM_API_KEY = process.env.OPENAI_API_KEY || null;
const LLM_BASE_URL = process.env.BRAIN_LLM_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.BRAIN_LLM_MODEL || "gpt-4o";
const GITHUB_ANALYZE_REPO_COUNT = parseInt(process.env.GITHUB_ANALYZE_REPO_COUNT || "5", 10);

// ── LLM Helper ─────────────────────────────────────────────────────────────────

async function callLLM(messages, options = {}) {
  if (!LLM_API_KEY) {
    return { ok: false, error: { code: "llm_not_configured", message: "OPENAI_API_KEY not set" } };
  }

  try {
    const controller = new globalThis.AbortController();
    const timeoutMs = options.timeoutMs ?? 60000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4000,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
      }),
    });
    clearTimeout(timeout);

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

// ── GitHub API Helpers ─────────────────────────────────────────────────────────

async function fetchGitHubRepos(limit = GITHUB_ANALYZE_REPO_COUNT) {
  const res = await callTool("github_list_repos", { sort: "pushed", limit });
  if (!res?.ok) return res;
  const repos = res.data?.repos ?? [];
  return { ok: true, data: repos };
}

async function analyzeRepo(fullName) {
  const res = await callTool("github_analyze_repo", { repo: fullName });
  if (!res?.ok) return res;
  return { ok: true, data: res.data };
}

// ── Pattern Extraction ─────────────────────────────────────────────────────────

async function extractPatterns(repoAnalyses) {
  const prompt = `Analyze these GitHub repositories and extract the developer's architectural patterns.

REPOSITORIES:
${JSON.stringify(repoAnalyses.map(r => ({
  name: r?.repo?.fullName ?? r?.fullName,
  language: r?.repo?.language ?? r?.language,
  description: r?.repo?.description ?? r?.description,
  tree: (Array.isArray(r?.tree) ? r.tree : r?.tree?.items)?.slice(0, 20),
  readme: (r?.readme ?? "")?.slice(0, 1000),
  recentCommits: (Array.isArray(r?.commits) ? r.commits : r?.commits?.items)?.slice(0, 5),
})), null, 2)}

Extract the following patterns and return as JSON:

{
  "techStack": {
    "languages": ["primary and secondary languages"],
    "primaryFramework": "main framework used",
    "secondaryFrameworks": ["other frameworks"],
    "databases": ["databases if visible"],
    "testingFrameworks": ["test frameworks if visible"],
    "preferredTools": ["libraries/tools like Zod, Prisma, etc."],
    "runtime": "Node.js/Python/etc"
  },
  "architecture": {
    "pattern": "Layered / Clean / Hexagonal / Feature-based",
    "folderStructure": ["typical folder names observed"],
    "namingConventions": {
      "files": "kebab-case / camelCase / PascalCase",
      "classes": "PascalCase / etc",
      "functions": "camelCase / etc",
      "constants": "UPPER_SNAKE / etc"
    },
    "codeOrganization": "by-feature / by-layer / mixed"
  },
  "codingStyle": {
    "errorHandling": "description of error handling approach",
    "validation": "Zod / Joi / class-validator / etc",
    "documentation": "JSDoc / README / inline comments / etc",
    "asyncStyle": "async-await / promises / callbacks",
    "typeSafety": "TypeScript strict / loose / JSDoc types / none"
  },
  "projectStandards": {
    "testing": "test coverage approach",
    "linting": "ESLint / Prettier configs observed",
    "ciCd": "GitHub Actions / etc if visible",
    "envManagement": "dotenv / config files approach"
  },
  "examples": {
    "[repo-name]": {
      "routeDefinition": "example file path and brief pattern description",
      "servicePattern": "example file path and pattern",
      "middlewarePattern": "example file path and pattern"
    }
  },
  "confidence": 0.85,
  "analyzedRepos": ["repo names"]
}

Be specific and observational. Only include patterns you can actually see in the data.
Rate confidence 0.0-1.0 based on data quality.`;

  const result = await callLLM([
    { role: "system", content: "You are an expert code analyst who identifies architectural patterns from repository data." },
    { role: "user", content: prompt }
  ], { jsonMode: true });

  if (!result.ok) return result;

  try {
    const patterns = JSON.parse(result.content);
    return { ok: true, patterns };
  } catch (e) {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse AI response" } };
  }
}

// ── Architecture Options Generator ────────────────────────────────────────────

async function generateArchitectureOptions(idea, patterns) {
  const prompt = `Given this project idea and the developer's patterns from GitHub, create 2-3 architecture options.

PROJECT IDEA: ${idea}

DEVELOPER'S PATTERNS:
${JSON.stringify(patterns, null, 2)}

Create architecture options that either:
1. Follow their existing patterns closely
2. Suggest a variation/evolution
3. Propose something different but explain why

Return JSON:
{
  "options": [
    {
      "id": "opt-1",
      "name": "Descriptive name (e.g., 'Express+JWT (like api-gateway)')",
      "description": "Brief description",
      "patternsUsed": "which of their patterns this uses",
      "techStack": {
        "framework": "Express/FastAPI/etc",
        "language": "TypeScript/JavaScript/etc",
        "database": "PostgreSQL/etc",
        "additional": ["BullMQ", "Redis", etc]
      },
      "folderStructure": ["src/routes", "src/services", etc],
      "exampleSnippets": [
        {
          "repo": "repo name where this pattern was seen",
          "file": "file path",
          "description": "what this shows",
          "snippet": "brief code snippet"
        }
      ],
      "estimatedHours": 12,
      "pros": ["familiar stack", "proven pattern"],
      "cons": ["requires Redis", "more complex"],
      "confidence": 0.9
    }
  ]
}`;

  const result = await callLLM([
    { role: "system", content: "You are an expert software architect who creates tailored architecture recommendations." },
    { role: "user", content: prompt }
  ], { jsonMode: true });

  if (!result.ok) return result;

  try {
    const data = JSON.parse(result.content);
    return { ok: true, options: data.options };
  } catch (e) {
    return { ok: false, error: { code: "parse_error", message: "Failed to parse AI response" } };
  }
}

// ── Express Routes ───────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /github-patterns/analyze
 * Force fresh analysis and cache
 */
router.get("/analyze", async (req, res) => {
  const schema = z.object({
    username: z.string().optional(),
    repos: z.coerce.number().min(1).max(10).optional(),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const { repos = GITHUB_ANALYZE_REPO_COUNT } = parsed.data;

  // 1. Fetch repos
  const reposResult = await fetchGitHubRepos(repos);
  if (!reposResult.ok || !reposResult.data) {
    return res.status(500).json({ ok: false, error: "Failed to fetch GitHub repos" });
  }

  // 2. Analyze each repo
  const analyses = [];
  for (const repo of reposResult.data.slice(0, repos)) {
    const analysis = await analyzeRepo(repo.fullName);
    if (analysis.ok && analysis.data) {
      analyses.push(analysis.data);
    }
  }

  if (analyses.length === 0) {
    return res.status(500).json({ ok: false, error: "Failed to analyze any repos" });
  }

  // 3. Extract patterns
  const patternsResult = await extractPatterns(analyses);
  if (!patternsResult.ok) {
    return res.status(500).json(patternsResult);
  }

  // 4. Cache in Redis
  const username = reposResult.data[0]?.owner?.login || "unknown";
  await setCachedPatterns(username, patternsResult.patterns);

  res.json({
    ok: true,
    username,
    patterns: patternsResult.patterns,
    analyzedRepos: analyses.map(a => a.fullName),
    cached: true,
    cacheKey: `patterns:${username}`,
  });
});

/**
 * GET /github-patterns/cached
 * Get cached patterns if available
 */
router.get("/cached", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const cached = await getCachedPatterns(parsed.data.username);

  if (!cached) {
    return res.status(404).json({
      ok: false,
      error: {
        code: "cache_miss",
        message: "No cached patterns found. Call /github-patterns/analyze first.",
      },
    });
  }

  res.json({
    ok: true,
    ...cached,
  });
});

/**
 * POST /github-patterns/invalidate
 * Clear cached patterns
 */
router.post("/invalidate", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  await invalidatePatterns(parsed.data.username);

  res.json({
    ok: true,
    message: `Patterns cache cleared for ${parsed.data.username}`,
  });
});

/**
 * GET /github-patterns/architecture-options
 * Generate architecture options for an idea
 */
router.get("/architecture-options", async (req, res) => {
  const schema = z.object({
    idea: z.string().min(10),
    username: z.string().min(1),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const { idea, username } = parsed.data;

  // 1. Get cached patterns
  const cached = await getCachedPatterns(username);
  if (!cached) {
    return res.status(404).json({
      ok: false,
      error: {
        code: "cache_miss",
        message: "No cached patterns. Call /github-patterns/analyze first.",
      },
    });
  }

  // 2. Generate options
  const optionsResult = await generateArchitectureOptions(idea, cached.patterns);
  if (!optionsResult.ok) {
    return res.status(500).json(optionsResult);
  }

  res.json({
    ok: true,
    idea,
    username,
    patternsSource: cached.updatedAt,
    options: optionsResult.options,
  });
});

// ── Plugin Export ────────────────────────────────────────────────────────────

export const name = "github-pattern-analyzer";
export const version = "1.0.0";
export const description = "Learns user's coding patterns from GitHub repos via Redis-cached analysis";

export function register(app) {
  app.use("/github-patterns", router);
}

export const endpoints = [
  { method: "GET", path: "/github-patterns/analyze", description: "Analyze repos and cache patterns" },
  { method: "GET", path: "/github-patterns/cached", description: "Get cached patterns" },
  { method: "POST", path: "/github-patterns/invalidate", description: "Clear pattern cache" },
  { method: "GET", path: "/github-patterns/architecture-options", description: "Generate architecture options for an idea" },
];

export const examples = [
  {
    description: "Analyze and cache patterns",
    request: {
      method: "GET",
      path: "/github-patterns/analyze?repos=5",
    },
  },
  {
    description: "Get architecture options",
    request: {
      method: "GET",
      path: "/github-patterns/architecture-options?idea=Build auth service&username=hsynalv",
    },
  },
];

// MCP Tools
export const tools = [
  {
    name: "github_analyze_patterns",
    description: "Analyze user's GitHub repos and extract coding patterns. Stores in Redis cache.",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        repos: { type: "number", description: "Number of repos to analyze (1-10, default: 5)" },
      },
    },
    handler: async (args) => {
      const reposResult = await fetchGitHubRepos(args.repos || GITHUB_ANALYZE_REPO_COUNT);
      if (!reposResult.ok) return { ok: false, error: "Failed to fetch repos" };

      const analyses = [];
      for (const repo of reposResult.data.slice(0, args.repos || 5)) {
        const analysis = await analyzeRepo(repo.fullName);
        if (analysis.ok) analyses.push(analysis.data);
      }

      const patternsResult = await extractPatterns(analyses);
      if (!patternsResult.ok) return patternsResult;

      const username = reposResult.data[0]?.owner?.login || "unknown";
      await setCachedPatterns(username, patternsResult.patterns);

      return {
        ok: true,
        username,
        patterns: patternsResult.patterns,
        analyzedRepos: analyses.length,
      };
    },
  },
  {
    name: "github_get_architecture_options",
    description: "Generate architecture options for a project idea based on user's patterns",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Project idea/description" },
        username: { type: "string", description: "GitHub username" },
      },
      required: ["idea", "username"],
    },
    handler: async (args) => {
      const cached = await getCachedPatterns(args.username);
      if (!cached) {
        return {
          ok: false,
          error: { code: "cache_miss", message: "No cached patterns. Run github_analyze_patterns first." },
        };
      }

      return await generateArchitectureOptions(args.idea, cached.patterns);
    },
  },
];
