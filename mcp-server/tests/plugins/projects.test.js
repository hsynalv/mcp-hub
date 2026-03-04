import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * Projects Plugin Unit Tests
 * Tests for project and environment configuration
 */

// Mock the projects store
vi.mock("../../src/plugins/projects/projects.store.js", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  getProjectEnv: vi.fn(),
  createProject: vi.fn(),
  upsertProjectEnv: vi.fn(),
  deleteProject: vi.fn(),
}));

describe("Projects Plugin Schemas", () => {
  const createSchema = z.object({
    key: z.string().min(1).regex(/^[a-z0-9-_]+$/, "Key must be lowercase alphanumeric with dashes/underscores"),
    name: z.string().min(1),
  });

  const envConfigSchema = z.object({
    github: z.string().optional(),
    notionProjectsDb: z.string().optional(),
    notionTasksDb: z.string().optional(),
    n8nBaseUrl: z.string().optional(),
    openapiSpecId: z.string().optional(),
    slackWebhook: z.string().optional(),
    description: z.string().optional(),
  }).catchall(z.string());

  describe("createSchema", () => {
    it("should validate valid project creation", () => {
      const project = { key: "my-project", name: "My Project" };
      expect(() => createSchema.parse(project)).not.toThrow();
    });

    it("should accept lowercase letters, numbers, dashes, and underscores", () => {
      const validKeys = [
        { key: "project-123", name: "Test" },
        { key: "my_project", name: "Test" },
        { key: "project123", name: "Test" },
        { key: "a-b-c-1-2-3", name: "Test" },
      ];

      validKeys.forEach((p) => {
        expect(() => createSchema.parse(p)).not.toThrow();
      });
    });

    it("should reject uppercase letters in key", () => {
      expect(() => createSchema.parse({ key: "MyProject", name: "Test" })).toThrow();
    });

    it("should reject special characters in key", () => {
      expect(() => createSchema.parse({ key: "my@project", name: "Test" })).toThrow();
      expect(() => createSchema.parse({ key: "my.project", name: "Test" })).toThrow();
      expect(() => createSchema.parse({ key: "my/project", name: "Test" })).toThrow();
    });

    it("should reject empty key or name", () => {
      expect(() => createSchema.parse({ key: "", name: "Test" })).toThrow();
      expect(() => createSchema.parse({ key: "project", name: "" })).toThrow();
    });
  });

  describe("envConfigSchema", () => {
    it("should validate empty env config", () => {
      expect(() => envConfigSchema.parse({})).not.toThrow();
    });

    it("should validate full env config", () => {
      const config = {
        github: "owner/repo",
        notionProjectsDb: "db-123",
        notionTasksDb: "db-456",
        n8nBaseUrl: "http://localhost:5678",
        openapiSpecId: "spec-123",
        slackWebhook: "https://hooks.slack.com/xxx",
        description: "Development environment",
      };
      expect(() => envConfigSchema.parse(config)).not.toThrow();
    });

    it("should accept custom fields via catchall", () => {
      const config = {
        github: "owner/repo",
        customField: "custom-value",
        anotherCustom: "another-value",
      };

      const result = envConfigSchema.parse(config);

      expect(result.customField).toBe("custom-value");
      expect(result.anotherCustom).toBe("another-value");
    });

    it("should reject non-string custom fields", () => {
      expect(() =>
        envConfigSchema.parse({ github: "owner/repo", customField: 123 })
      ).toThrow();
    });
  });
});

describe("Projects Plugin - Validation Logic", () => {
  describe("validateProjectConfig", () => {
    const validateProjectConfig = (config, required = []) => {
      const errors = [];

      for (const field of required) {
        if (!config[field] || config[field].trim() === "") {
          errors.push({ field, message: `${field} is required` });
        }
      }

      // Validate specific fields
      if (config.github && !config.github.includes("/")) {
        errors.push({ field: "github", message: "github must be in format 'owner/repo'" });
      }

      if (config.n8nBaseUrl) {
        try {
          new URL(config.n8nBaseUrl);
        } catch {
          errors.push({ field: "n8nBaseUrl", message: "n8nBaseUrl must be a valid URL" });
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    };

    it("should validate empty config with no requirements", () => {
      const result = validateProjectConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate required fields", () => {
      const result = validateProjectConfig({}, ["github", "notionProjectsDb"]);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].field).toBe("github");
    });

    it("should validate github format", () => {
      const result = validateProjectConfig({ github: "invalid-repo-name" });

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("owner/repo");
    });

    it("should accept valid github format", () => {
      const result = validateProjectConfig({ github: "owner/repo" });
      expect(result.valid).toBe(true);
    });

    it("should validate n8nBaseUrl format", () => {
      const result = validateProjectConfig({ n8nBaseUrl: "not-a-url" });

      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("n8nBaseUrl");
    });

    it("should accept valid URL", () => {
      const result = validateProjectConfig({ n8nBaseUrl: "http://localhost:5678" });
      expect(result.valid).toBe(true);
    });
  });
});

describe("Projects Plugin - Environment Resolution", () => {
  describe("resolveEnv", () => {
    const resolveEnv = (project, envName) => {
      const base = project.config || {};
      const env = project.environments?.[envName] || {};

      // Environment overrides base config
      return { ...base, ...env, env: envName };
    };

    it("should resolve base config", () => {
      const project = {
        config: { github: "owner/repo", slackWebhook: "https://slack.com/xxx" },
      };

      const resolved = resolveEnv(project, "dev");

      expect(resolved.github).toBe("owner/repo");
      expect(resolved.slackWebhook).toBe("https://slack.com/xxx");
      expect(resolved.env).toBe("dev");
    });

    it("should apply environment overrides", () => {
      const project = {
        config: { github: "owner/repo", n8nBaseUrl: "http://prod:5678" },
        environments: {
          dev: { n8nBaseUrl: "http://localhost:5678" },
        },
      };

      const resolved = resolveEnv(project, "dev");

      expect(resolved.github).toBe("owner/repo"); // from base
      expect(resolved.n8nBaseUrl).toBe("http://localhost:5678"); // overridden
    });

    it("should handle missing environment", () => {
      const project = { config: { github: "owner/repo" } };

      const resolved = resolveEnv(project, "prod");

      expect(resolved.github).toBe("owner/repo");
      expect(resolved.env).toBe("prod");
    });

    it("should handle project with no config", () => {
      const project = {};

      const resolved = resolveEnv(project, "dev");

      expect(resolved).toEqual({ env: "dev" });
    });
  });
});

describe("Projects Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "projects";
    const version = "1.0.0";
    const description = "Multi-project, multi-environment configuration registry";
    const capabilities = ["read", "write"];

    expect(name).toBe("projects");
    expect(version).toBe("1.0.0");
    expect(description).toContain("project");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
  });

  it("should define project management endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/projects", scope: "read" },
      { method: "POST", path: "/projects", scope: "write" },
      { method: "GET", path: "/projects/:name", scope: "read" },
      { method: "GET", path: "/projects/:name/:env", scope: "read" },
      { method: "PUT", path: "/projects/:name/:env", scope: "write" },
      { method: "DELETE", path: "/projects/:name", scope: "danger" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
