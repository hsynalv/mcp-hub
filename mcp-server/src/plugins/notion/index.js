import { Router } from "express";
import { z } from "zod";
import { notionRequest } from "./notion.client.js";
import { toNotionBlock, toNotionBlocks, taskDatabaseSchema, toTaskProperties, buildNotionProperty, buildDatabaseSchema } from "./blocks.js";
import { config } from "../../core/config.js";
import { validateBody } from "../../core/validate.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { withResilience } from "../../core/resilience.js";

const pluginError = createPluginErrorHandler("notion");

export const metadata = createMetadata({
  name: "notion",
  version: "1.1.0",
  description: "Notion pages, databases, projects and tasks",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "notion", "pages", "databases", "tasks"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: false,
  hasTests: false,
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  tags: ["notion", "pages", "databases", "tasks", "projects"],
});

// ── Field name configuration ───────────────────────────────────────────────
// All Notion database field names are configurable via env vars.
// This makes the plugin work with any workspace schema, not just the default.
export const notionFields = {
  // Projects database field names
  projectName:     process.env.NOTION_PROJECT_NAME_FIELD     || "Name",
  projectStatus:   process.env.NOTION_PROJECT_STATUS_FIELD   || "Status",
  projectPriority: process.env.NOTION_PROJECT_PRIORITY_FIELD || "Öncelik",
  projectStart:    process.env.NOTION_PROJECT_START_FIELD    || "Başlangıç",
  projectEnd:      process.env.NOTION_PROJECT_END_FIELD      || "bitiş",
  // Projects status values
  statusNotStarted: process.env.NOTION_STATUS_NOT_STARTED || "Yapılmadı",
  statusInProgress: process.env.NOTION_STATUS_IN_PROGRESS || "Yapılıyor",
  statusDone:       process.env.NOTION_STATUS_DONE        || "Tamamlandı",
  // Priority values
  priorityLow:    process.env.NOTION_PRIORITY_LOW    || "Az",
  priorityNormal: process.env.NOTION_PRIORITY_NORMAL || "Normal",
  priorityHigh:   process.env.NOTION_PRIORITY_HIGH   || "Yüksek",
  // Tasks database field names
  taskName:    process.env.NOTION_TASK_NAME_FIELD    || "Görev",
  taskDueDate: process.env.NOTION_TASK_DUE_DATE_FIELD|| "Son Tarih",
  taskProject: process.env.NOTION_TASK_PROJECT_FIELD || "Projeler",
  taskDone:    process.env.NOTION_TASK_DONE_FIELD    || "",
};

