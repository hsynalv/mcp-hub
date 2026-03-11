/**
 * Prompt Registry Plugin — Section-based composition engine for AI agents.
 *
 * Phase 3: Sections, context slots ({{brain.*}}, {{current_date}}, etc.),
 * async storage, render API. Backward compatible with v1 (content → sections.identity).
 */

import { Router } from "express";
import { createHash } from "crypto";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog, generateCorrelationId } from "../../core/audit/index.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { loadPrompts, savePrompts } from "./prompts.store.js";
import { resolveSlots } from "./prompts.slots.js";

// ─── Constants ─────────────────────────────────────────────────────────────

const STANDARD_SECTION_KEYS = [
  "identity",
  "capabilities",
  "flow",
  "tool_calling",
  "response_style",
  "code_style",
  "context_understanding",
  "memory_injection",
  "preferences_injection",
  "completion_spec",
  "non_compliance",
  "todo_spec",
];

const SECTION_ORDER = [...STANDARD_SECTION_KEYS];

const MODES = ["agent", "spec", "review", "debug", "chat"];

const handleError = createPluginErrorHandler("prompt-registry");

export const metadata = createMetadata({
  name:        "prompt-registry",
  version:     "2.0.0",
  description: "Section-based system prompt management: compose, version, render with {{slots}} (brain, date, workspace).",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.LOW,
  capabilities: ["read", "write"],
  requires:    [],
  tags:        ["prompts", "templates", "ai", "sections"],
  endpoints: [
    { method: "GET",  path: "/prompts/health",                 description: "Plugin health", scope: "read" },
    { method: "GET",  path: "/prompts",                       description: "List prompts (tag, mode filter)", scope: "read" },
    { method: "GET",  path: "/prompts/:id",                   description: "Get prompt by id", scope: "read" },
    { method: "GET",  path: "/prompts/:id/render",            description: "Render prompt with slot resolution", scope: "read" },
    { method: "POST", path: "/prompts",                      description: "Create prompt (sections or content)", scope: "write" },
    { method: "PUT",  path: "/prompts/:id",                   description: "Update prompt (partial sections)", scope: "write" },
    { method: "GET",  path: "/prompts/:id/versions",          description: "List versions", scope: "read" },
    { method: "POST", path: "/prompts/:id/versions/:v/restore", description: "Restore version", scope: "write" },
    { method: "DELETE", path: "/prompts/:id",                 description: "Delete prompt", scope: "write" },
  ],
  notes: "Slots: {{current_date}}, {{workspace_root}}, {{brain.recent_memories}}, {{brain.user_preferences}}. Brain optional.",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId() {
  return `prompt-${createHash("sha256").update(String(Date.now() + Math.random())).digest("hex").slice(0, 8)}`;
}

function buildTextFromSections(sections) {
  if (!sections || typeof sections !== "object") return "";
  const keys = [...SECTION_ORDER];
  const rest = Object.keys(sections).filter((k) => !SECTION_ORDER.includes(k)).sort();
  for (const k of rest) keys.push(k);
  const parts = [];
  for (const k of keys) {
    const v = sections[k];
    if (v != null && String(v).trim()) parts.push(String(v).trim());
  }
  return parts.join("\n\n");
}

async function audit(operation, actor, payload, success, error) {
  try {
    await auditLog({
      plugin: "prompt-registry",
      operation,
      actor: actor || "anonymous",
      correlationId: generateCorrelationId(),
      success,
      error: error ? String(error) : undefined,
      ...payload,
    });
  } catch { /* noop */ }
}

// ─── MCP Tools ───────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "prompt_list",
    description: "List stored system prompts. Filter by tag or mode.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        tag:  { type: "string", description: "Filter by tag" },
        mode: { type: "string", enum: MODES, description: "Filter by mode" },
      },
    },
    handler: async ({ tag, mode }) => {
      const data = await loadPrompts();
      let list = data.prompts;
      if (tag) list = list.filter((p) => p.tags?.includes(tag));
      if (mode) list = list.filter((p) => (p.mode || "agent") === mode);
      return {
        ok: true,
        data: {
          count: list.length,
          prompts: list.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            mode: p.mode || "agent",
            tags: p.tags,
            version: p.version,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        },
      };
    },
  },

  {
    name: "prompt_get",
    description: "Get a prompt by id, optionally a specific version.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        id:      { type: "string", description: "Prompt ID" },
        version: { type: "number", description: "Version (optional)" },
      },
      required: ["id"],
    },
    handler: async ({ id, version }) => {
      const data = await loadPrompts();
      if (version != null) {
        const vMap = data.versions[id];
        if (!vMap || !vMap[version]) {
          return { ok: false, error: { code: "version_not_found", message: `Version ${version} not found for ${id}` } };
        }
        return { ok: true, data: vMap[version] };
      }
      const p = data.prompts.find((x) => x.id === id);
      if (!p) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      return { ok: true, data: p };
    },
  },

  {
    name: "prompt_render",
    description: "Render a prompt: assemble sections and resolve {{slots}} (e.g. {{current_date}}, {{brain.recent_memories}}). Returns final string for system prompt.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        id:      { type: "string", description: "Prompt ID" },
        context: {
          type: "object",
          description: "Context for slots: project_name, user_prefs, namespace, projectId",
        },
      },
      required: ["id"],
    },
    handler: async ({ id, context = {} }) => {
      const data = await loadPrompts();
      const p = data.prompts.find((x) => x.id === id);
      if (!p) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      const raw = buildTextFromSections(p.sections);
      const rendered = await resolveSlots(raw, context);
      return { ok: true, data: { id, name: p.name, rendered, length: rendered.length } };
    },
  },

  {
    name: "prompt_sections",
    description: "List standard section keys for section-based prompts (identity, flow, tool_calling, etc.).",
    tags: [ToolTags.READ_ONLY],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return {
        ok: true,
        data: {
          standard: STANDARD_SECTION_KEYS,
          description: "Use these keys in sections when creating/updating prompts. Custom keys are allowed.",
        },
      };
    },
  },

  {
    name: "prompt_create",
    description: "Create a prompt. Use sections (object) for section-based, or content (string) for single-block (stored as sections.identity).",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        name:         { type: "string" },
        description:  { type: "string" },
        content:      { type: "string", description: "Legacy: single block (stored as sections.identity)" },
        sections:     { type: "object", description: "Section-based: identity, flow, tool_calling, etc." },
        mode:         { type: "string", enum: MODES, default: "agent" },
        contextSlots: { type: "array", items: { type: "string" }, default: [] },
        toolsBundle:  { type: "array", items: { type: "string" }, default: [] },
        tags:         { type: "array", items: { type: "string" }, default: [] },
        isDefault:    { type: "boolean", default: false },
        explanation:   { type: "string", description: "Optional: why this prompt is being created (audit reason)" },
      },
      required: ["name", "description"],
    },
    handler: async (args, ctx = {}) => {
      const { name, description, content, sections: sec, mode = "agent", contextSlots = [], toolsBundle = [], tags = [], isDefault = false, explanation } = args;
      const data = await loadPrompts();
      if (data.prompts.some((p) => p.name === name)) {
        return { ok: false, error: { code: "duplicate_name", message: `Prompt '${name}' already exists` } };
      }
      const id = generateId();
      const now = new Date().toISOString();
      const sections = sec && typeof sec === "object" && Object.keys(sec).length > 0
        ? sec
        : (content != null ? { identity: content } : { identity: "" });
      const prompt = {
        id,
        name,
        description,
        mode,
        contextSlots,
        toolsBundle,
        tags,
        isDefault,
        version: 1,
        sections,
        createdAt: now,
        updatedAt: now,
      };
      data.prompts.push(prompt);
      if (!data.versions[id]) data.versions[id] = {};
      data.versions[id][1] = { ...prompt };
      await savePrompts(data);
      await audit("create", ctx.actor, { promptId: id, name, ...(explanation && { reason: explanation }) }, true);
      return { ok: true, data: { id, name, version: 1 } };
    },
  },

  {
    name: "prompt_update",
    description: "Update a prompt (partial sections supported). Creates new version.",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        id:          { type: "string" },
        name:        { type: "string" },
        description: { type: "string" },
        content:     { type: "string", description: "Legacy: sets sections.identity" },
        sections:    { type: "object", description: "Partial sections to merge" },
        mode:        { type: "string", enum: MODES },
        contextSlots: { type: "array", items: { type: "string" } },
        toolsBundle:  { type: "array", items: { type: "string" } },
        tags:         { type: "array", items: { type: "string" } },
        isDefault:   { type: "boolean" },
        explanation: { type: "string", description: "Optional: why this update (audit reason)" },
      },
      required: ["id"],
    },
    handler: async (args, ctx = {}) => {
      const { id, name, description, content, sections: sec, mode, contextSlots, toolsBundle, tags, isDefault, explanation } = args;
      const data = await loadPrompts();
      const idx = data.prompts.findIndex((p) => p.id === id);
      if (idx === -1) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      const existing = data.prompts[idx];
      if (name && name !== existing.name && data.prompts.some((p) => p.name === name)) {
        return { ok: false, error: { code: "duplicate_name", message: `Prompt '${name}' already exists` } };
      }
      const newVersion = existing.version + 1;
      const mergedSections = { ...(existing.sections || {}) };
      if (content !== undefined) mergedSections.identity = content;
      if (sec && typeof sec === "object") Object.assign(mergedSections, sec);
      const updated = {
        ...existing,
        name: name ?? existing.name,
        description: description ?? existing.description,
        mode: mode ?? existing.mode ?? "agent",
        contextSlots: contextSlots ?? existing.contextSlots ?? [],
        toolsBundle: toolsBundle ?? existing.toolsBundle ?? [],
        tags: tags ?? existing.tags ?? [],
        isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
        sections: mergedSections,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      };
      data.prompts[idx] = updated;
      data.versions[id] = data.versions[id] || {};
      data.versions[id][newVersion] = { ...updated };
      await savePrompts(data);
      await audit("update", ctx.actor, { promptId: id, newVersion, ...(explanation && { reason: explanation }) }, true);
      return { ok: true, data: { id, name: updated.name, previousVersion: existing.version, newVersion } };
    },
  },

  {
    name: "prompt_delete",
    description: "Delete a prompt and its version history.",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        explanation: { type: "string", description: "Optional: why deleting (audit reason)" },
      },
      required: ["id"],
    },
    handler: async ({ id, explanation }, ctx = {}) => {
      const data = await loadPrompts();
      const idx = data.prompts.findIndex((p) => p.id === id);
      if (idx === -1) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      const deleted = data.prompts.splice(idx, 1)[0];
      delete data.versions[id];
      await savePrompts(data);
      await audit("delete", ctx.actor, { promptId: id, name: deleted.name, ...(explanation && { reason: explanation }) }, true);
      return { ok: true, data: { id, name: deleted.name, deleted: true } };
    },
  },

  {
    name: "prompt_get_versions",
    description: "Get version history for a prompt.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async ({ id }) => {
      const data = await loadPrompts();
      const p = data.prompts.find((x) => x.id === id);
      if (!p) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      const vMap = data.versions[id] || {};
      const versions = Object.keys(vMap).map((v) => parseInt(v, 10)).sort((a, b) => a - b);
      return {
        ok: true,
        data: {
          id,
          name: p.name,
          currentVersion: p.version,
          versions: versions.map((v) => ({ version: v, updatedAt: vMap[v].updatedAt })),
        },
      };
    },
  },

  {
    name: "prompt_restore_version",
    description: "Restore a prompt to a specific version (creates new version as copy).",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        version: { type: "number" },
        explanation: { type: "string", description: "Optional: why restoring (audit reason)" },
      },
      required: ["id", "version"],
    },
    handler: async ({ id, version, explanation }, ctx = {}) => {
      const data = await loadPrompts();
      const idx = data.prompts.findIndex((p) => p.id === id);
      if (idx === -1) return { ok: false, error: { code: "not_found", message: `Prompt ${id} not found` } };
      const vMap = data.versions[id];
      if (!vMap || !vMap[version]) {
        return { ok: false, error: { code: "version_not_found", message: `Version ${version} not found` } };
      }
      const newVersion = data.prompts[idx].version + 1;
      const restored = { ...vMap[version], version: newVersion, updatedAt: new Date().toISOString() };
      data.prompts[idx] = restored;
      vMap[newVersion] = { ...restored };
      await savePrompts(data);
      await audit("restore", ctx.actor, { promptId: id, fromVersion: version, newVersion, ...(explanation && { reason: explanation }) }, true);
      return { ok: true, data: { id, restoredFrom: version, newVersion } };
    },
  },
];

