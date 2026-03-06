/**
 * Prompt Registry Plugin
 *
 * Centralized system prompt management with versioning for AI agents.
 */

import { Router } from "express";
import { ToolTags } from "../../core/tool-registry.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

// Store prompts in cache directory
function getStorePath() {
  const dir = process.env.CATALOG_CACHE_DIR || "./cache";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "prompts.json");
}

function loadPrompts() {
  const p = getStorePath();
  if (!existsSync(p)) return { prompts: [], versions: {} };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { prompts: [], versions: {} };
  }
}

function savePrompts(data) {
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2));
}

function generateId() {
  return `prompt-${createHash("sha256").update(String(Date.now() + Math.random())).digest("hex").slice(0, 8)}`;
}

export const name = "prompt-registry";
export const version = "1.0.0";
export const description = "Store and manage system prompts with versioning for AI agents";
export const capabilities = ["read", "write"];
export const requires = [];

export const endpoints = [
  { method: "GET", path: "/prompts", description: "List all prompts", scope: "read" },
  { method: "GET", path: "/prompts/:id", description: "Get specific prompt", scope: "read" },
  { method: "POST", path: "/prompts", description: "Create or update prompt", scope: "write" },
  { method: "GET", path: "/prompts/:id/versions", description: "Get prompt versions", scope: "read" },
  { method: "POST", path: "/prompts/:id/versions/:version/restore", description: "Restore a version", scope: "write" },
  { method: "DELETE", path: "/prompts/:id", description: "Delete a prompt", scope: "write" },
];

