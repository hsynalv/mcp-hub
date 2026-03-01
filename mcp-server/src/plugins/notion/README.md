# Plugin: notion

Gives the AI agent read and write access to Notion — pages, databases, and task rows.

**Primary use cases:**
- AI creates a project + all tasks in Notion from a GitHub analysis (one call)
- AI adds rows to any Notion database (Notlar, Projeler, custom tables)
- AI searches Notion before creating duplicates
- AI updates task status as work progresses

---

## Setup

### 1. Create a Notion Integration

Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) and create a new **Internal** integration.

Copy the **Internal Integration Secret** and add it to `.env`:

```env
NOTION_API_KEY=secret_xxxxxxxxxxxxxxxxxxxx
NOTION_ROOT_PAGE_ID=<optional default parent page ID>
NOTION_PROJECTS_DB_ID=<your Projeler database ID>
NOTION_TASKS_DB_ID=<your Yapılacaklar database ID>
```

### 2. Share pages/databases with the integration

In Notion, open any page or database. Click **"..."** → **"Connect to"** → select your integration.

The integration can only access pages that have been explicitly shared with it.

### 3. Find database IDs

Open a database in Notion → copy the URL. The ID is the UUID in the URL:
```
https://notion.so/Projeler-abc123def456...
                            ↑ this is the ID
```

---

## Endpoints

### `POST /notion/setup-project` ⭐ Primary AI Tool

Creates a project row in the **Projeler** database and all linked task rows in the **Yapılacaklar** database in **a single HTTP call**.

**Body:**
```json
{
  "name": "mcp-hub",
  "status": "Yapılıyor",
  "oncelik": "Yüksek",
  "baslangic": "2026-03-01",
  "bitis": "2026-04-01",
  "tasks": [
    { "gorev": "GitHub plugin ekle", "sonTarih": "2026-03-10" },
    { "gorev": "Notion entegrasyonu", "sonTarih": "2026-03-15" },
    { "gorev": "Dokümantasyon yaz" }
  ]
}
```

| Field | Required | Options |
|-------|----------|---------|
| `name` | ✅ | Project name |
| `status` | ✅ | `Yapılmadı` / `Yapılıyor` / `Tamamlandı` |
| `oncelik` | ✅ | `Az` / `Normal` / `Yüksek` |
| `baslangic` | — | `YYYY-MM-DD` |
| `bitis` | — | `YYYY-MM-DD` |
| `tasks` | — | Array of `{ gorev, sonTarih? }` |

**Response:**
```json
{
  "ok": true,
  "project": {
    "id": "abc123",
    "name": "mcp-hub",
    "status": "Yapılıyor",
    "url": "https://notion.so/..."
  },
  "tasks": {
    "created": 3,
    "failed": 0,
    "items": [...]
  }
}
```

---

### `POST /notion/row` ⭐ Add a row to any Notion database

Adds a row to **any** Notion database — not just Projeler or Yapılacaklar. Use `notion_search` first to find the database ID.

