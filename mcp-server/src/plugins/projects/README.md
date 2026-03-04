# Plugin: projects

Multi-project, multi-environment configuration registry. Each project can have multiple environments (`dev`, `staging`, `prod`) with resources bound to them — GitHub repos, Notion databases, n8n instances, OpenAPI specs, Slack webhooks, etc.

---

## Why Use This?

When an agent says _"Work on Percepta in prod"_, the projects plugin resolves the full context:
- Which GitHub repo?
- Which Notion database?
- Which n8n instance?
- Which OpenAPI spec?

Instead of repeating config every time, the agent just specifies `project + env`.

---

## Quick Start

### 1. Create a project

```bash
curl -X POST http://localhost:8787/projects \
  -H "Content-Type: application/json" \
  -d '{"key": "percepta", "name": "Percepta"}'
```

### 2. Configure an environment

```bash
curl -X PUT http://localhost:8787/projects/percepta/dev \
  -H "Content-Type: application/json" \
  -d '{
    "github":           "hsynalv/percepta_fe",
    "notionProjectsDb": "abc123...",
    "notionTasksDb":    "def456...",
    "n8nBaseUrl":       "http://host.docker.internal:5678",
    "openapiSpecId":    "a1b2c3d4",
    "slackWebhook":     "{{secret:PERCEPTA_DEV_SLACK}}"
  }'
```

### 3. Resolve environment context

```bash
curl http://localhost:8787/projects/percepta/dev
```

```json
{
  "ok": true,
  "project": "percepta",
  "env": "dev",
  "config": {
    "github": "hsynalv/percepta_fe",
    "notionProjectsDb": "abc123...",
    "n8nBaseUrl": "http://host.docker.internal:5678",
    "openapiSpecId": "a1b2c3d4",
    "slackWebhook": "[RESOLVED:{{secret:PERCEPTA_DEV_SLACK}}]"
  }
}
```

---

## Endpoints

| Method   | Path                   | Scope    | Description                          |
|----------|------------------------|----------|--------------------------------------|
| `GET`    | `/projects`            | `read`   | List all projects                    |
| `POST`   | `/projects`            | `write`  | Create a project                     |
| `GET`    | `/projects/:name`      | `read`   | Get project detail (all envs)        |
| `GET`    | `/projects/:name/:env` | `read`   | Get resolved env config              |
| `PUT`    | `/projects/:name/:env` | `write`  | Upsert env config (merges)           |
| `DELETE` | `/projects/:name`      | `danger` | Delete project and all its envs      |
| `GET`    | `/projects/health`     | `read`   | Plugin health                        |

---

## Data Model

```json
{
  "percepta": {
    "name": "Percepta",
    "createdAt": "2026-03-01T...",
    "envs": {
      "dev": {
        "github":           "hsynalv/percepta_fe",
        "notionProjectsDb": "abc123",
        "notionTasksDb":    "def456",
        "n8nBaseUrl":       "http://host.docker.internal:5678",
        "openapiSpecId":    "spec-xyz",
        "slackWebhook":     "{{secret:PERCEPTA_SLACK}}"
      },
      "prod": {
        "github":           "hsynalv/percepta_fe",
        "n8nBaseUrl":       "https://n8n.percepta.io"
      }
    }
  }
}
```

Stored at `{CATALOG_CACHE_DIR}/projects.json`.

---

## Config Fields

| Field              | Description                                   |
|--------------------|-----------------------------------------------|
| `github`           | GitHub repo in `owner/repo` format            |
| `notionProjectsDb` | Notion projects database ID                   |
| `notionTasksDb`    | Notion tasks database ID                      |
| `n8nBaseUrl`       | n8n instance URL                              |
| `openapiSpecId`    | ID from the openapi plugin                    |
| `slackWebhook`     | Slack webhook URL (can use `{{secret:NAME}}`) |
| Custom fields      | Any additional string fields are supported    |

---

## Secret Refs

Values can contain `{{secret:NAME}}` placeholders (same as the secrets plugin). When fetched via `GET /projects/:name/:env`, refs show as `[RESOLVED:...]` confirming the secret exists — without revealing the value.