export const name = "notion";
export const version = "1.1.0";
export const description = "Notion pages, databases, projects and tasks";
export const capabilities = ["read", "write"];
export const requires = ["NOTION_API_KEY"];
export const endpoints = [
  { method: "GET",    path: "/notion/search",              description: "Search pages and databases",                 scope: "read"  },
  { method: "GET",    path: "/notion/sections",            description: "List all accessible pages and databases",    scope: "read"  },
  { method: "GET",    path: "/notion/projects",            description: "List projects from Projeler database",       scope: "read"  },
  { method: "POST",   path: "/notion/projects",            description: "Create a project",                           scope: "write" },
  { method: "GET",    path: "/notion/tasks",               description: "List tasks from Yapılacaklar database",      scope: "read"  },
  { method: "POST",   path: "/notion/tasks",               description: "Create a task",                              scope: "write" },
  { method: "POST",   path: "/notion/setup-project",       description: "Create project + all tasks in one call",     scope: "write" },
  { method: "POST",   path: "/notion/row",                 description: "Add a row to any database with content",     scope: "write" },
  { method: "POST",   path: "/notion/rows/archive",        description: "Bulk archive (soft-delete) rows by ID",      scope: "write" },
  { method: "DELETE", path: "/notion/row/:pageId",         description: "Archive a single row",                       scope: "write" },
  { method: "POST",   path: "/notion/pages",               description: "Create a page",                              scope: "write" },
  { method: "PATCH",  path: "/notion/pages/:id/append",    description: "Append blocks to a page",                    scope: "write" },
  { method: "GET",    path: "/notion/pages/:id/blocks",    description: "Get page content blocks",                    scope: "read"  },
  { method: "PATCH",  path: "/notion/databases/rows/:id",        description: "Update a row's properties",                   scope: "write" },
  { method: "PATCH",  path: "/notion/databases/:id/properties",  description: "Add or rename columns on an existing database", scope: "write" },
  { method: "POST",   path: "/notion/templates/apply",       description: "Apply a page template",                      scope: "write" },
  { method: "POST",   path: "/notion/templates/pages",       description: "Create page from template",                  scope: "write" },
];
export const examples = [
  "POST /notion/setup-project  body: {name, status, oncelik, tasks:[{gorev}]}",
  "GET  /notion/projects?status=Yapılıyor",
  "POST /notion/row  body: {databaseId, title, content}",
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "notion_search",
    description: "Search pages and databases in Notion",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        type: { type: "string", enum: ["page", "database"], description: "Filter by type" },
        limit: { type: "number", default: 20 },
      },
    },
    handler: async (args) => {
      const body = { page_size: args.limit || 20 };
      if (args.query) body.query = args.query;
      if (args.type) body.filter = { value: args.type, property: "object" };
      const result = await notionRequest("POST", "/search", body);
      if (!result.ok) return result;
      return { ok: true, data: result.data.results };
    },
  },
  {
    name: "notion_create_page",
    description: "Create a new Notion page",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title" },
        parentPageId: { type: "string", description: "Parent page ID" },
        icon: { type: "string", description: "Emoji icon" },
        blocks: { type: "array", description: "Content blocks" },
        explanation: { type: "string", description: "Explain why you are creating this page" },
      },
      required: ["title", "explanation"],
    },
    handler: async (args) => {
      const payload = {
        parent: { page_id: args.parentPageId },
        properties: { title: [{ text: { content: args.title } }] },
      };
      if (args.icon) payload.icon = { type: "emoji", emoji: args.icon };
      if (args.blocks) payload.children = toNotionBlocks(args.blocks);
      const result = await notionRequest("POST", "/pages", payload);
      if (!result.ok) return result;
      return { 
        ok: true, 
        data: { 
          id: result.data.id, 
          url: result.data.url,
          explanation: args.explanation,
        } 
      };
    },
  },
  {
    name: "notion_update_page",
    description: "Update an existing Notion page properties",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Page ID to update" },
        title: { type: "string", description: "New page title" },
        icon: { type: "string", description: "New emoji icon" },
        archived: { type: "boolean", description: "Archive or restore page" },
        explanation: { type: "string", description: "Explain why you are updating this page" },
      },
      required: ["pageId", "explanation"],
    },
    handler: async (args) => {
      const properties = {};
      if (args.title) {
        properties.title = [{ text: { content: args.title } }];
      }
      
      const payload = { properties };
      if (args.icon) payload.icon = { type: "emoji", emoji: args.icon };
      if (typeof args.archived === "boolean") payload.archived = args.archived;
      
      const result = await notionRequest("PATCH", `/pages/${args.pageId}`, payload);
      if (!result.ok) return result;
      return { 
        ok: true, 
        data: { 
          id: result.data.id, 
          url: result.data.url,
          explanation: args.explanation,
        } 
      };
    },
  },
  {
    name: "notion_append_block",
    description: "Append content blocks to an existing Notion page",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Page ID to append to" },
        blocks: { 
          type: "array", 
          description: "Content blocks to append",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Block type (paragraph, heading_1, heading_2, heading_3, bullet_list_item, numbered_list_item, to_do, code, etc.)" },
              text: { type: "string", description: "Block text content" },
              checked: { type: "boolean", description: "For to_do blocks" },
              language: { type: "string", description: "For code blocks" },
            },
          },
        },
        explanation: { type: "string", description: "Explain why you are appending to this page" },
      },
      required: ["pageId", "blocks", "explanation"],
    },
    handler: async (args) => {
      const result = await notionRequest("PATCH", `/blocks/${args.pageId}/children`, {
        children: toNotionBlocks(args.blocks),
      });
      if (!result.ok) return result;
      return { 
        ok: true, 
        data: { 
          pageId: args.pageId,
          appended: args.blocks.length,
          explanation: args.explanation,
        } 
      };
    },
  },
  {
    name: "notion_apply_template",
    description: "Apply a template to create structured Notion content",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: ["feature_delivery", "task"], description: "Template name" },
        parentPageId: { type: "string", description: "Parent page ID" },
        title: { type: "string", description: "Page title" },
        summary: { type: "string" },
        criteria: { type: "array", items: { type: "string" } },
        plan: { type: "string" },
        prUrl: { type: "string" },
        releaseNotes: { type: "string" },
      },
      required: ["template", "parentPageId", "title"],
    },
    handler: async (args) => {
      const templateResult = await applyTemplate(args.template, args);
      if (!templateResult.ok) return templateResult;

      const payload = {
        parent: { page_id: args.parentPageId },
        properties: { title: [{ text: { content: templateResult.data.title } }] },
        icon: { type: "emoji", emoji: templateResult.data.icon },
        children: templateResult.data.blocks,
      };

      const result = await notionRequest("POST", "/pages", payload);
      if (!result.ok) return result;
      return { ok: true, data: { id: result.data.id, url: result.data.url, template: args.template } };
    },
  },
  {
    name: "notion_create_task",
    description: "Create a task in a Notion database",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID" },
        name: { type: "string", description: "Task name" },
        status: { type: "string", enum: ["Todo", "In Progress", "Done", "Blocked"] },
        priority: { type: "string", enum: ["High", "Medium", "Low"] },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["databaseId", "name"],
    },
    handler: async (args) => createTask(args.databaseId, args),
  },
  {
    name: "notion_attach_link",
    description: "Attach a link (bookmark) to a Notion page",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Page ID" },
        url: { type: "string", description: "URL to attach" },
        label: { type: "string", description: "Link label" },
      },
      required: ["pageId", "url"],
    },
    handler: async (args) => attachLink(args.pageId, args.url, args.label),
  },
  {
    name: "notion_create_database",
    description: "Create a Notion database with custom columns inside a page. Supports all Notion column types: title, rich_text, number, select, multi_select, status, date, checkbox, url, email, phone_number, people, files.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        parentPageId: { type: "string", description: "Parent page ID where the database will be created" },
        title: { type: "string", description: "Database title (e.g. 'Sprint Tasks', 'Bug Tracker')" },
        inline: { type: "boolean", description: "Create as inline database (default: true)", default: true },
        columns: {
          type: "array",
          description: "Column definitions. One 'title' type column is required. If omitted, default task schema is used.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Column name" },
              type: {
                type: "string",
                enum: ["title", "rich_text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone_number", "people", "files", "created_time", "created_by", "last_edited_time", "last_edited_by"],
                description: "Column type",
              },
              options: { type: "array", items: { type: "string" }, description: "Options for select/multi_select/status columns" },
              format: { type: "string", description: "Number format (number, dollar, percent, euro, etc.)" },
            },
            required: ["name", "type"],
          },
        },
        explanation: { type: "string", description: "Explain why you are creating this database" },
      },
      required: ["parentPageId", "explanation"],
    },
    handler: async (args) => {
      let properties;
      if (args.columns && args.columns.length > 0) {
        properties = buildDatabaseSchema(args.columns);
      } else {
        const defaultSchema = taskDatabaseSchema(args.title || "Tasks");
        properties = defaultSchema.properties;
      }

      const result = await notionRequest("POST", "/databases", {
        parent: { type: "page_id", page_id: args.parentPageId },
        title: [{ type: "text", text: { content: args.title || "Tasks" } }],
        properties,
        is_inline: args.inline !== false,
      });

      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          databaseId: result.data.id,
          url: result.data.url,
          title: args.title,
          columns: Object.entries(result.data.properties ?? {}).map(([name, prop]) => ({ name, type: prop.type })),
          explanation: args.explanation,
        },
      };
    },
  },
  {
    name: "notion_add_columns",
    description: "Add new columns to an existing Notion database. Use this to extend a database's schema after creation.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID to add columns to" },
        columns: {
          type: "array",
          description: "Columns to add",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Column name" },
              type: {
                type: "string",
                enum: ["rich_text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone_number", "people", "files"],
                description: "Column type",
              },
              options: { type: "array", items: { type: "string" }, description: "Options for select/multi_select/status" },
              format: { type: "string", description: "Format for number columns (number, dollar, percent, euro...)" },
            },
            required: ["name", "type"],
          },
        },
        explanation: { type: "string", description: "Explain why you are adding these columns" },
      },
      required: ["databaseId", "columns", "explanation"],
    },
    handler: async (args) => {
      const properties = {};
      for (const col of args.columns) {
        properties[col.name] = buildNotionProperty(col.type, col);
      }

      const result = await notionRequest("PATCH", `/databases/${args.databaseId}`, { properties });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          databaseId: args.databaseId,
          addedColumns: args.columns.map(c => ({ name: c.name, type: c.type })),
          fullSchema: Object.entries(result.data.properties ?? {}).map(([name, prop]) => ({ name, type: prop.type })),
          explanation: args.explanation,
        },
      };
    },
  },
  {
    name: "notion_rename_column",
    description: "Rename a column in a Notion database.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID" },
        currentName: { type: "string", description: "Current column name" },
        newName: { type: "string", description: "New column name" },
        explanation: { type: "string", description: "Explain why you are renaming this column" },
      },
      required: ["databaseId", "currentName", "newName", "explanation"],
    },
    handler: async (args) => {
      const result = await notionRequest("PATCH", `/databases/${args.databaseId}`, {
        properties: { [args.currentName]: { name: args.newName } },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          databaseId: args.databaseId,
          renamed: { from: args.currentName, to: args.newName },
          explanation: args.explanation,
        },
      };
    },
  },
  {
    name: "notion_get_database_schema",
    description: "Get the schema (columns and their types) of a Notion database",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID" },
      },
      required: ["databaseId"],
    },
    handler: async (args) => {
      const result = await notionRequest("GET", `/databases/${args.databaseId}`);
      if (!result.ok) return result;

      const schema = Object.entries(result.data.properties ?? {}).map(([name, prop]) => {
        const entry = { name, type: prop.type };
        if (prop.select?.options) entry.options = prop.select.options.map(o => o.name);
        if (prop.multi_select?.options) entry.options = prop.multi_select.options.map(o => o.name);
        if (prop.status?.options) entry.options = prop.status.options.map(o => o.name);
        if (prop.number?.format) entry.format = prop.number.format;
        return entry;
      });

      return {
        ok: true,
        data: {
          databaseId: args.databaseId,
          title: result.data.title?.[0]?.plain_text || "Untitled",
          url: result.data.url,
          columns: schema,
          columnCount: schema.length,
        },
      };
    },
  },
  {
    name: "notion_add_row",
    description: "Add a row to any Notion database. Automatically detects the title column. Supports common field types.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID" },
        title: { type: "string", description: "Row title (goes into the title column)" },
        fields: {
          type: "object",
          description: "Field values as key-value pairs. Key = column name, value = field value. Strings for text/select, arrays for multi_select, booleans for checkbox, ISO dates for date.",
          additionalProperties: true,
        },
        explanation: { type: "string", description: "Explain why you are adding this row" },
      },
      required: ["databaseId", "title", "explanation"],
    },
    handler: async (args) => {
      // Fetch schema to find title column and property types
      const dbRes = await notionRequest("GET", `/databases/${args.databaseId}`);
      if (!dbRes.ok) return dbRes;

      const props = dbRes.data.properties ?? {};
      const titleProp = Object.entries(props).find(([, v]) => v.type === "title")?.[0] ?? "Name";

      const properties = {
        [titleProp]: { title: [{ type: "text", text: { content: args.title } }] },
      };

      for (const [key, value] of Object.entries(args.fields || {})) {
        const propDef = props[key];
        if (!propDef) continue;

        const type = propDef.type;
        if (type === "rich_text")     properties[key] = { rich_text: [{ type: "text", text: { content: String(value) } }] };
        else if (type === "number")   properties[key] = { number: Number(value) };
        else if (type === "select")   properties[key] = { select: { name: String(value) } };
        else if (type === "status")   properties[key] = { status: { name: String(value) } };
        else if (type === "multi_select") properties[key] = { multi_select: (Array.isArray(value) ? value : [value]).map(n => ({ name: String(n) })) };
        else if (type === "checkbox") properties[key] = { checkbox: Boolean(value) };
        else if (type === "date")     properties[key] = { date: { start: String(value) } };
        else if (type === "url")      properties[key] = { url: String(value) };
        else if (type === "email")    properties[key] = { email: String(value) };
        else if (type === "phone_number") properties[key] = { phone_number: String(value) };
      }

      const result = await notionRequest("POST", "/pages", {
        parent: { database_id: args.databaseId },
        properties,
      });

      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          rowId: result.data.id,
          url: result.data.url,
          title: args.title,
          explanation: args.explanation,
        },
      };
    },
  },
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const blockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  checked: z.boolean().optional(),
  language: z.string().optional(),
  emoji: z.string().optional(),
});