**Body:**
```json
{
  "databaseId": "abc123def456...",
  "title": "Percepta son durum notu",
  "properties": {}
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `databaseId` | ✅ | Notion database ID (from search results `.id`) |
| `title` | ✅ | Row title / name |
| `properties` | — | Extra Notion API properties (raw format) |

**Response:**
```json
{
  "ok": true,
  "id": "row-page-id",
  "url": "https://notion.so/...",
  "title": "Percepta son durum notu"
}
```

**Typical flow:**
```
1. GET /notion/search?q=Notlar&type=database  → get database ID
2. POST /notion/row  { databaseId, title }    → add the row
```

---

### `GET /notion/search`

Search across all pages and databases the integration has access to.

**Query params:**

| Param | Description |
|-------|-------------|
| `q` | Search term |
| `type` | `page` or `database` (optional) |
| `limit` | Max results (default: 20) |

**Example:**
```bash
curl "http://localhost:8787/notion/search?q=Projeler&type=database"
```

**Response:**
```json
{
  "ok": true,
  "count": 1,
  "items": [
    { "id": "abc123", "title": "Projeler", "type": "database", "url": "https://notion.so/..." }
  ]
}
```

---

### `GET /notion/sections`

Lists all pages and databases accessible to the integration. Useful for AI to discover what sections exist.

```bash
curl "http://localhost:8787/notion/sections"
```

---

### `GET /notion/projects`

List projects from the **Projeler** database.

**Query params:**

| Param | Description |
|-------|-------------|
| `status` | Filter by `Yapılmadı`, `Yapılıyor`, or `Tamamlandı` |
| `limit` | Max results (default: 50) |

```bash
curl "http://localhost:8787/notion/projects?status=Yapılıyor"
```

---

### `POST /notion/projects`

Create a project row in the **Projeler** database.

```json
{
  "name": "My Project",
  "status": "Yapılmadı",
  "oncelik": "Normal"
}
```

---

### `GET /notion/tasks`

List tasks from the **Yapılacaklar** database.

**Query params:**

| Param | Description |
|-------|-------------|
| `projeId` | Filter by project Notion page ID |
| `tamamlandi` | `true` / `false` — filter by completion |
| `limit` | Max results (default: 50) |

```bash
curl "http://localhost:8787/notion/tasks?tamamlandi=false"
```

---

### `POST /notion/tasks`

Create a task in the **Yapılacaklar** database.

```json
{
  "gorev": "GitHub plugin'i tamamla",
  "projeId": "project-page-id",
  "sonTarih": "2026-03-15",
  "oncelik": "Yüksek"
}
```

---

### `POST /notion/pages`

Create a new page inside an existing Notion page.

**Body:**
```json
{
  "title": "Project Plan",
  "parentPageId": "abc123",
  "icon": "🚀",
  "blocks": [
    { "type": "heading_1", "text": "Overview" },
    { "type": "paragraph", "text": "This project..." },
    { "type": "bullet", "text": "First goal" },
    { "type": "todo", "text": "Complete setup", "checked": false }
  ]
}
```

If `parentPageId` is omitted, `NOTION_ROOT_PAGE_ID` from `.env` is used.

**Supported block types:**

| `type` | Description |
|--------|-------------|
| `heading_1` / `heading_2` / `heading_3` | Section headings |
| `paragraph` | Regular text |
| `bullet` | Bulleted list item |
| `numbered` | Numbered list item |
| `todo` | Checkbox (add `"checked": true` to check it) |
| `quote` | Block quote |
| `callout` | Highlighted callout (add `"emoji"` for icon) |
| `code` | Code block (add `"language"` e.g. `"javascript"`) |
| `divider` | Horizontal line separator |

---

### `PATCH /notion/pages/:id/append`

Append blocks to an existing page — for progress updates without replacing content.

```json
{
  "blocks": [
    { "type": "heading_2", "text": "Update — March 2026" },
    { "type": "todo", "text": "GitHub plugin done", "checked": true }
  ]
}
```

---

### `GET /notion/pages/:id/blocks`

Get content blocks of a page (up to 100).

---

### `POST /notion/databases/:id/rows`

Add a task row to a specific database using the standard task schema.

```json
{
  "name": "Implement feature X",
  "status": "Todo",
  "priority": "High",
  "dueDate": "2026-03-15",
  "notes": "Start with the API layer"
}
```

---

### `POST /notion/databases/:id/rows/query`

Query rows from a database with optional filters.

```json
{
  "filter": {
    "property": "Status",
    "select": { "equals": "In Progress" }
  },
  "pageSize": 50
}
```

---

### `PATCH /notion/databases/rows/:rowId`

Update a row's properties.

```json
{
  "status": "Done",
  "notes": "Completed"
}
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `NOTION_API_KEY` | ✅ | Notion internal integration secret |
| `NOTION_ROOT_PAGE_ID` | Optional | Default parent page when `parentPageId` is not specified |
| `NOTION_PROJECTS_DB_ID` | Required for `setup-project`, `projects` | Projeler database ID |
| `NOTION_TASKS_DB_ID` | Required for `setup-project`, `tasks` | Yapılacaklar database ID |

Without `NOTION_API_KEY`, all endpoints return:
```json
{ "ok": false, "error": "missing_api_key", "message": "NOTION_API_KEY is not set" }
```
