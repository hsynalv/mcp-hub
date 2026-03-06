/**
 * Project Orchestrator Plugin Tests
 *
 * Tests for repository scaffolding and AI-powered project generation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as projectOrchestrator from "../../src/plugins/project-orchestrator/index.js";

// Mock fetch for GitHub API calls
global.fetch = vi.fn();

// Mock fs/promises
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe("Project Orchestrator Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "test-token";
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(projectOrchestrator.name).toBe("project-orchestrator");
      expect(projectOrchestrator.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(projectOrchestrator.name).toBeDefined();
      expect(projectOrchestrator.version).toBeDefined();
      expect(projectOrchestrator.description).toBeDefined();
      expect(projectOrchestrator.endpoints).toBeDefined();
      expect(projectOrchestrator.tools).toBeDefined();
      expect(projectOrchestrator.register).toBeTypeOf("function");
    });

    it("should define required endpoints", () => {
      const paths = projectOrchestrator.endpoints.map(e => e.path);
      expect(paths).toContain("/project-orchestrator/draft");
      expect(paths).toContain("/project-orchestrator/repo");
      expect(paths).toContain("/project-orchestrator/structure");
      expect(paths).toContain("/project-orchestrator/tasks");
      expect(paths).toContain("/project-orchestrator/code");
      expect(paths).toContain("/project-orchestrator/pr");
    });
  });

  describe("MCP Tools", () => {
    it("should have project_create_repo tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_repo");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("external_api");
    });

    it("should have project_generate_structure tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_generate_structure");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("destructive");
      expect(tool.tags).toContain("local_fs");
    });

    it("should have project_create_tasks tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_tasks");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("write");
    });

    it("should have project_generate_code tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_generate_code");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("destructive");
    });

    it("should have project_open_pr tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_open_pr");
      expect(tool).toBeDefined();
      expect(tool.tags).toContain("write");
      expect(tool.tags).toContain("external_api");
    });

    it("should have existing project_init tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_init");
      expect(tool).toBeDefined();
    });

    it("should have existing project_execute_next tool", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_execute_next");
      expect(tool).toBeDefined();
    });
  });

  describe("project_create_repo Tool", () => {
    it("should require name, description, and explanation", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_repo");
      const required = tool.inputSchema.required;
      expect(required).toContain("name");
      expect(required).toContain("description");
      expect(required).toContain("explanation");
    });

    it("should create GitHub repository successfully", async () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_repo");
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 12345,
          name: "test-repo",
          full_name: "user/test-repo",
          html_url: "https://github.com/user/test-repo",
          clone_url: "https://github.com/user/test-repo.git",
          ssh_url: "git@github.com:user/test-repo.git",
        }),
      });

      const result = await tool.handler({
        name: "test-repo",
        description: "Test repository",
        isPrivate: false,
        template: "node",
        explanation: "Creating test repository",
      });

      expect(result.ok).toBe(true);
      expect(result.data.name).toBe("test-repo");
      expect(result.data.full_name).toBe("user/test-repo");
      expect(fetch).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Authorization": "token test-token",
          }),
        })
      );
    });

    it("should handle GitHub API errors", async () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_repo");
      
      fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: "Repository already exists" }),
      });

      const result = await tool.handler({
        name: "existing-repo",
        description: "Test",
        explanation: "Test",
      });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("github_error");
    });
  });

  describe("project_generate_structure Tool", () => {
    it("should require idea, techStack, repoPath, and explanation", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_generate_structure");
      const required = tool.inputSchema.required;
      expect(required).toContain("idea");
      expect(required).toContain("techStack");
      expect(required).toContain("repoPath");
      expect(required).toContain("explanation");
    });
  });

  describe("project_create_tasks Tool", () => {
    it("should require idea, techStack, and explanation", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_tasks");
      const required = tool.inputSchema.required;
      expect(required).toContain("idea");
      expect(required).toContain("techStack");
      expect(required).toContain("explanation");
    });

    it("should have optional outputFormat with default markdown", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_tasks");
      const outputFormat = tool.inputSchema.properties.outputFormat;
      expect(outputFormat.default).toBe("markdown");
    });
  });

  describe("project_generate_code Tool", () => {
    it("should require idea, techStack, component, repoPath, and explanation", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_generate_code");
      const required = tool.inputSchema.required;
      expect(required).toContain("idea");
      expect(required).toContain("techStack");
      expect(required).toContain("component");
      expect(required).toContain("repoPath");
      expect(required).toContain("explanation");
    });
  });

  describe("project_open_pr Tool", () => {
    it("should require repo, title, description, and explanation", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_open_pr");
      const required = tool.inputSchema.required;
      expect(required).toContain("repo");
      expect(required).toContain("title");
      expect(required).toContain("description");
      expect(required).toContain("explanation");
    });

    it("should have optional branch with default main", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_open_pr");
      const branch = tool.inputSchema.properties.branch;
      expect(branch.default).toBe("main");
    });

    it("should create issue/PR successfully", async () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_open_pr");
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 98765,
          number: 42,
          html_url: "https://github.com/user/repo/issues/42",
        }),
      });

      const result = await tool.handler({
        repo: "user/repo",
        title: "Initial Setup",
        description: "Setting up the project",
        branch: "main",
        explanation: "Creating initial PR",
      });

      expect(result.ok).toBe(true);
      expect(result.data.issue_number).toBe(42);
      expect(result.data.url).toBe("https://github.com/user/repo/issues/42");
    });
  });

  describe("Input Schema Validation", () => {
    it("should validate explanation field in all tools", () => {
      const toolsWithExplanation = [
        "project_create_repo",
        "project_generate_structure",
        "project_create_tasks",
        "project_generate_code",
        "project_open_pr",
      ];

      toolsWithExplanation.forEach(toolName => {
        const tool = projectOrchestrator.tools.find(t => t.name === toolName);
        expect(tool.inputSchema.properties.explanation).toBeDefined();
        expect(tool.inputSchema.properties.explanation.type).toBe("string");
        expect(tool.inputSchema.required).toContain("explanation");
      });
    });

    it("should have template enum for project_create_repo", () => {
      const tool = projectOrchestrator.tools.find(t => t.name === "project_create_repo");
      const template = tool.inputSchema.properties.template;
      expect(template.enum).toContain("node");
      expect(template.enum).toContain("python");
      expect(template.enum).toContain("nextjs");
      expect(template.enum).toContain("go");
      expect(template.enum).toContain("rust");
      expect(template.enum).toContain("empty");
    });
  });
});
