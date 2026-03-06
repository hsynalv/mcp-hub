# Local Sidecar Plugin

Safe local filesystem access with whitelist enforcement for MCP Hub.

## Overview

The Local Sidecar plugin provides secure filesystem operations through a whitelist-based access control system. It allows MCP Hub to safely access user files while preventing unauthorized access to sensitive system directories.

## Features

- **Whitelist Protection**: Only whitelisted directories can be accessed
- **File Operations**: List, read, write, and hash files
- **Google Drive Integration**: Upload files with approval-based policy enforcement
- **Audit Compliance**: All operations require explanation field
- **Size Limits**: Prevent reading oversized files (default 1MB max)
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Tools

### fs_list
List directory contents with metadata (type, size, modification date).

```javascript
{
  path: "/path/to/directory",
  explanation: "List project files"
}
```

**Tags**: `read_only`, `local_fs`

### fs_read
Read file contents with configurable size limit.

```javascript
{
  path: "/path/to/file.txt",
  maxSize: 1048576,  // Optional, default 1MB
  explanation: "Read configuration file"
}
```

**Tags**: `read_only`, `local_fs`

### fs_write
Write content to files (whitelist enforced).

```javascript
{
  path: "/path/to/file.txt",
  content: "file contents",
  explanation: "Update configuration"
}
```

**Tags**: `write`, `destructive`, `local_fs`

### fs_hash
Calculate SHA-256 hash of files.

```javascript
{
  path: "/path/to/file.txt",
  explanation: "Verify file integrity"
}
```

**Tags**: `read_only`, `local_fs`

### drive_upload
Upload files to Google Drive using rclone (requires approval).

```javascript
{
  path: "/path/to/file.txt",
  remote: "drive",      // Optional, default "drive"
  destination: "/",   // Optional, default root
  explanation: "Backup project files"
}
```

**Tags**: `write`, `needs_approval`, `network`, `external_api`

## Configuration

### Whitelist

By default, the plugin allows access to:
- Current working directory (`cwd`)
- `~/Documents`
- `~/Downloads`

### Custom Whitelist

Create a `whitelist.json` file in your project root:

```json
{
  "directories": [
    "/Users/username/Projects",
    "/Users/username/Documents",
    "/tmp/workspace"
  ]
}
```

Or set the environment variable:
```bash
export WHITELIST_CONFIG_PATH=/path/to/whitelist.json
```

### Google Drive Setup

1. Install rclone:
```bash
# macOS
brew install rclone

# Linux
curl https://rclone.org/install.sh | sudo bash
```

2. Configure Google Drive:
```bash
rclone config
# Name: drive
# Type: 13 (Google Drive)
# Follow prompts to authenticate
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/local/fs/list` | List directory |
| GET | `/local/fs/read` | Read file |
| POST | `/local/fs/write` | Write file |
| GET | `/local/fs/hash` | Calculate hash |
| POST | `/local/drive/upload` | Upload to Drive |

## Security

- Path normalization prevents directory traversal attacks
- All paths resolved to absolute before whitelist check
- `needs_approval` tag triggers policy approval flow
- Audit logging for all operations

## Examples

### List Directory
```bash
curl "http://localhost:8787/local/fs/list?path=./src"
```

### Read File
```bash
curl "http://localhost:8787/local/fs/read?path=./package.json"
```

### Write File
```bash
curl -X POST http://localhost:8787/local/fs/write \
  -H "Content-Type: application/json" \
  -d '{"path": "./output.txt", "content": "Hello World"}'
```

### Upload to Drive
```bash
curl -X POST http://localhost:8787/local/drive/upload \
  -H "Content-Type: application/json" \
  -d '{
    "path": "./backup.zip",
    "destination": "/Backups/2024",
    "explanation": "Weekly project backup"
  }'
```

## Environment Variables

- `WHITELIST_CONFIG_PATH`: Path to custom whitelist configuration
- `NOTION_API_KEY`: Required for Notion integration (if used)

## Error Codes

| Code | Description |
|------|-------------|
| `access_denied` | Path not in whitelist |
| `not_a_file` | Path is a directory, not file |
| `file_too_large` | File exceeds max size limit |
| `fs_error` | General filesystem error |
| `rclone_not_found` | rclone command not available |
| `rclone_error` | rclone upload failed |

## Testing

```bash
npm test tests/plugins/local-sidecar.test.js
```

## License

MIT