const createPageSchema = z.object({
  title: z.string().min(1),
  parentPageId: z.string().optional(),
  icon: z.string().optional(),          // emoji e.g. "🚀"
  cover: z.string().url().optional(),   // image URL
  blocks: z.array(blockSchema).optional(),
});

const appendBlocksSchema = z.object({
  blocks: z.array(blockSchema).min(1),
});

const columnDescriptor = z.object({
  name: z.string().min(1),
  type: z.enum([
    "title", "rich_text", "text", "number", "select", "multi_select", "status",
    "date", "checkbox", "url", "email", "phone_number", "people",
    "files", "created_time", "created_by", "last_edited_time", "last_edited_by",
  ]),
  options: z.array(z.union([z.string(), z.object({ name: z.string(), color: z.string().optional() })])).optional(),
  colors: z.array(z.string()).optional(),
  format: z.string().optional(), // for number columns
});

const createDatabaseSchema = z.object({
  parentPageId: z.string().min(1),
  title: z.string().optional(),
  inline: z.boolean().optional().default(true),
  columns: z.array(columnDescriptor).optional(), // custom columns; if omitted, uses default task schema
});

const addTaskSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["Todo", "In Progress", "Done", "Blocked"]).optional(),
  priority: z.enum(["High", "Medium", "Low"]).optional(),
  dueDate: z.string().optional(),       // ISO date string e.g. "2026-03-15"
  notes: z.string().optional(),
});

