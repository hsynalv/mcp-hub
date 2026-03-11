/**
 * Repo Analyze Service
 *
 * Reusable service for comprehensive repository analysis.
 * Combines commits, issues, structure analysis with LLM insights.
 */

import { getRecentCommits, getProjectStructure, getOpenIssues } from "./repo.core.js";
import { routeTask } from "../llm-router/index.js";

/**
 * Analyze a repository comprehensively
 * @param {string} path - Repository path
 * @param {string} context - Analysis context/purpose
 * @returns {Promise<Object>} Analysis result
 */
export async function repoAnalyze(path = ".", context = "Repository analysis") {
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
      acc[key] = content.slice(0, 1000);
      return acc;
    }, {}),
  };

  // Step 3: Send to LLM for analysis
  const prompt = `Analyze this repository and provide a comprehensive summary:

Repository Data:
${JSON.stringify(repoData, null, 2)}

User Context: ${context}

Please analyze this repository and provide a structured response with:
1. summary - A concise overview of what this project does (2-3 sentences)
2. currentState - Assessment of code quality, organization, and maturity
3. risks - Potential issues, technical debt, or risks identified
4. nextSteps - Actionable recommendations for improvements (prioritized list)
5. techStack - List of technologies, frameworks, and languages used
6. roadmap - High-level roadmap suggestions based on the codebase

Format your response as JSON with these exact keys: summary, currentState, risks (string), nextSteps (array), techStack (array), roadmap (array).`;

  try {
    const llmResult = await routeTask("analysis", prompt, {
      temperature: 0.3,
      maxTokens: 4000,
    });

    // Parse LLM response
    let analysis;
    try {
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
          roadmap: [],
        };
      }
    } catch (parseErr) {
      analysis = {
        summary: llmResult.content.slice(0, 500),
        currentState: "Partial analysis",
        risks: "Parse error: " + parseErr.message,
        nextSteps: [],
        techStack: [repoData.projectType],
        roadmap: [],
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
        roadmap: analysis.roadmap || [],
        rawData: {
          commits: commitsResult.data.summary,
          issues: issuesResult.data.summary,
          files: structureResult.data.stats,
        },
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
}