// ─── REST & register ───────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      const data = await loadPrompts();
      res.json({
        ok: true,
        plugin: "prompt-registry",
        version: "2.0.0",
        schema: "v2",
        count: data.prompts.length,
      });
    } catch (err) {
      res.status(500).json(handleError(err, "health"));
    }
  });

  router.get("/", requireScope("read"), async (req, res) => {
    const tool = tools.find((t) => t.name === "prompt_list");
    const result = await tool.handler({ tag: req.query.tag, mode: req.query.mode });
    res.json(result);
  });

  router.get("/sections", requireScope("read"), async (_req, res) => {
    const tool = tools.find((t) => t.name === "prompt_sections");
    const result = await tool.handler({});
    res.json(result);
  });

  router.get("/:id/render", requireScope("read"), async (req, res) => {
    let context = {};
    try {
      if (req.query.context) context = JSON.parse(decodeURIComponent(req.query.context));
    } catch { /* ignore */ }
    const tool = tools.find((t) => t.name === "prompt_render");
    const result = await tool.handler({ id: req.params.id, context });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  router.get("/:id", requireScope("read"), async (req, res) => {
    const version = req.query.version ? parseInt(req.query.version, 10) : undefined;
    const tool = tools.find((t) => t.name === "prompt_get");
    const result = await tool.handler({ id: req.params.id, version });
    res.status(result.ok ? 200 : 404).json(result);
  });

  router.post("/", requireScope("write"), async (req, res) => {
    try {
      const tool = tools.find((t) => t.name === "prompt_create");
      const result = await tool.handler({ ...req.body, explanation: "REST create" }, { actor: req.user?.sub });
      res.status(result.ok ? 201 : 400).json(result);
    } catch (err) {
      res.status(500).json(handleError(err, "create"));
    }
  });

  router.put("/:id", requireScope("write"), async (req, res) => {
    try {
      const tool = tools.find((t) => t.name === "prompt_update");
      const result = await tool.handler({ ...req.body, id: req.params.id }, { actor: req.user?.sub });
      res.status(result.ok ? 200 : 404).json(result);
    } catch (err) {
      res.status(500).json(handleError(err, "update"));
    }
  });

  router.get("/:id/versions", requireScope("read"), async (req, res) => {
    const tool = tools.find((t) => t.name === "prompt_get_versions");
    const result = await tool.handler({ id: req.params.id });
    res.status(result.ok ? 200 : 404).json(result);
  });

  router.post("/:id/versions/:version/restore", requireScope("write"), async (req, res) => {
    const tool = tools.find((t) => t.name === "prompt_restore_version");
    const result = await tool.handler(
      { id: req.params.id, version: parseInt(req.params.version, 10) },
      { actor: req.user?.sub }
    );
    res.status(result.ok ? 200 : 404).json(result);
  });

  router.delete("/:id", requireScope("write"), async (req, res) => {
    const tool = tools.find((t) => t.name === "prompt_delete");
    const result = await tool.handler({ id: req.params.id }, { actor: req.user?.sub });
    res.status(result.ok ? 200 : 404).json(result);
  });

  app.use("/prompts", router);
}