// ─── MCP Tools ────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "prompt_list",
    description: "List all stored system prompts",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "Filter by tag (optional)",
        },
        explanation: {
          type: "string",
          description: "Explain why you need to list prompts",
        },
      },
      required: ["explanation"],
    },
    tags: [ToolTags.READ_ONLY],
    handler: async ({ tag, explanation }) => {
      const data = loadPrompts();
      let prompts = data.prompts;
      
      if (tag) {
        prompts = prompts.filter(p => p.tags?.includes(tag));
      }
      
      return {
        ok: true,
        data: {
          count: prompts.length,
          prompts: prompts.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            tags: p.tags,
            version: p.version,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_get",
    description: "Get a specific prompt by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prompt ID",
        },
        version: {
          type: "number",
          description: "Specific version (optional, default: latest)",
        },
        explanation: {
          type: "string",
          description: "Explain why you need this prompt",
        },
      },
      required: ["id", "explanation"],
    },
    tags: [ToolTags.READ_ONLY],
    handler: async ({ id, version, explanation }) => {
      const data = loadPrompts();
      
      // Check if requesting a specific version
      if (version !== undefined) {
        const versions = data.versions[id];
        if (!versions || !versions[version]) {
          return {
            ok: false,
            error: { code: "version_not_found", message: `Version ${version} not found for prompt ${id}` },
          };
        }
        return {
          ok: true,
          data: {
            ...versions[version],
            explanation,
          },
        };
      }
      
      const prompt = data.prompts.find(p => p.id === id);
      if (!prompt) {
        return {
          ok: false,
          error: { code: "not_found", message: `Prompt ${id} not found` },
        };
      }
      
      return {
        ok: true,
        data: {
          ...prompt,
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_create",
    description: "Create a new system prompt",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Unique name for the prompt",
        },
        description: {
          type: "string",
          description: "Brief description of the prompt's purpose",
        },
        content: {
          type: "string",
          description: "The actual prompt text",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
          default: [],
        },
        isDefault: {
          type: "boolean",
          description: "Whether this is the default prompt for its tags",
          default: false,
        },
        explanation: {
          type: "string",
          description: "Explain why you're creating this prompt",
        },
      },
      required: ["name", "description", "content", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    handler: async ({ name, description, content, tags = [], isDefault = false, explanation }) => {
      const data = loadPrompts();
      
      // Check for duplicate name
      if (data.prompts.some(p => p.name === name)) {
        return {
          ok: false,
          error: { code: "duplicate_name", message: `Prompt with name '${name}' already exists` },
        };
      }
      
      const id = generateId();
      const now = new Date().toISOString();
      const prompt = {
        id,
        name,
        description,
        content,
        tags,
        isDefault,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      data.prompts.push(prompt);
      
      // Store initial version
      if (!data.versions[id]) data.versions[id] = {};
      data.versions[id][1] = { ...prompt };
      
      savePrompts(data);
      
      return {
        ok: true,
        data: {
          id,
          name,
          version: 1,
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_update",
    description: "Update an existing prompt (creates new version)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prompt ID to update",
        },
        name: {
          type: "string",
          description: "New name (optional)",
        },
        description: {
          type: "string",
          description: "New description (optional)",
        },
        content: {
          type: "string",
          description: "New content (optional)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags (optional)",
        },
        isDefault: {
          type: "boolean",
          description: "Update default status (optional)",
        },
        explanation: {
          type: "string",
          description: "Explain what you're updating and why",
        },
      },
      required: ["id", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    handler: async ({ id, name, description, content, tags, isDefault, explanation }) => {
      const data = loadPrompts();
      const idx = data.prompts.findIndex(p => p.id === id);
      
      if (idx === -1) {
        return {
          ok: false,
          error: { code: "not_found", message: `Prompt ${id} not found` },
        };
      }
      
      const existing = data.prompts[idx];
      
      // Check for name conflict if renaming
      if (name && name !== existing.name && data.prompts.some(p => p.name === name)) {
        return {
          ok: false,
          error: { code: "duplicate_name", message: `Prompt with name '${name}' already exists` },
        };
      }
      
      // Create new version
      const newVersion = existing.version + 1;
      const updated = {
        ...existing,
        name: name || existing.name,
        description: description || existing.description,
        content: content || existing.content,
        tags: tags || existing.tags,
        isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      };
      
      data.prompts[idx] = updated;
      
      // Store version
      if (!data.versions[id]) data.versions[id] = {};
      data.versions[id][newVersion] = { ...updated };
      
      savePrompts(data);
      
      return {
        ok: true,
        data: {
          id,
          name: updated.name,
          previousVersion: existing.version,
          newVersion,
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_delete",
    description: "Delete a prompt",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prompt ID to delete",
        },
        explanation: {
          type: "string",
          description: "Explain why you're deleting this prompt",
        },
      },
      required: ["id", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    handler: async ({ id, explanation }) => {
      const data = loadPrompts();
      const idx = data.prompts.findIndex(p => p.id === id);
      
      if (idx === -1) {
        return {
          ok: false,
          error: { code: "not_found", message: `Prompt ${id} not found` },
        };
      }
      
      const deleted = data.prompts.splice(idx, 1)[0];
      
      // Clean up versions
      delete data.versions[id];
      
      savePrompts(data);
      
      return {
        ok: true,
        data: {
          id,
          name: deleted.name,
          deleted: true,
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_get_versions",
    description: "Get version history of a prompt",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prompt ID",
        },
        explanation: {
          type: "string",
          description: "Explain why you need version history",
        },
      },
      required: ["id", "explanation"],
    },
    tags: [ToolTags.READ_ONLY],
    handler: async ({ id, explanation }) => {
      const data = loadPrompts();
      const prompt = data.prompts.find(p => p.id === id);
      
      if (!prompt) {
        return {
          ok: false,
          error: { code: "not_found", message: `Prompt ${id} not found` },
        };
      }
      
      const versions = data.versions[id] || {};
      const versionList = Object.keys(versions).map(v => parseInt(v)).sort((a, b) => a - b);
      
      return {
        ok: true,
        data: {
          id,
          name: prompt.name,
          currentVersion: prompt.version,
          versions: versionList.map(v => ({
            version: v,
            createdAt: versions[v].updatedAt,
            description: versions[v].description,
          })),
          explanation,
        },
      };
    },
  },
  {
    name: "prompt_restore_version",
    description: "Restore a prompt to a specific version",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prompt ID",
        },
        version: {
          type: "number",
          description: "Version number to restore",
        },
        explanation: {
          type: "string",
          description: "Explain why you're restoring this version",
        },
      },
      required: ["id", "version", "explanation"],
    },
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    handler: async ({ id, version, explanation }) => {
      const data = loadPrompts();
      const prompt = data.prompts.find(p => p.id === id);
      
      if (!prompt) {
        return {
          ok: false,
          error: { code: "not_found", message: `Prompt ${id} not found` },
        };
      }
      
      const versions = data.versions[id];
      if (!versions || !versions[version]) {
        return {
          ok: false,
          error: { code: "version_not_found", message: `Version ${version} not found` },
        };
      }
      
      // Create new version based on the restored one
      const newVersion = prompt.version + 1;
      const restored = {
        ...versions[version],
        version: newVersion,
        updatedAt: new Date().toISOString(),
      };
      
      const idx = data.prompts.findIndex(p => p.id === id);
      data.prompts[idx] = restored;
      
      // Store as new version
      data.versions[id][newVersion] = { ...restored };
      
      savePrompts(data);
      
      return {
        ok: true,
        data: {
          id,
          name: restored.name,
          restoredFrom: version,
          newVersion,
          explanation,
        },
      };
    },
  },
];

// ─── REST API Endpoints ───────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // GET /prompts
  router.get("/", async (req, res) => {
    const { tag } = req.query;
    const tool = tools.find(t => t.name === "prompt_list");
    const result = await tool.handler({ tag, explanation: "REST API list request" });
    res.json(result);
  });

  // GET /prompts/:id
  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    const { version } = req.query;
    const tool = tools.find(t => t.name === "prompt_get");
    const result = await tool.handler({ id, version: version ? parseInt(version, 10) : undefined, explanation: "REST API get request" });
    res.status(result.ok ? 200 : 404).json(result);
  });

  // POST /prompts
  router.post("/", async (req, res) => {
    const { name, description, content, tags, isDefault } = req.body;
    
    // Check if updating existing
    const data = loadPrompts();
    const existing = data.prompts.find(p => p.name === name);
    
    if (existing) {
      // Update existing
      const tool = tools.find(t => t.name === "prompt_update");
      const result = await tool.handler({
        id: existing.id,
        name,
        description,
        content,
        tags,
        isDefault,
        explanation: "REST API update request",
      });
      res.status(result.ok ? 200 : 400).json(result);
    } else {
      // Create new
      const tool = tools.find(t => t.name === "prompt_create");
      const result = await tool.handler({
        name,
        description,
        content,
        tags,
        isDefault,
        explanation: "REST API create request",
      });
      res.status(result.ok ? 201 : 400).json(result);
    }
  });

  // GET /prompts/:id/versions
  router.get("/:id/versions", async (req, res) => {
    const { id } = req.params;
    const tool = tools.find(t => t.name === "prompt_get_versions");
    const result = await tool.handler({ id, explanation: "REST API versions request" });
    res.status(result.ok ? 200 : 404).json(result);
  });

  // POST /prompts/:id/versions/:version/restore
  router.post("/:id/versions/:version/restore", async (req, res) => {
    const { id, version } = req.params;
    const tool = tools.find(t => t.name === "prompt_restore_version");
    const result = await tool.handler({ id, version: parseInt(version, 10), explanation: "REST API restore request" });
    res.status(result.ok ? 200 : 404).json(result);
  });

  // DELETE /prompts/:id
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const tool = tools.find(t => t.name === "prompt_delete");
    const result = await tool.handler({ id, explanation: "REST API delete request" });
    res.status(result.ok ? 200 : 404).json(result);
  });

  app.use("/prompts", router);
  console.log("[Prompt Registry] Plugin registered with endpoints: GET /prompts, POST /prompts, GET /prompts/:id, GET /prompts/:id/versions");
}
