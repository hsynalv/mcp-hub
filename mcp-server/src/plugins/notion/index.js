import { Router } from "express";
import { z } from "zod";
import { notionRequest } from "./notion.client.js";
import { toNotionBlocks, taskDatabaseSchema, toTaskProperties } from "./blocks.js";
import { config } from "../../core/config.js";
import { validateBody } from "../../core/validate.js";

export const name = "notion";
export const version = "1.0.0";
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
  { method: "PATCH",  path: "/notion/databases/rows/:id",  description: "Update a row's properties",                  scope: "write" },
];
export const examples = [
  "POST /notion/setup-project  body: {name, status, oncelik, tasks:[{gorev}]}",
  "GET  /notion/projects?status=Yapılıyor",
  "POST /notion/row  body: {databaseId, title, content}",
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

const createDatabaseSchema = z.object({
  parentPageId: z.string().min(1),
  title: z.string().optional(),
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
   * Create an inline task database inside a page.
   *
   * Body: { parentPageId, title? }
   */
  router.post("/databases", async (req, res) => {
    const data = validate(createDatabaseSchema, req.body, res);
    if (!data) return;

    const schema = taskDatabaseSchema(data.title ?? "Tasks");
    const payload = {
      parent: { type: "page_id", page_id: data.parentPageId },
      ...schema,
      is_inline: true,
    };

    const result = await notionRequest("POST", "/databases", payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, database: formatDatabase(result.data) });
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
      Name: { title: [{ type: "text", text: { content: data.name } }] },
      Status: { status: { name: data.status } },
      Öncelik: { select: { name: data.oncelik } },
    };
    if (data.baslangic) properties["Başlangıç"] = { date: { start: data.baslangic } };
    if (data.bitis) properties["bitiş"] = { date: { start: data.bitis } };

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: dbId },
      properties,
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const row = result.data;
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
      payload.filter = { property: "Status", status: { equals: req.query.status } };
    }
    payload.sorts = [{ property: "Başlangıç", direction: "descending" }];

    const result = await notionRequest("POST", `/databases/${dbId}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const projects = (result.data.results ?? []).map((p) => ({
      id: p.id,
      name: p.properties?.Name?.title?.[0]?.plain_text ?? "Untitled",
      status: p.properties?.Status?.status?.name ?? null,
      oncelik: p.properties?.Öncelik?.select?.name ?? null,
      baslangic: p.properties?.["Başlangıç"]?.date?.start ?? null,
      bitis: p.properties?.["bitiş"]?.date?.start ?? null,
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
      Görev: { title: [{ type: "text", text: { content: data.gorev } }] },
      "": { checkbox: data.tamamlandi ?? false },
    };
    if (data.sonTarih) properties["Son Tarih"] = { date: { start: data.sonTarih } };
    if (data.projeId) properties["Projeler"] = { relation: [{ id: data.projeId }] };

    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: dbId },
      properties,
    });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const row = result.data;
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
      filters.push({ property: "Projeler", relation: { contains: req.query.projeId } });
    }
    if (req.query.tamamlandi !== undefined) {
      filters.push({ property: "", checkbox: { equals: req.query.tamamlandi === "true" } });
    }
    if (filters.length === 1) payload.filter = filters[0];
    else if (filters.length > 1) payload.filter = { and: filters };

    const result = await notionRequest("POST", `/databases/${dbId}/query`, payload);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const tasks = (result.data.results ?? []).map((p) => ({
      id: p.id,
      gorev: p.properties?.Görev?.title?.[0]?.plain_text ?? "Untitled",
      tamamlandi: p.properties?.[""]?.checkbox ?? false,
      sonTarih: p.properties?.["Son Tarih"]?.date?.start ?? null,
      projeler: (p.properties?.Projeler?.relation ?? []).map((r) => r.id),
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
      Name: { title: [{ type: "text", text: { content: data.name } }] },
      Status: { status: { name: data.status } },
      Öncelik: { select: { name: data.oncelik } },
    };
    if (data.baslangic?.trim()) projectProperties["Başlangıç"] = { date: { start: data.baslangic.trim() } };
    if (data.bitis?.trim()) projectProperties["bitiş"] = { date: { start: data.bitis.trim() } };

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
          Görev: { title: [{ type: "text", text: { content: task.gorev } }] },
          Projeler: { relation: [{ id: projectId }] },
        };
        if (task.sonTarih) taskProperties["Son Tarih"] = { date: { start: task.sonTarih } };
        // Notion checkbox field has empty-string name — cannot be written via API, defaults to false
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

    res.json({
      ok: true,
      id: page.id,
      url: pageUrl,
      title,
      contentBlocks: contentBlocks.length,
    });
  });

  app.use("/notion", router);
}
