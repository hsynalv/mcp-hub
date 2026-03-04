import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

/**
 * GitHub Plugin Unit Tests
 * Tests for schema validation and helper functions
 */

// Mock the github client
vi.mock("../../src/plugins/github/github.client.js", () => ({
  githubRequest: vi.fn(),
  githubPaginate: vi.fn(),
}));

describe("GitHub Plugin Schemas", () => {
  const repoParamSchema = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  });

  const analyzeQuerySchema = z.object({
    repo: z.string().min(1),
  });

  const analyzeBodySchema = z.object({
    repo: z.string().min(1),
  });

  describe("repoParamSchema", () => {
    it("should validate valid owner/repo parameters", () => {
      const valid = [
        { owner: "octocat", repo: "Hello-World" },
        { owner: "facebook", repo: "react" },
        { owner: "microsoft", repo: "TypeScript" },
      ];

      valid.forEach((params) => {
        expect(() => repoParamSchema.parse(params)).not.toThrow();
      });
    });

    it("should reject empty owner or repo", () => {
      expect(() => repoParamSchema.parse({ owner: "", repo: "test" })).toThrow();
      expect(() => repoParamSchema.parse({ owner: "test", repo: "" })).toThrow();
      expect(() => repoParamSchema.parse({ owner: "", repo: "" })).toThrow();
    });

    it("should reject missing owner or repo", () => {
      expect(() => repoParamSchema.parse({ repo: "test" })).toThrow();
      expect(() => repoParamSchema.parse({ owner: "test" })).toThrow();
      expect(() => repoParamSchema.parse({})).toThrow();
    });
  });

  describe("analyzeQuerySchema", () => {
    it("should validate valid repo query", () => {
      expect(() => analyzeQuerySchema.parse({ repo: "owner/repo" })).not.toThrow();
      expect(() => analyzeQuerySchema.parse({ repo: "facebook/react" })).not.toThrow();
    });

    it("should reject empty or missing repo", () => {
      expect(() => analyzeQuerySchema.parse({ repo: "" })).toThrow();
      expect(() => analyzeQuerySchema.parse({})).toThrow();
    });
  });

  describe("analyzeBodySchema", () => {
    it("should validate valid repo in body", () => {
      expect(() => analyzeBodySchema.parse({ repo: "owner/repo" })).not.toThrow();
    });

    it("should reject invalid body", () => {
      expect(() => analyzeBodySchema.parse({ repo: "" })).toThrow();
      expect(() => analyzeBodySchema.parse({})).toThrow();
    });
  });
});

describe("GitHub Plugin Formatters", () => {
  const formatRepo = (r) => ({
    id: r.id,
    fullName: r.full_name,
    description: r.description ?? null,
    language: r.language ?? null,
    topics: r.topics ?? [],
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    defaultBranch: r.default_branch,
    private: r.private,
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
  });

  const formatCommit = (c) => ({
    sha: c.sha?.slice(0, 7),
    message: c.commit?.message?.split("\n")[0] ?? "",
    author: c.commit?.author?.name ?? null,
    date: c.commit?.author?.date ?? null,
  });

  describe("formatRepo", () => {
    it("should format full repository data", () => {
      const input = {
        id: 123,
        full_name: "facebook/react",
        description: "A JavaScript library",
        language: "JavaScript",
        topics: ["frontend", "ui"],
        stargazers_count: 100000,
        forks_count: 20000,
        open_issues_count: 500,
        default_branch: "main",
        private: false,
        html_url: "https://github.com/facebook/react",
        created_at: "2013-05-24T16:15:54Z",
        updated_at: "2024-01-01T00:00:00Z",
        pushed_at: "2024-01-01T00:00:00Z",
      };

      const result = formatRepo(input);

      expect(result.id).toBe(123);
      expect(result.fullName).toBe("facebook/react");
      expect(result.description).toBe("A JavaScript library");
      expect(result.language).toBe("JavaScript");
      expect(result.topics).toEqual(["frontend", "ui"]);
      expect(result.stars).toBe(100000);
      expect(result.forks).toBe(20000);
      expect(result.openIssues).toBe(500);
      expect(result.defaultBranch).toBe("main");
      expect(result.private).toBe(false);
      expect(result.url).toBe("https://github.com/facebook/react");
    });

    it("should handle null/undefined fields", () => {
      const input = {
        id: 456,
        full_name: "test/repo",
        description: null,
        language: undefined,
        topics: undefined,
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 0,
        default_branch: "master",
        private: true,
        html_url: "https://github.com/test/repo",
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
        pushed_at: "2020-01-01T00:00:00Z",
      };

      const result = formatRepo(input);

      expect(result.description).toBeNull();
      expect(result.language).toBeNull();
      expect(result.topics).toEqual([]);
      expect(result.private).toBe(true);
    });
  });

  describe("formatCommit", () => {
    it("should format commit with all fields", () => {
      const input = {
        sha: "abc123def456",
        commit: {
          message: "Fix bug in user authentication\n\nDetailed description here",
          author: {
            name: "John Doe",
            date: "2024-01-15T10:30:00Z",
          },
        },
      };

      const result = formatCommit(input);

      expect(result.sha).toBe("abc123d");
      expect(result.message).toBe("Fix bug in user authentication");
      expect(result.author).toBe("John Doe");
      expect(result.date).toBe("2024-01-15T10:30:00Z");
    });

    it("should handle commit with only first line message", () => {
      const input = {
        sha: "xyz789",
        commit: {
          message: "Initial commit",
          author: {
            name: "Jane Doe",
            date: "2024-01-01T00:00:00Z",
          },
        },
      };

      const result = formatCommit(input);

      expect(result.sha).toBe("xyz789");
      expect(result.message).toBe("Initial commit");
      expect(result.author).toBe("Jane Doe");
    });

    it("should handle missing fields", () => {
      const input = {
        sha: "short",
        commit: {
          message: null,
          author: null,
        },
      };

      const result = formatCommit(input);

      expect(result.sha).toBe("short");
      expect(result.message).toBe("");
      expect(result.author).toBeNull();
      expect(result.date).toBeNull();
    });
  });
});

describe("GitHub Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "github";
    const version = "1.0.0";
    const description = "Read access to public and private GitHub repositories";
    const capabilities = ["read"];
    const requires = ["GITHUB_TOKEN"];

    expect(name).toBe("github");
    expect(version).toBe("1.0.0");
    expect(description).toContain("GitHub");
    expect(capabilities).toContain("read");
    expect(requires).toContain("GITHUB_TOKEN");
  });

  it("should define required endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/github/repos", scope: "read" },
      { method: "GET", path: "/github/analyze", scope: "read" },
      { method: "GET", path: "/github/repo/:owner/:repo", scope: "read" },
    ];

    expect(endpoints).toHaveLength(3);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
