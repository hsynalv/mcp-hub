# Plugin: workspace

File system operations for AI workspace — read, write, list, and manage project files.

**Primary use cases:**
- AI reads source code for analysis
- AI writes generated code to files
- AI lists project structure
- AI manages directories and file trees

---

## Setup

Configure workspace base path:

```env
WORKSPACE_PATH=/Users/username/workspace
# or
WORKSPACE_PATH=/home/user/projects
```

Each project is stored under `WORKSPACE_PATH/{projectId}/`.

---

## Endpoints

### `GET /workspace/files`

Read a file.

```bash
curl "http://localhost:8787/workspace/files?projectId=my-app&path=src/index.js"
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "content": "export function main() { ... }",
    "path": "src/index.js",
    "size": 1024,
    "modified": "2026-03-01T10:00:00Z"
  }
}
```

### `POST /workspace/files`

Write a file.

```bash
curl -X POST http://localhost:8787/workspace/files \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "path": "src/utils.js",
    "content": "export const helper = () => {};"
  }'
```

### `DELETE /workspace/files`

Delete a file or directory.

```bash
curl -X DELETE http://localhost:8787/workspace/files \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "path": "temp/old.js"
  }'
```

### `GET /workspace/tree`

Get directory tree structure.

```bash
curl "http://localhost:8787/workspace/tree?projectId=my-app&path=src"
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "path": "src",
    "type": "directory",
    "children": [
      { "name": "index.js", "type": "file", "size": 1024 },
      { "name": "utils", "type": "directory" }
    ]
  }
}
```

### `POST /workspace/dirs`

Create a directory.

```bash
curl -X POST http://localhost:8787/workspace/dirs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "path": "src/components"
  }'
```

### `POST /workspace/move`

Move/rename files.

```bash
curl -X POST http://localhost:8787/workspace/move \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-app",
    "from": "src/old.js",
    "to": "src/new.js"
  }'
```

### `GET /workspace/search`

Search files by name pattern.

```bash
curl "http://localhost:8787/workspace/search?projectId=my-app&pattern=*.test.js"
```

---

## MCP Tools

| Tool | Description | Tags |
|------|-------------|------|
| `workspace_read_file` | Read file content | `READ`, `LOCAL_FS` |
| `workspace_write_file` | Write file content | `WRITE`, `LOCAL_FS` |
| `workspace_delete_file` | Delete file/directory | `WRITE`, `LOCAL_FS` |
| `workspace_list_dir` | List directory contents | `READ`, `LOCAL_FS` |
| `workspace_create_dir` | Create directory | `WRITE`, `LOCAL_FS` |
| `workspace_move_file` | Move/rename file | `WRITE`, `LOCAL_FS` |
| `workspace_search_files` | Search files by pattern | `READ`, `LOCAL_FS` |

---

## Workflow Example

```bash
# 1. Create project structure
curl -X POST http://localhost:8787/workspace/dirs \
  -d '{"projectId":"my-app","path":"src/components"}'

# 2. Write component file
curl -X POST http://localhost:8787/workspace/files \
  -d '{
    "projectId":"my-app",
    "path":"src/components/Button.js",
    "content":"export function Button() { ... }"
  }'

# 3. Read back to verify
curl "http://localhost:8787/workspace/files?projectId=my-app&path=src/components/Button.js"

# 4. List all files
curl "http://localhost:8787/workspace/tree?projectId=my-app"
```

---

## Security

- All paths are relative to `WORKSPACE_PATH/{projectId}/`
- Path traversal (`../`) is blocked
- Project isolation enforced
- No access outside workspace