const queryDatabaseSchema = z.object({
  filter: z.any().optional(),
  sorts: z.any().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const updateTaskSchema = z.object({
  status: z.enum(["Todo", "In Progress", "Done", "Blocked"]).optional(),
  priority: z.enum(["High", "Medium", "Low"]).optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

const createRowSchema = z.object({
  databaseId: z.string().min(1),
  title: z.string().min(1),
  properties: z.union([z.record(z.any()), z.string()]).optional(),
  relations: z.union([z.record(z.any()), z.string()]).optional(),
  content: z.any().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(res, status, error, message, details) {
  return res.status(status).json({ ok: false, error, message, details });
}

function validate(schema, data, res) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    err(res, 400, "invalid_request", "Validation failed", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

function formatPage(page) {
  const title =
    page.properties?.title?.title?.[0]?.plain_text ??
    page.properties?.Name?.title?.[0]?.plain_text ??
    Object.values(page.properties ?? {})
      .find((p) => p.type === "title")
      ?.title?.[0]?.plain_text ??
    "Untitled";

  return {
    id: page.id,
    title,
    url: page.url,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    archived: page.archived,
  };
}

function formatDatabase(db) {
  const title = db.title?.[0]?.plain_text ?? "Untitled";
  return {
    id: db.id,
    title,
    url: db.url,
    createdAt: db.created_time,
    updatedAt: db.last_edited_time,
    properties: Object.entries(db.properties ?? {}).map(([name, prop]) => ({
      name,
      type: prop.type,
    })),
  };
}

function formatRow(page) {
  const props = page.properties ?? {};
  return {
    id: page.id,
    url: page.url,
    name:
      props.Name?.title?.[0]?.plain_text ??
      Object.values(props).find((p) => p.type === "title")?.title?.[0]?.plain_text ??
      "Untitled",
    status: props.Status?.select?.name ?? null,
    priority: props.Priority?.select?.name ?? null,
    dueDate: props["Due Date"]?.date?.start ?? null,
    notes: props.Notes?.rich_text?.[0]?.plain_text ?? null,
  };
}

// ── Plugin register ───────────────────────────────────────────────────────────

function notionAudit(req, operation, success, meta = {}) {
  return auditLog({
    plugin: "notion",
    operation,
    actor: req.user?.id || req.headers?.["x-actor"] || "anonymous",
    workspaceId: req.headers?.["x-workspace-id"] || null,
    projectId: req.projectId || req.headers?.["x-project-id"] || null,
    allowed: true,
    success,
    metadata: meta,
  }).catch(() => {}); // audit failures must never break the request
}

export function register(app) {
  const router = Router();

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * GET /notion/search?q=&type=page|database
   * Search across all pages and databases the integration has access to.
   */
  router.get("/search", async (req, res) => {
    const q = req.query.q ?? "";
    const type = req.query.type; // "page" | "database" | undefined

    const body = {
      page_size: Number(req.query.limit ?? 20),
    };
    if (q) body.query = q;
    if (type === "page" || type === "database") {
      body.filter = { value: type, property: "object" };
    }

    const result = await notionRequest("POST", "/search", body);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const items = (result.data.results ?? []).map((item) =>
      item.object === "database" ? formatDatabase(item) : formatPage(item)
    );

    res.json({ ok: true, count: items.length, items });
  });

  // ── Pages ───────────────────────────────────────────────────────────────────

  /**
   * GET /notion/pages/:id
   * Get page metadata.
   */
  router.get("/pages/:id", async (req, res) => {
    const result = await notionRequest("GET", `/pages/${req.params.id}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);
    res.json({ ok: true, page: formatPage(result.data) });
  });

  /**
   * POST /notion/pages
   * Create a new page inside another page.
   *
   * Body: { title, parentPageId, icon?, cover?, blocks? }
   */
  router.post("/pages", async (req, res) => {
    const data = validate(createPageSchema, req.body, res);
    if (!data) return;

    const payload = {
      parent: { page_id: data.parentPageId ?? process.env.NOTION_ROOT_PAGE_ID },
      properties: {
        title: [{ type: "text", text: { content: data.title } }],
      },
    };

    if (!payload.parent.page_id) {
      return err(res, 400, "missing_parent", "Provide parentPageId or set NOTION_ROOT_PAGE_ID in .env");
    }

    if (data.icon) {
      payload.icon = { type: "emoji", emoji: data.icon };
    }
    if (data.cover) {
      payload.cover = { type: "external", external: { url: data.cover } };
    }
    if (data.blocks?.length) {
      payload.children = toNotionBlocks(data.blocks);
    }

    const result = await notionRequest("POST", "/pages", payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    notionAudit(req, "create_page", true, { pageId: result.data.id, title: data.title });
    res.json({ ok: true, page: formatPage(result.data) });
  });

  /**
   * PATCH /notion/pages/:id/append
   * Append blocks to an existing page.
   *
   * Body: { blocks: [{ type, text, ... }] }
   */
  router.patch("/pages/:id/append", async (req, res) => {
    const data = validate(appendBlocksSchema, req.body, res);
    if (!data) return;

    const result = await notionRequest("PATCH", `/blocks/${req.params.id}/children`, {
      children: toNotionBlocks(data.blocks),
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    notionAudit(req, "append_blocks", true, { pageId: req.params.id, blockCount: data.blocks.length });
    res.json({ ok: true, appended: data.blocks.length });
  });

  /**
   * GET /notion/sections
   * List all accessible pages AND databases in the workspace.
   * Used by the AI to discover available sections before deciding where to create content.
   */
  router.get("/sections", async (req, res) => {
    const [pagesRes, dbsRes] = await Promise.all([
      notionRequest("POST", "/search", { filter: { value: "page", property: "object" }, page_size: 50 }),
      notionRequest("POST", "/search", { filter: { value: "database", property: "object" }, page_size: 50 }),
    ]);

    const pages = (pagesRes.data?.results ?? [])
      .map(formatPage)
      .filter((p) => p.title && p.title !== "Untitled");

    const databases = (dbsRes.data?.results ?? [])
      .map(formatDatabase)
      .map((d) => ({ ...d, objectType: "database" }));

    res.json({
      ok: true,
      pages: { count: pages.length, items: pages.map((p) => ({ id: p.id, title: p.title, url: p.url })) },
      databases: { count: databases.length, items: databases.map((d) => ({ id: d.id, title: d.title, url: d.url })) },
    });
  });

  /**
   * GET /notion/pages/:id/subpages
   * List direct child pages under a given page.
   */
  router.get("/pages/:id/subpages", async (req, res) => {
    const result = await notionRequest("GET", `/blocks/${req.params.id}/children?page_size=100`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const subpages = (result.data.results ?? [])
      .filter((b) => b.type === "child_page" || b.type === "child_database")
      .map((b) => ({
        id: b.id,
        title: b.child_page?.title ?? b.child_database?.title ?? "Untitled",
        type: b.type === "child_database" ? "database" : "page",
      }));

    res.json({ ok: true, count: subpages.length, subpages });
  });

  /**
   * GET /notion/pages/:id/blocks
   * Get the blocks (content) of a page.
   */
  router.get("/pages/:id/blocks", async (req, res) => {
    const result = await notionRequest("GET", `/blocks/${req.params.id}/children?page_size=100`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const blocks = (result.data.results ?? []).map((b) => ({
      id: b.id,
      type: b.type,
      text:
        b[b.type]?.rich_text?.map((r) => r.plain_text).join("") ??
        b[b.type]?.title?.map((r) => r.plain_text).join("") ??
        null,
      checked: b[b.type]?.checked ?? undefined,
    }));

    res.json({ ok: true, count: blocks.length, blocks });
  });

  // ── Databases ────────────────────────────────────────────────────────────────

  /**
   * POST /notion/databases
   * Create a database inside a page with custom or default columns.
   *
   * Body:
   *   parentPageId  string  — parent page ID
   *   title         string  — database title (default: "Tasks")
   *   inline        boolean — create as inline database (default: true)
   *   columns       array   — custom column descriptors (optional)
   *     Each column: { name, type, options?, format? }
   *     Supported types: title, rich_text, number, select, multi_select,
   *       status, date, checkbox, url, email, phone_number, people, files,
   *       created_time, created_by, last_edited_time, last_edited_by
   *
   * If columns is omitted, the default task schema is used:
   *   Name (title), Status (select), Priority (select), Due Date (date), Notes (rich_text)
   *
   * Example custom columns:
   *   [
   *     { "name": "Task", "type": "title" },
   *     { "name": "Status", "type": "select", "options": ["Todo", "In Progress", "Done"] },
   *     { "name": "Assignee", "type": "people" },
   *     { "name": "Effort", "type": "number", "format": "number" },
   *     { "name": "Tags", "type": "multi_select", "options": ["bug", "feature", "chore"] }
   *   ]
   */
  router.post("/databases", async (req, res) => {
    const data = validate(createDatabaseSchema, req.body, res);
    if (!data) return;

    let properties;
    if (data.columns && data.columns.length > 0) {
      properties = buildDatabaseSchema(data.columns);
    } else {
      const defaultSchema = taskDatabaseSchema(data.title ?? "Tasks");
      properties = defaultSchema.properties;
    }

    const payload = {
      parent: { type: "page_id", page_id: data.parentPageId },
      title: [{ type: "text", text: { content: data.title ?? "Tasks" } }],
      properties,
      is_inline: data.inline !== false,
    };

    const result = await notionRequest("POST", "/databases", payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    notionAudit(req, "create_database", true, { databaseId: result.data.id, title: data.title, columnCount: Object.keys(properties).length });
    res.json({
      ok: true,
      database: formatDatabase(result.data),
      columns: Object.entries(result.data.properties ?? {}).map(([name, prop]) => ({ name, type: prop.type })),
    });
  });

  /**
   * PATCH /notion/databases/:id/properties
   * Add new columns or rename existing columns on a database.
   *
   * Body:
   *   columns  array  — column descriptors to add or update
   *     { name: string, type: string, ...options }  → add a new column
   *     { name: string, rename: string }             → rename an existing column
   *
   * Notion does NOT support deleting columns via the API.
   *
   * Example — add two columns:
   *   { "columns": [
   *     { "name": "Assignee", "type": "people" },
   *     { "name": "Sprint", "type": "select", "options": ["Sprint 1", "Sprint 2"] }
   *   ]}
   *
   * Example — rename a column:
   *   { "columns": [{ "name": "Old Name", "rename": "New Name" }] }
   */
  router.patch("/databases/:id/properties", async (req, res) => {
    const { columns } = req.body;
    if (!Array.isArray(columns) || columns.length === 0) {
      return err(res, 400, "missing_columns", "Provide a columns array with at least one column descriptor");
    }

    const properties = {};
    for (const col of columns) {
      if (col.rename) {
        // Rename an existing column
        properties[col.name] = { name: col.rename };
      } else {
        // Add a new column
        properties[col.name] = buildNotionProperty(col.type || "rich_text", col);
      }
    }

    const result = await notionRequest("PATCH", `/databases/${req.params.id}`, { properties });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    notionAudit(req, "update_database_properties", true, { databaseId: req.params.id, columnCount: columns.length });
    res.json({
      ok: true,
      databaseId: req.params.id,
      updatedColumns: columns.map(c => ({ name: c.rename || c.name, type: c.type || (c.rename ? "renamed" : "rich_text") })),
      schema: Object.entries(result.data.properties ?? {}).map(([name, prop]) => ({ name, type: prop.type })),
    });
  });

  /**
   * GET /notion/databases/:id
   * Get database schema and metadata.
   */
  router.get("/databases/:id", async (req, res) => {
    const result = await notionRequest("GET", `/databases/${req.params.id}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);
    res.json({ ok: true, database: formatDatabase(result.data) });
  });

  /**
   * GET /notion/databases/:id/rows
   * Query rows from a database with cursor-based pagination.
   *
   * Query params:
   *   limit  = page size, 1-100 (default: 50)
   *   cursor = next_cursor from previous response (for pagination)
   */
  router.get("/databases/:id/rows", async (req, res) => {
    const limit  = Math.min(Number(req.query.limit ?? 50), 100);
    const cursor = req.query.cursor || undefined;

    const payload = { page_size: limit };
    if (cursor) payload.start_cursor = cursor;

    const result = await notionRequest("POST", `/databases/${req.params.id}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const rows = (result.data.results ?? []).map(formatRow);
    res.json({
      ok: true,
      count: rows.length,
      rows,
      hasMore: result.data.has_more ?? false,
      nextCursor: result.data.next_cursor || null,
    });
  });

  /**
   * POST /notion/databases/:id/rows
   * Add a task row to a database.
   *
   * Body: { name, status?, priority?, dueDate?, notes? }
   */
  router.post("/databases/:id/rows", async (req, res) => {
    const data = validate(addTaskSchema, req.body, res);
    if (!data) return;

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: req.params.id },
      properties: toTaskProperties(data),
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, row: formatRow(result.data) });
  });

  /**
   * GET /notion/databases/:id/rows
   * Query rows from a database. Supports optional filter/sort.
   *
   * Body (optional): { filter?, sorts?, pageSize? }
   */
  router.post("/databases/:id/rows/query", async (req, res) => {
    const data = validate(queryDatabaseSchema, req.body ?? {}, res);
    if (!data) return;

    const payload = {};
    if (data.filter) payload.filter = data.filter;
    if (data.sorts) payload.sorts = data.sorts;
    if (data.pageSize) payload.page_size = data.pageSize;

    const result = await notionRequest("POST", `/databases/${req.params.id}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const rows = (result.data.results ?? []).map(formatRow);
    res.json({ ok: true, count: rows.length, rows });
  });

  /**
   * PATCH /notion/databases/rows/:rowId
   * Update a task row's properties (e.g. mark as Done).
   *
   * Body: { status?, priority?, dueDate?, notes? }
   */
  router.patch("/databases/rows/:rowId", async (req, res) => {
    const data = validate(updateTaskSchema, req.body, res);
    if (!data) return;

    const properties = toTaskProperties({ name: undefined, ...data });
    // Remove Name from update if not provided (avoid overwriting title)
    delete properties.Name;

    const result = await notionRequest("PATCH", `/pages/${req.params.rowId}`, { properties });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, row: formatRow(result.data) });
  });

  // ── Project (combined endpoints for AI efficiency) ───────────────────────────

  /**
   * POST /notion/project
   *
   * Creates a complete project in Notion in ONE call:
   *   1. Creates a page with content blocks
   *   2. Creates an inline Tasks database inside the page
   *   3. Adds all tasks to the database
   *
   * Replaces: create_page + create_database + add_task × N  (3+N calls → 1 call)
   *
   * Body:
   * {
   *   "title": "My Project",
   *   "parentPageId": "abc123",      // optional if NOTION_ROOT_PAGE_ID is set
   *   "icon": "🚀",                  // optional emoji
   *   "description": "What this project does",
   *   "blocks": [                    // optional extra content blocks
   *     { "type": "heading_2", "text": "Tech Stack" },
   *     { "type": "bullet", "text": "Node.js" }
   *   ],
   *   "tasks": [                     // optional initial tasks
   *     { "name": "Set up database", "status": "Todo", "priority": "High" },
   *     { "name": "Build API", "status": "Todo", "priority": "Medium", "notes": "..." }
   *   ],
   *   "databaseTitle": "Tasks"       // optional, default "Tasks"
   * }
   */
  const createProjectSchema = z.object({
    title: z.string().min(1),
    parentPageId: z.string().optional(),
    icon: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(blockSchema).optional(),
    tasks: z.array(addTaskSchema).optional(),
    databaseTitle: z.string().optional(),
  });

  router.post("/project", async (req, res) => {
    const data = validate(createProjectSchema, req.body, res);
    if (!data) return;

    const parentId = data.parentPageId ?? process.env.NOTION_ROOT_PAGE_ID;
    if (!parentId) {
      return err(res, 400, "missing_parent", "Provide parentPageId or set NOTION_ROOT_PAGE_ID in .env");
    }

    // ── Step 1: Build page content blocks ──────────────────────────────────
    const contentBlocks = [];

    if (data.description) {
      contentBlocks.push(
        { type: "callout", text: data.description, emoji: data.icon ?? "🎯" },
        { type: "divider" }
      );
    }

    if (data.blocks?.length) {
      contentBlocks.push(...data.blocks);
    }

    // ── Step 2: Create the page ─────────────────────────────────────────────
    const pagePayload = {
      parent: { page_id: parentId },
      properties: {
        title: [{ type: "text", text: { content: data.title } }],
      },
    };
    if (data.icon) pagePayload.icon = { type: "emoji", emoji: data.icon };
    if (contentBlocks.length) pagePayload.children = toNotionBlocks(contentBlocks);

    const pageRes = await notionRequest("POST", "/pages", pagePayload);
    if (!pageRes.ok) return err(res, 502, pageRes.error, pageRes.details?.message, pageRes.details);

    const page = formatPage(pageRes.data);

    // ── Step 3: Create inline Tasks database inside the page ───────────────
    const dbSchema = taskDatabaseSchema(data.databaseTitle ?? "Tasks");
    const dbRes = await notionRequest("POST", "/databases", {
      parent: { type: "page_id", page_id: page.id },
      ...dbSchema,
      is_inline: true,
    });
    if (!dbRes.ok) return err(res, 502, dbRes.error, dbRes.details?.message, dbRes.details);

    const database = formatDatabase(dbRes.data);

    // ── Step 4: Add all tasks in parallel ──────────────────────────────────
    const tasks = data.tasks ?? [];
    const taskResults = await Promise.all(
      tasks.map((task) =>
        notionRequest("POST", "/pages", {
          parent: { database_id: database.id },
          properties: toTaskProperties(task),
        })
      )
    );

    const createdTasks = taskResults
      .filter((r) => r.ok)
      .map((r) => formatRow(r.data));

    const failedTasks = taskResults.filter((r) => !r.ok).length;

    res.json({
      ok: true,
      page,
      database,
      tasks: {
        created: createdTasks.length,
        failed: failedTasks,
        items: createdTasks,
      },
    });
  });

  /**
   * GET /notion/project/:pageId
   *
   * Returns current project state in ONE call:
   *   - Page metadata
   *   - Page content blocks
   *   - All tasks from the inline database (if found)
   *
   * Replaces: get_page + get_blocks + query_tasks  (3 calls → 1 call)
   */
  router.get("/project/:pageId", async (req, res) => {
    const pageId = req.params.pageId;

    // Fetch page metadata and blocks in parallel
    const [pageRes, blocksRes] = await Promise.all([
      notionRequest("GET", `/pages/${pageId}`),
      notionRequest("GET", `/blocks/${pageId}/children?page_size=100`),
    ]);

    if (!pageRes.ok) return err(res, 502, pageRes.error, pageRes.details?.message, pageRes.details);

    const page = formatPage(pageRes.data);
    const blocks = blocksRes.ok
      ? (blocksRes.data.results ?? []).map((b) => ({
          id: b.id,
          type: b.type,
          text:
            b[b.type]?.rich_text?.map((r) => r.plain_text).join("") ??
            b[b.type]?.title?.map((r) => r.plain_text).join("") ??
            null,
          checked: b[b.type]?.checked ?? undefined,
        }))
      : [];

    // Find inline child_database blocks → query each for tasks
    const dbBlocks = (blocksRes.data?.results ?? []).filter(
      (b) => b.type === "child_database"
    );

    let tasks = [];
    if (dbBlocks.length) {
      const dbId = dbBlocks[0].id;
      const tasksRes = await notionRequest("POST", `/databases/${dbId}/query`, {
        page_size: 100,
      });
      if (tasksRes.ok) {
        tasks = (tasksRes.data.results ?? []).map(formatRow);
      }
    }

    res.json({
      ok: true,
      page,
      blocks,
      tasks: {
        count: tasks.length,
        items: tasks,
      },
    });
  });

  // ── Workspace-specific endpoints (matches user's actual Notion schema) ────────
  //
  // Projeler DB:  Name(title), Status(Yapılmadı/Yapılıyor/Tamamlandı),
  //               Öncelik(Az/Normal/Yüksek), Başlangıç(date), bitiş(date)
  //
  // Yapılacaklar DB: Görev(title), Son Tarih(date), Projeler(relation), (checkbox)

  const addProjectSchema = z.object({
    name: z.string().min(1),
    status: z.enum(["Yapılmadı", "Yapılıyor", "Tamamlandı"]).optional().default("Yapılmadı"),
    oncelik: z.enum(["Az", "Normal", "Yüksek"]).optional().default("Normal"),
    baslangic: z.string().optional(),  // ISO date "YYYY-MM-DD"
    bitis: z.string().optional(),      // ISO date "YYYY-MM-DD"
  });

  const addWorkTaskSchema = z.object({
    gorev: z.string().min(1),
    sonTarih: z.string().optional(),   // ISO date "YYYY-MM-DD"
    projeId: z.string().optional(),    // Projeler DB row ID to link
    tamamlandi: z.boolean().optional().default(false),
  });

  const setupProjectSchema = z.object({
    name: z.string().min(1),
    status: z.enum(["Yapılmadı", "Yapılıyor", "Tamamlandı"]).optional().default("Yapılmadı"),
    oncelik: z.enum(["Az", "Normal", "Yüksek"]).optional().default("Normal"),
    baslangic: z.string().optional(),
    bitis: z.string().optional(),
    // tasks may arrive as a JSON array (application/json body)
    // OR as a JSON string (keypair/form body from n8n HTTP Request Tool)
    tasks: z.union([
      z.array(z.object({
        gorev: z.string().min(1),
        sonTarih: z.string().optional(),
      })),
      z.string().transform((s) => {
        if (!s || !s.trim()) return [];
        try { return JSON.parse(s); } catch { return []; }
      }),
    ]).optional().default([]),
  });

  /**
   * POST /notion/projects
   * Add a project to the Projeler database.
   *
   * Body: { name, status?, oncelik?, baslangic?, bitis? }
   *
   * status options : Yapılmadı | Yapılıyor | Tamamlandı
   * oncelik options: Az | Normal | Yüksek
   */
  router.post("/projects", async (req, res) => {
    const data = validate(addProjectSchema, req.body, res);
    if (!data) return;

    const dbId = config.notion.projectsDbId;
    if (!dbId) return err(res, 500, "config_error", "NOTION_PROJECTS_DB_ID is not set in .env");

    const properties = {
      [notionFields.projectName]:     { title: [{ type: "text", text: { content: data.name } }] },
      [notionFields.projectStatus]:   { status: { name: data.status } },
      [notionFields.projectPriority]: { select: { name: data.oncelik } },
    };
    if (data.baslangic) properties[notionFields.projectStart] = { date: { start: data.baslangic } };
    if (data.bitis)     properties[notionFields.projectEnd]   = { date: { start: data.bitis } };

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: dbId },
      properties,
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const row = result.data;
    notionAudit(req, "create_project", true, { projectId: row.id, name: data.name });
    res.json({
      ok: true,
      project: {
        id: row.id,
        name: data.name,
        status: data.status,
        oncelik: data.oncelik,
        url: row.url,
      },
    });
  });

  /**
   * GET /notion/projects
   * Query the Projeler database.
   *
   * Query params:
   *   status = Yapılmadı | Yapılıyor | Tamamlandı (optional filter)
   *   limit  = max results (default: 20)
   */
  router.get("/projects", async (req, res) => {
    const dbId = config.notion.projectsDbId;
    if (!dbId) return err(res, 500, "config_error", "NOTION_PROJECTS_DB_ID is not set in .env");

    const payload = { page_size: Math.min(Number(req.query.limit ?? 20), 100) };
    if (req.query.status) {
      payload.filter = { property: notionFields.projectStatus, status: { equals: req.query.status } };
    }
    payload.sorts = [{ property: notionFields.projectStart, direction: "descending" }];

    const result = await notionRequest("POST", `/databases/${dbId}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const projects = (result.data.results ?? []).map((p) => ({
      id: p.id,
      name: p.properties?.[notionFields.projectName]?.title?.[0]?.plain_text ?? "Untitled",
      status: p.properties?.[notionFields.projectStatus]?.status?.name ?? null,
      oncelik: p.properties?.[notionFields.projectPriority]?.select?.name ?? null,
      baslangic: p.properties?.[notionFields.projectStart]?.date?.start ?? null,
      bitis: p.properties?.[notionFields.projectEnd]?.date?.start ?? null,
      url: p.url,
    }));

    res.json({ ok: true, count: projects.length, projects });
  });

  /**
   * POST /notion/tasks
   * Add a task to the Yapılacaklar database.
   *
   * Body: { gorev, sonTarih?, projeId?, tamamlandi? }
   */
  router.post("/tasks", async (req, res) => {
    const data = validate(addWorkTaskSchema, req.body, res);
    if (!data) return;

    const dbId = config.notion.tasksDbId;
    if (!dbId) return err(res, 500, "config_error", "NOTION_TASKS_DB_ID is not set in .env");

    const properties = {
      [notionFields.taskName]: { title: [{ type: "text", text: { content: data.gorev } }] },
    };
    if (notionFields.taskDone) properties[notionFields.taskDone] = { checkbox: data.tamamlandi ?? false };
    if (data.sonTarih) properties[notionFields.taskDueDate] = { date: { start: data.sonTarih } };
    if (data.projeId)  properties[notionFields.taskProject]  = { relation: [{ id: data.projeId }] };

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: dbId },
      properties,
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const row = result.data;
    notionAudit(req, "create_task", true, { taskId: row.id, gorev: data.gorev });
    res.json({
      ok: true,
      task: {
        id: row.id,
        gorev: data.gorev,
        sonTarih: data.sonTarih ?? null,
        projeId: data.projeId ?? null,
        url: row.url,
      },
    });
  });

  /**
   * GET /notion/tasks
   * Query the Yapılacaklar database.
   *
   * Query params:
   *   projeId    = filter by project relation ID
   *   tamamlandi = true | false
   *   limit      = max results (default: 30)
   */
  router.get("/tasks", async (req, res) => {
    const dbId = config.notion.tasksDbId;
    if (!dbId) return err(res, 500, "config_error", "NOTION_TASKS_DB_ID is not set in .env");

    const payload = { page_size: Math.min(Number(req.query.limit ?? 30), 100) };

    const filters = [];
    if (req.query.projeId) {
      filters.push({ property: notionFields.taskProject, relation: { contains: req.query.projeId } });
    }
    if (req.query.tamamlandi !== undefined && notionFields.taskDone) {
      filters.push({ property: notionFields.taskDone, checkbox: { equals: req.query.tamamlandi === "true" } });
    }
    if (filters.length === 1) payload.filter = filters[0];
    else if (filters.length > 1) payload.filter = { and: filters };

    const result = await notionRequest("POST", `/databases/${dbId}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const tasks = (result.data.results ?? []).map((p) => ({
      id: p.id,
      gorev: p.properties?.[notionFields.taskName]?.title?.[0]?.plain_text ?? "Untitled",
      tamamlandi: notionFields.taskDone ? (p.properties?.[notionFields.taskDone]?.checkbox ?? false) : false,
      sonTarih: p.properties?.[notionFields.taskDueDate]?.date?.start ?? null,
      projeler: (p.properties?.[notionFields.taskProject]?.relation ?? []).map((r) => r.id),
      url: p.url,
    }));

    res.json({ ok: true, count: tasks.length, tasks });
  });

  /**
   * POST /notion/setup-project
   * ⭐ MAIN AI TOOL — Creates a project AND all its tasks in ONE call.
   *
   * 1. Adds project to Projeler DB
   * 2. Adds all tasks to Yapılacaklar DB, linked to the project
   *
   * Replaces: add_project + add_task × N  → 1 call
   *
   * Body:
   * {
   *   "name": "mcp-hub geliştirme",
   *   "status": "Yapılıyor",
   *   "oncelik": "Yüksek",
   *   "baslangic": "2026-03-01",
   *   "bitis": "2026-04-01",
   *   "tasks": [
   *     { "gorev": "GitHub plugin yaz", "sonTarih": "2026-03-10" },
   *     { "gorev": "Notion entegrasyonu test et" }
   *   ]
   * }
   */
  router.post("/setup-project", validateBody(setupProjectSchema), async (req, res) => {
    const data = req.validatedBody;

    const projectsDbId = config.notion.projectsDbId;
    const tasksDbId = config.notion.tasksDbId;
    if (!projectsDbId || !tasksDbId) {
      return err(res, 500, "config_error", "NOTION_PROJECTS_DB_ID or NOTION_TASKS_DB_ID not set in .env");
    }

    // ── Step 1: Create project ─────────────────────────────────────────────
    const projectProperties = {
      [notionFields.projectName]:     { title: [{ type: "text", text: { content: data.name } }] },
      [notionFields.projectStatus]:   { status: { name: data.status } },
      [notionFields.projectPriority]: { select: { name: data.oncelik } },
    };
    if (data.baslangic?.trim()) projectProperties[notionFields.projectStart] = { date: { start: data.baslangic.trim() } };
    if (data.bitis?.trim())     projectProperties[notionFields.projectEnd]   = { date: { start: data.bitis.trim() } };

    const projectRes = await notionRequest("POST", "/pages", {
      parent: { database_id: projectsDbId },
      properties: projectProperties,
    });
    if (!projectRes.ok) return err(res, 502, projectRes.error, projectRes.details?.message, projectRes.details);

    const projectId  = projectRes.data.id;
    const projectUrl = projectRes.data.url
      ?? `https://www.notion.so/${(projectRes.data.id ?? "").replace(/-/g, "")}`;

    // ── Step 2: Create all tasks in parallel, linked to project ───────────
    const tasks = data.tasks ?? [];
    const taskResults = await Promise.all(
      tasks.map((task) => {
        const taskProperties = {
          [notionFields.taskName]:    { title: [{ type: "text", text: { content: task.gorev } }] },
          [notionFields.taskProject]: { relation: [{ id: projectId }] },
        };
        if (task.sonTarih) taskProperties[notionFields.taskDueDate] = { date: { start: task.sonTarih } };
        return notionRequest("POST", "/pages", {
          parent: { database_id: tasksDbId },
          properties: taskProperties,
        });
      })
    );

    const createdTasks = taskResults
      .filter((r) => r.ok)
      .map((r) => ({
        id: r.data.id,
        gorev: r.data.properties?.Görev?.title?.[0]?.plain_text ?? "?",
        url: r.data.url,
      }));

    notionAudit(req, "setup_project", true, { projectId, name: data.name, taskCount: createdTasks.length });
    res.json({
      ok: true,
      project: {
        id: projectId,
        name: data.name,
        status: data.status,
        oncelik: data.oncelik,
        url: projectUrl,
      },
      tasks: {
        created: createdTasks.length,
        failed: taskResults.filter((r) => !r.ok).length,
        items: createdTasks,
      },
    });
  });

  // ── Archive (soft-delete) rows ───────────────────────────────────────────────

  /**
   * DELETE /notion/row/:pageId
   * Archive a single Notion page (moves it to trash).
   */
  router.delete("/row/:pageId", async (req, res) => {
    const { pageId } = req.params;
    if (!pageId) return err(res, 400, "missing_page_id", "Provide pageId");

    const result = await notionRequest("PATCH", `/pages/${pageId}`, { archived: true });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    notionAudit(req, "archive_page", true, { pageId });
    res.json({ ok: true, archived: true, id: pageId });
  });

  /**
   * POST /notion/rows/archive
   * Bulk archive multiple Notion pages by ID.
   *
   * Body: { "ids": ["page-id-1", "page-id-2", ...] }
   */
  router.post("/rows/archive", async (req, res) => {
    let ids = req.body?.ids ?? [];
    if (typeof ids === "string") {
      try { ids = JSON.parse(ids); } catch { ids = []; }
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return err(res, 400, "missing_ids", "Provide ids array of Notion page IDs");
    }

    const results = await Promise.all(
      ids.map((id) => notionRequest("PATCH", `/pages/${id}`, { archived: true }))
    );

    const succeeded = results.filter((r) => r.ok).length;
    const failed    = results.filter((r) => !r.ok).length;

    notionAudit(req, "bulk_archive", true, { total: ids.length, succeeded, failed });
    res.json({ ok: true, archived: succeeded, failed, total: ids.length });
  });

  // ── Generic row insert (AI-friendly, works with ANY database) ───────────────

  /**
   * POST /notion/row
   * Add a row to any Notion database with free-form title-based properties.
   * AI-friendly: just provide databaseId + a title + optional extra properties.
   *
   * Body:
   * {
   *   "databaseId": "<notion-db-id>",
   *   "title": "My row title",          // required — goes into the first title property
   *   "properties": {                   // optional extra Notion properties (raw API format)
   *     "Status": { "status": { "name": "Done" } }
   *   }
   * }
   */
  router.post("/row", validateBody(createRowSchema), async (req, res) => {
    const { databaseId, title } = req.validatedBody;

    // properties may arrive as a JSON string (from n8n body) or object — normalize both
    let rawExtra = req.validatedBody?.properties ?? {};
    if (typeof rawExtra === "string") {
      try { rawExtra = rawExtra.trim() ? JSON.parse(rawExtra) : {}; }
      catch { rawExtra = {}; }
    }
    const extra = (rawExtra && typeof rawExtra === "object" && !Array.isArray(rawExtra)) ? rawExtra : {};

    // relations: { "Proje": "page-id-of-related-row" } → converted to Notion relation format
    let rawRelations = req.validatedBody?.relations ?? {};
    if (typeof rawRelations === "string") {
      try { rawRelations = rawRelations.trim() ? JSON.parse(rawRelations) : {}; }
      catch { rawRelations = {}; }
    }
    if (rawRelations && typeof rawRelations === "object") {
      for (const [field, pageId] of Object.entries(rawRelations)) {
        if (pageId) extra[field] = { relation: [{ id: String(pageId) }] };
      }
    }

    // Fetch the database schema to find the title property name
    const dbRes = await notionRequest("GET", `/databases/${databaseId}`);
    if (!dbRes.ok) return err(res, 502, dbRes.error, dbRes.details?.message, dbRes.details);

    const titlePropName = Object.entries(dbRes.data.properties ?? {})
      .find(([, v]) => v.type === "title")?.[0] ?? "Name";

    const properties = {
      [titlePropName]: { title: [{ type: "text", text: { content: title } }] },
      ...extra,
    };

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: databaseId },
      properties,
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const page = result.data;
    const pageUrl = page.url ?? `https://www.notion.so/${(page.id ?? "").replace(/-/g, "")}`;

    // content: optional string or array of block descriptors
    // If string → wrap as a single paragraph block
    // If array  → use toNotionBlock() on each item
    let contentBlocks = [];
    const rawContent = req.validatedBody?.content;
    if (rawContent) {
      let parsed = rawContent;
      if (typeof parsed === "string") {
        const trimmed = parsed.trim();
        if (trimmed.startsWith("[")) {
          try { parsed = JSON.parse(trimmed); } catch { parsed = trimmed; }
        }
      }
      if (typeof parsed === "string" && parsed.trim()) {
        // Plain text → split by newlines into paragraph blocks
        contentBlocks = parsed.trim().split(/\n\n+/).map((para) => ({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: para.trim() } }] },
        }));
      } else if (Array.isArray(parsed)) {
        contentBlocks = parsed.map(toNotionBlock).filter(Boolean);
      }
    }

    if (contentBlocks.length > 0) {
      await notionRequest("PATCH", `/blocks/${page.id}/children`, {
        children: contentBlocks,
      });
    }

    notionAudit(req, "create_row", true, { pageId: page.id, databaseId, title });
    res.json({
      ok: true,
      id: page.id,
      url: pageUrl,
      title,
      contentBlocks: contentBlocks.length,
    });
  });

  // ── Templates ──────────────────────────────────────────────────────────────

  /**
   * POST /notion/templates/apply
   * Apply a template and get structured content blocks.
   */
  router.post("/templates/apply", async (req, res) => {
    const { template, ...inputs } = req.body;
    if (!template) {
      return err(res, 400, "missing_template", "Template name is required");
    }
    const result = await applyTemplate(template, inputs);
    res.status(result.ok ? 200 : 400).json(result);
  });

  /**
   * POST /notion/templates/pages
   * Create a page from a template.
   */
  router.post("/templates/pages", async (req, res) => {
    const { template, parentPageId, ...inputs } = req.body;
    if (!template) {
      return err(res, 400, "missing_template", "Template name is required");
    }
    if (!parentPageId) {
      return err(res, 400, "missing_parent", "parentPageId is required");
    }

    const templateResult = await applyTemplate(template, inputs);
    if (!templateResult.ok) return res.status(400).json(templateResult);

    const payload = {
      parent: { page_id: parentPageId },
      properties: { title: [{ text: { content: templateResult.data.title } }] },
      icon: { type: "emoji", emoji: templateResult.data.icon },
      children: templateResult.data.blocks,
    };

    const result = await notionRequest("POST", "/pages", payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({
      ok: true,
      page: { id: result.data.id, url: result.data.url },
      template,
    });
  });

  app.use("/notion", router);
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * Apply a template to create a structured Notion page
 * @param {string} templateName - Template name (e.g., "feature_delivery")
 * @param {Object} inputs - Template inputs
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
// Built-in template registry — extend with registerTemplate()
const templateRegistry = new Map();

/**
 * Register a custom template. Plugins or external code can extend the template system.
 * @param {string} name - Template name
 * @param {function} fn - Function(inputs) => { title, icon, blocks }
 */
export function registerTemplate(name, fn) {
  templateRegistry.set(name, fn);
}

function b(type, text, extra = {}) {
  const richText = [{ type: "text", text: { content: String(text ?? "") } }];
  return { type, [type]: { rich_text: richText, ...extra } };
}
function bList(items, type = "bulleted_list_item") {
  return items.map(text => b(type, text));
}
function bTodo(items) {
  return items.map(text => ({ type: "to_do", to_do: { rich_text: [{ type: "text", text: { content: text } }], checked: false } }));
}
function bH2(text) { return { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: text } }] } }; }
function bH3(text) { return { type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: text } }] } }; }
function bDiv() { return { type: "divider", divider: {} }; }

