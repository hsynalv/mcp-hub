/**
 * Repo Intelligence Plugin
 *
 * Repository analysis and summary generation using AI.
 */

import { Router } from "express";
import { ToolTags } from "../../core/tool-registry.js";
import { getRecentCommits, getProjectStructure, getOpenIssues } from "./repo.core.js";
import { repoAnalyze } from "./repo.analyze.js";

export const name = "repo-intelligence";
export const version = "1.0.0";
export const description = "Analyze repositories and generate AI-powered summaries";
export const capabilities = ["read"];
export const requires = [];

export const endpoints = [
  { method: "GET", path: "/repo/commits", description: "Get recent commits with stats", scope: "read" },
  { method: "GET", path: "/repo/issues", description: "Get open issues from code", scope: "read" },
  { method: "GET", path: "/repo/structure", description: "Get project structure", scope: "read" },
  { method: "POST", path: "/repo/analyze", description: "Analyze repository and generate roadmap", scope: "read" },
  { method: "POST", path: "/repo/summary", description: "Generate AI summary of repository", scope: "read" },
];

// Import llm_router dynamically to avoid circular deps
async function getLLMRouter() {
  const { routeTask } = await import("../llm-router/index.js");
  return routeTask;
}

// ─── MCP Tools ────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "repo_recent_commits",
    description: "Get recent git commits with detailed statistics",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository path (default: current)",
          default: ".",
        },
        limit: {
          type: "number",
          description: "Number of commits to fetch",
          default: 20,
        },
        explanation: {
          type: "string",
          description: "Explain why you need recent commits",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.GIT],
    handler: async ({ path = ".", limit = 20, explanation }) => {
      const result = await getRecentCommits(path, limit);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "repo_open_issues",
    description: "Find TODO, FIXME, BUG comments in code",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository path (default: current)",
          default: ".",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to find open issues",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path = ".", explanation }) => {
      const result = await getOpenIssues(path);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "repo_project_structure",
    description: "Get project file structure and key files",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository path (default: current)",
          default: ".",
        },
        maxDepth: {
          type: "number",
          description: "Max directory depth to traverse",
          default: 3,
        },
        explanation: {
          type: "string",
          description: "Explain why you need project structure",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    handler: async ({ path = ".", maxDepth = 3, explanation }) => {
      const result = await getProjectStructure(path, { maxDepth });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
  {
    name: "repo_summary",
    description: "Generate comprehensive repository summary using AI",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository path (default: current)",
          default: ".",
        },
        explanation: {
          type: "string",
          description: "Explain what you want to analyze and why",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.NETWORK],
    handler: async ({ path = ".", explanation }) => {
      // Step 1: Collect all repository data
      const [commitsResult, issuesResult, structureResult] = await Promise.all([
        getRecentCommits(path, 30),
        getOpenIssues(path),
        getProjectStructure(path, { maxDepth: 3 }),
      ]);

      if (!commitsResult.ok || !issuesResult.ok || !structureResult.ok) {
        return {
          ok: false,
          error: {
            code: "data_collection_failed",
            message: "Failed to collect repository data",
            details: {
              commits: commitsResult.error,
              issues: issuesResult.error,
              structure: structureResult.error,
            },
          },
        };
      }

      // Step 2: Prepare data for LLM analysis
      const repoData = {
        projectType: structureResult.data.projectType,
        fileStats: structureResult.data.stats,
        recentCommits: {
          count: commitsResult.data.count,
          summary: commitsResult.data.summary,
          recent: commitsResult.data.commits.slice(0, 10).map(c => ({
            subject: c.subject,
            author: c.author,
            date: c.date,
            stats: c.stats,
          })),
        },
        openIssues: {
          count: issuesResult.data.count,
          summary: issuesResult.data.summary,
          critical: issuesResult.data.issues.filter(i => i.type === "FIXME" || i.type === "BUG").slice(0, 10),
        },
        keyFiles: Object.keys(structureResult.data.keyFiles).reduce((acc, key) => {
          const content = structureResult.data.keyFiles[key];
          acc[key] = content.slice(0, 1000); // Truncate for prompt size
          return acc;
        }, {}),
      };

      // Step 3: Send to LLM for analysis
      const prompt = `Analyze this repository and provide a comprehensive summary:

Repository Data:
${JSON.stringify(repoData, null, 2)}

User Context: ${explanation}

Please analyze this repository and provide a structured response with:
1. summary - A concise overview of what this project does
2. currentState - Assessment of code quality and organization
3. risks - Potential issues, technical debt, or risks
4. nextSteps - Actionable recommendations for improvements
5. techStack - List of technologies and frameworks used

Format your response as JSON with these exact keys: summary, currentState, risks (string), nextSteps (array), techStack (array).`;

      try {
        const routeTask = await getLLMRouter();
        const llmResult = await routeTask("analysis", prompt, {
          temperature: 0.3,
          maxTokens: 4000,
        });

        // Parse LLM response
        let analysis;
        try {
          // Try to extract JSON from response
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysis = JSON.parse(jsonMatch[0]);
          } else {
            analysis = {
              summary: llmResult.content.slice(0, 500),
              currentState: "Analysis completed",
              risks: "Unable to parse structured analysis",
              nextSteps: [],
              techStack: [repoData.projectType],
            };
          }
        } catch (parseErr) {
          analysis = {
            summary: llmResult.content.slice(0, 500),
            currentState: "Partial analysis",
            risks: "Parse error: " + parseErr.message,
            nextSteps: [],
            techStack: [repoData.projectType],
          };
        }

        return {
          ok: true,
          data: {
            summary: analysis.summary,
            currentState: analysis.currentState,
            risks: analysis.risks,
            nextSteps: analysis.nextSteps || [],
            techStack: analysis.techStack || [repoData.projectType],
            rawData: {
              commits: commitsResult.data.summary,
              issues: issuesResult.data.summary,
              files: structureResult.data.stats,
            },
            explanation,
            provider: llmResult.provider,
            model: llmResult.model,
          },
        };
      } catch (llmErr) {
        return {
          ok: false,
          error: {
            code: "llm_analysis_failed",
            message: llmErr.message,
          },
        };
      }
    },
  },
  {
    name: "repo_analyze",
    description: "Comprehensive repository analysis with roadmap generation (uses llm_router internally)",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository path (default: current)",
          default: ".",
        },
        context: {
          type: "string",
          description: "Analysis context or purpose (e.g., 'for roadmap generation')",
          default: "Repository analysis",
        },
        explanation: {
          type: "string",
          description: "Explain what you want to analyze and why",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY, ToolTags.NETWORK],
    handler: async ({ path = ".", context = "Repository analysis", explanation }) => {
      const result = await repoAnalyze(path, context);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          explanation,
        },
      };
    },
  },
];

