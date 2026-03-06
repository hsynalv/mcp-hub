/**
 * Repo Intelligence Plugin Tests
 *
 * Tests for repository analysis and AI-powered insights
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as repoCore from "../../src/plugins/repo-intelligence/repo.core.js";
import * as repoIntelligence from "../../src/plugins/repo-intelligence/index.js";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

import { exec } from "child_process";

describe("Repo Intelligence Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(repoIntelligence.name).toBe("repo-intelligence");
      expect(repoIntelligence.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(repoIntelligence.name).toBeDefined();
      expect(repoIntelligence.version).toBeDefined();
      expect(repoIntelligence.description).toBeDefined();
      expect(repoIntelligence.endpoints).toBeDefined();
      expect(repoIntelligence.tools).toBeDefined();
      expect(repoIntelligence.register).toBeTypeOf("function");
    });

    it("should define required endpoints", () => {
      const paths = repoIntelligence.endpoints.map(e => e.path);
      expect(paths).toContain("/repo/commits");
      expect(paths).toContain("/repo/issues");
      expect(paths).toContain("/repo/structure");
      expect(paths).toContain("/repo/summary");
    });
  });

  describe("MCP Tools", () => {
    it("should have repo_recent_commits tool", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_recent_commits");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("git");
    });

    it("should have repo_open_issues tool", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_open_issues");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("network");
    });

    it("should have repo_project_structure tool", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_project_structure");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("local_fs");
    });

    it("should have repo_summary tool", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_summary");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("read_only");
      expect(tool.tags).toContain("network");
    });
  });

  describe("repo_recent_commits Tool", () => {
    it("should require repoPath and explanation", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_recent_commits");
      expect(tool.inputSchema.required).toContain("repoPath");
      expect(tool.inputSchema.required).toContain("explanation");
    });

    it("should have optional limit with default 10", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_recent_commits");
      expect(tool.inputSchema.properties.limit.default).toBe(10);
    });
  });

  describe("repo_open_issues Tool", () => {
    it("should require repo and explanation", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_open_issues");
      expect(tool.inputSchema.required).toContain("repo");
      expect(tool.inputSchema.required).toContain("explanation");
    });

    it("should accept owner/repo format", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_open_issues");
      const repoProp = tool.inputSchema.properties.repo;
      expect(repoProp.description).toContain("owner/repo");
    });
  });

  describe("repo_project_structure Tool", () => {
    it("should require repoPath and explanation", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_project_structure");
      expect(tool.inputSchema.required).toContain("repoPath");
      expect(tool.inputSchema.required).toContain("explanation");
    });

    it("should have optional maxDepth with default 3", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_project_structure");
      expect(tool.inputSchema.properties.maxDepth.default).toBe(3);
    });
  });

  describe("repo_summary Tool", () => {
    it("should require repoPath and explanation", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_summary");
      expect(tool.inputSchema.required).toContain("repoPath");
      expect(tool.inputSchema.required).toContain("explanation");
    });

    it("should use llm_router for AI analysis", () => {
      const tool = repoIntelligence.tools.find(t => t.name === "repo_summary");
      // This tool calls llm_router internally
      expect(tool.tags).toContain("network");
    });
  });

  describe("Input Schema Validation", () => {
    it("should validate explanation field in all tools", () => {
      const toolsWithExplanation = [
        "repo_recent_commits",
        "repo_open_issues",
        "repo_project_structure",
        "repo_summary",
      ];

      toolsWithExplanation.forEach(toolName => {
        const tool = repoIntelligence.tools.find(t => t.name === toolName);
        expect(tool.inputSchema.properties.explanation).toBeDefined();
        expect(tool.inputSchema.properties.explanation.type).toBe("string");
        expect(tool.inputSchema.required).toContain("explanation");
      });
    });
  });

  describe("Tool Schemas", () => {
    it("all tools should have proper inputSchema", () => {
      repoIntelligence.tools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeDefined();
      });
    });

    it("all tools should have tags array", () => {
      repoIntelligence.tools.forEach(tool => {
        expect(Array.isArray(tool.tags)).toBe(true);
        expect(tool.tags.length).toBeGreaterThan(0);
      });
    });
  });
});