// Register built-in templates
registerTemplate("feature_delivery", (inputs) => ({
  title: inputs.title || "Feature: [Name]",
  icon: "🚀",
  blocks: [
    bH2("Summary"),
    b("paragraph", inputs.summary || "What this feature does and why it matters."),
    bH2("Acceptance Criteria"),
    ...bList(inputs.criteria || ["Criteria 1", "Criteria 2", "Criteria 3"]),
    bH2("Implementation Plan"),
    b("paragraph", inputs.plan || "Steps to implement this feature."),
    bH2("Related Links"),
    ...bList([`PR: ${inputs.prUrl || "[PR URL]"}`, `Design: ${inputs.designUrl || "[Design Doc]"}`]),
    bH2("Release Notes"),
    b("paragraph", inputs.releaseNotes || "What users should know about this change."),
  ],
}));

registerTemplate("task", (inputs) => ({
  title: inputs.title || "Task: [Name]",
  icon: "📋",
  blocks: [
    b("paragraph", inputs.description || "Task description."),
    bDiv(),
    bH3("Checklist"),
    ...bTodo(inputs.checklist || ["Step 1", "Step 2", "Step 3"]),
  ],
}));

registerTemplate("meeting_notes", (inputs) => ({
  title: inputs.title || `Meeting: ${new Date().toLocaleDateString()}`,
  icon: "🗓️",
  blocks: [
    bH2("Meeting Info"),
    b("paragraph", `Date: ${inputs.date || new Date().toLocaleDateString()}`),
    b("paragraph", `Attendees: ${(inputs.attendees || ["Attendee 1", "Attendee 2"]).join(", ")}`),
    bDiv(),
    bH2("Agenda"),
    ...bList(inputs.agenda || ["Topic 1", "Topic 2", "Topic 3"]),
    bDiv(),
    bH2("Notes"),
    b("paragraph", inputs.notes || "Key discussion points..."),
    bDiv(),
    bH2("Action Items"),
    ...bTodo(inputs.actionItems || ["Follow up on ...", "Send email about ...", "Schedule next meeting"]),
    bDiv(),
    bH2("Decisions"),
    b("paragraph", inputs.decisions || "Decisions made during the meeting..."),
  ],
}));