// ─── REST API Endpoints ───────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // GET /repo/commits
  router.get("/commits", async (req, res) => {
    const { path = ".", limit = 20 } = req.query;
    const result = await getRecentCommits(path, parseInt(limit, 10));
    res.json(result);
  });

  // GET /repo/issues
  router.get("/issues", async (req, res) => {
    const { path = "." } = req.query;
    const result = await getOpenIssues(path);
    res.json(result);
  });

  // GET /repo/structure
  router.get("/structure", async (req, res) => {
    const { path = ".", maxDepth = 3 } = req.query;
    const result = await getProjectStructure(path, { maxDepth: parseInt(maxDepth, 10) });
    res.json(result);
  });

  // POST /repo/analyze
  router.post("/analyze", async (req, res) => {
    const { path = ".", context = "Repository analysis", explanation = "Repository analysis" } = req.body || {};
    const result = await repoAnalyze(path, context);
    res.json(result);
  });

  // POST /repo/summary
  router.post("/summary", async (req, res) => {
    const { path = ".", explanation = "Repository analysis" } = req.body || {};
    
    // Find the repo_summary tool handler
    const summaryTool = tools.find(t => t.name === "repo_summary");
    if (!summaryTool) {
      return res.status(500).json({ ok: false, error: "Tool not found" });
    }

    const result = await summaryTool.handler({ path, explanation });
    res.json(result);
  });

  app.use("/repo", router);
}
