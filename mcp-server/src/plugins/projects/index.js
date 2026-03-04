import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import {
  listProjects,
  getProject,
  getProjectEnv,
  createProject,
  upsertProjectEnv,
  deleteProject,
} from "./projects.store.js";

export const name = "projects";
export const version = "1.0.0";
export const description = "Multi-project, multi-environment configuration registry";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET",    path: "/projects",            description: "List all projects",             scope: "read"   },
  { method: "GET",    path: "/projects/validate",   description: "Validate project config",      scope: "read"   },
  { method: "POST",   path: "/projects",            description: "Create a new project",          scope: "write"  },
  { method: "GET",    path: "/projects/:name",      description: "Get project detail",            scope: "read"   },
  { method: "GET",    path: "/projects/:name/:env", description: "Get resolved env config",      scope: "read"   },
  { method: "PUT",    path: "/projects/:name/:env", description: "Update env config",             scope: "write"  },
  { method: "DELETE", path: "/projects/:name",      description: "Delete a project",              scope: "danger" },
  { method: "GET",    path: "/projects/health",     description: "Plugin health",                 scope: "read"   },
];
export const examples = [
  'POST /projects  body: {"key":"percepta","name":"Percepta"}',
  'PUT  /projects/percepta/dev  body: {"github":"hsynalv/percepta_fe","n8nBaseUrl":"http://localhost:5678"}',
  "GET  /projects/percepta/prod",
];

const createSchema = z.object({
  key:  z.string().min(1).regex(/^[a-z0-9-_]+$/, "Key must be lowercase alphanumeric with dashes/underscores"),
  name: z.string().min(1),
});

const envConfigSchema = z.object({
  github:           z.string().optional(),
  notionProjectsDb: z.string().optional(),
  notionTasksDb:    z.string().optional(),
  n8nBaseUrl:       z.string().optional(),
  openapiSpecId:    z.string().optional(),
  slackWebhook:     z.string().optional(),
  description:      z.string().optional(),
}).catchall(z.string());

function validate(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ ok: false, error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /projects
   * List all projects (summary only).
   */
  router.get("/", requireScope("read"), (_req, res) => {
    const projects = listProjects();
    res.json({ ok: true, count: projects.length, projects });
  });

  /**
   * GET /projects/validate
   * Validate project config. Query: ?name=projectKey or ?name=projectKey&env=dev
   * Returns missing/invalid fields.
   */
  router.get("/validate", requireScope("read"), (req, res) => {
    const { name: projectName, env } = req.query;
    if (!projectName) {
      return res.status(400).json({ ok: false, error: "invalid_request", message: "Query param 'name' (project key) required" });
    }

    const project = getProject(projectName);
    if (!project) {
      return res.json({ ok: false, valid: false, errors: [{ field: "project", message: `Project "${projectName}" not found` }] });
    }

    const errors = [];
    if (!project.name) errors.push({ field: "name", message: "Project name is required" });

    if (env) {
      const envConfig = project.envs?.[env];
      if (!envConfig) {
        errors.push({ field: "env", message: `Env "${env}" not found`, availableEnvs: Object.keys(project.envs ?? {}) });
      } else {
        // Optional: validate env config fields
        if (envConfig.n8nBaseUrl && !envConfig.n8nBaseUrl.startsWith("http")) {
          errors.push({ field: "n8nBaseUrl", message: "Must be a valid URL" });
        }
      }
    }

    res.json({
      ok:    errors.length === 0,
      valid: errors.length === 0,
      project: projectName,
      env:    env ?? null,
      errors,
    });
  });

  /**
   * POST /projects
   * Create a new project.
   */
  router.post("/", requireScope("write"), (req, res) => {
    const data = validate(createSchema, req.body, res);
    if (!data) return;

    try {
      const project = createProject(data.key, data.name);
      res.status(201).json({ ok: true, project: { key: data.key, ...project } });
    } catch (err) {
      res.status(409).json({ ok: false, error: "already_exists", message: err.message });
    }
  });

  /**
   * GET /projects/:name
   * Get full project detail (all envs, raw config).
   */
  router.get("/:name", requireScope("read"), (req, res) => {
    const project = getProject(req.params.name);
    if (!project) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, key: req.params.name, project });
  });

  /**
   * GET /projects/:name/:env
   * Get resolved env config. Secret refs are resolved server-side;
   * actual secret values are not returned.
   */
  router.get("/:name/:env", requireScope("read"), (req, res) => {
    const { name: projectName, env } = req.params;
    const envConfig = getProjectEnv(projectName, env);

    if (!envConfig) {
      const project = getProject(projectName);
      if (!project) return res.status(404).json({ ok: false, error: "project_not_found" });
      return res.status(404).json({ ok: false, error: "env_not_found", availableEnvs: Object.keys(project.envs ?? {}) });
    }

    // Return config without rawConfig (server-side only)
    const { rawConfig: _, ...safe } = envConfig;
    res.json({ ok: true, ...safe });
  });

  /**
   * PUT /projects/:name/:env
   * Upsert env config. Merges into existing config.
   */
  router.put("/:name/:env", requireScope("write"), (req, res) => {
    const { name: projectName, env } = req.params;
    const data = validate(envConfigSchema, req.body, res);
    if (!data) return;

    try {
      const updated = upsertProjectEnv(projectName, env, data);
      res.json({ ok: true, project: projectName, env, config: updated });
    } catch (err) {
      res.status(404).json({ ok: false, error: "project_not_found", message: err.message });
    }
  });

  /**
   * DELETE /projects/:name
   * Delete a project and all its env configs.
   */
  router.delete("/:name", requireScope("danger"), (req, res) => {
    const existed = deleteProject(req.params.name);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.name });
  });

  app.use("/projects", router);
}