registerTemplate("bug_report", (inputs) => ({
  title: inputs.title || "Bug: [Description]",
  icon: "🐛",
  blocks: [
    bH2("Bug Summary"),
    b("paragraph", inputs.summary || "Brief description of the bug."),
    bDiv(),
    bH2("Steps to Reproduce"),
    ...bList(inputs.steps || ["Step 1: ...", "Step 2: ...", "Step 3: ..."]),
    bH2("Expected Behavior"),
    b("paragraph", inputs.expected || "What should happen."),
    bH2("Actual Behavior"),
    b("paragraph", inputs.actual || "What actually happens."),
    bDiv(),
    bH2("Environment"),
    ...bList([
      `OS: ${inputs.os || "macOS / Windows / Linux"}`,
      `Browser: ${inputs.browser || "Chrome / Firefox / Safari"}`,
      `Version: ${inputs.version || "vX.X.X"}`,
    ]),
    bH2("Severity"),
    b("paragraph", inputs.severity || "Low / Medium / High / Critical"),
    bDiv(),
    bH2("Possible Fix"),
    b("paragraph", inputs.fix || "Potential root cause or fix suggestion."),
  ],
}));

registerTemplate("weekly_review", (inputs) => ({
  title: inputs.title || `Weekly Review — W${Math.ceil(new Date().getDate() / 7)} ${new Date().toLocaleDateString("en-US", { month: "long" })}`,
  icon: "📅",
  blocks: [
    bH2("✅ Wins This Week"),
    ...bList(inputs.wins || ["Shipped feature X", "Closed N bugs", "Completed sprint"]),
    bDiv(),
    bH2("🚧 Challenges"),
    ...bList(inputs.challenges || ["Blocker 1", "Slow progress on Y"]),
    bDiv(),
    bH2("📊 Metrics"),
    b("paragraph", inputs.metrics || "Velocity, PRs merged, issues closed..."),
    bDiv(),
    bH2("🎯 Next Week Focus"),
    ...bTodo(inputs.nextWeek || ["Priority task 1", "Priority task 2", "Priority task 3"]),
    bDiv(),
    bH2("💡 Learnings"),
    b("paragraph", inputs.learnings || "Key learnings from this week."),
  ],
}));

registerTemplate("project_brief", (inputs) => ({
  title: inputs.title || "Project Brief: [Name]",
  icon: "📄",
  blocks: [
    bH2("Overview"),
    b("paragraph", inputs.overview || "What this project is and why we're doing it."),
    bDiv(),
    bH2("Goals & Success Criteria"),
    ...bList(inputs.goals || ["Goal 1", "Goal 2", "Goal 3"]),
    bDiv(),
    bH2("Scope"),
    bH3("In Scope"),
    ...bList(inputs.inScope || ["Feature A", "Feature B"]),
    bH3("Out of Scope"),
    ...bList(inputs.outScope || ["Feature C (later)", "Feature D (different project)"]),
    bDiv(),
    bH2("Timeline"),
    b("paragraph", inputs.timeline || "Start: ... | End: ... | Milestones: ..."),
    bDiv(),
    bH2("Team"),
    ...bList(inputs.team || ["PM: ...", "Engineering: ...", "Design: ..."]),
    bDiv(),
    bH2("Risks"),
    ...bList(inputs.risks || ["Risk 1 and mitigation", "Risk 2 and mitigation"]),
  ],
}));

export async function applyTemplate(templateName, inputs = {}) {
  const templateFn = templateRegistry.get(templateName);
  if (!templateFn) {
    const available = [...templateRegistry.keys()].join(", ");
    return { ok: false, error: { code: "unknown_template", message: `Template '${templateName}' not found. Available: ${available}` } };
  }
  const result = templateFn(inputs);
  return { ok: true, data: { template: templateName, ...result } };
}

/**
 * Create a task in a database
 * @param {string} databaseId - Database ID
 * @param {Object} task - Task data
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function createTask(databaseId, task) {
  const properties = {
    Name: { title: [{ text: { content: task.name } }] },
    ...(task.status ? { Status: { status: { name: task.status } } } : {}),
    ...(task.priority ? { Priority: { select: { name: task.priority } } } : {}),
    ...(task.dueDate ? { "Due Date": { date: { start: task.dueDate } } } : {}),
  };

  const result = await notionRequest("POST", "/pages", {
    parent: { database_id: databaseId },
    properties,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      id: result.data.id,
      url: result.data.url,
      name: task.name,
    },
  };
}

/**
 * Attach a link to a page
 * @param {string} pageId - Page ID
 * @param {string} url - URL to attach
 * @param {string} label - Link label
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function attachLink(pageId, url, label) {
  const result = await notionRequest("PATCH", `/blocks/${pageId}/children`, {
    children: [
      {
        type: "bookmark",
        bookmark: { url },
      },
    ],
  });

  if (!result.ok) return result;

  return { ok: true, data: { attached: true, url, label } };
}
