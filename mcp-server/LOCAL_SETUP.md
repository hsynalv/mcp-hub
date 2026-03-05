# Local Development Setup (Recommended for Jarvis Vision)

> Native installation for full system access - files, terminal, and future integrations.

---

## Quick Start

### 1. Prerequisites

```bash
# macOS (Homebrew)
brew install node redis git

# Start Redis
brew services start redis

# Verify
redis-cli ping  # Should return "PONG"
```

### 2. Install & Configure

```bash
# Clone and enter
cd /Users/beyazskorsky/Documents/mcp/mcp-server

# Install dependencies
npm install

# Copy and edit env
cp .env.example .env
```

Edit `.env`:
```env
# Required
OPENAI_API_KEY=sk-your-openai-key
REDIS_URL=redis://localhost:6379

# For GitHub pattern learning
GITHUB_TOKEN=ghp-your-github-token

# For Notion integration
NOTION_API_KEY=secret-your-notion-key
NOTION_PROJECTS_DB_ID=your-database-id
NOTION_TASKS_DB_ID=your-database-id

# Workspace (where projects will be created)
WORKSPACE_PATH=/Users/beyazskorsky/workspace
```

### 3. Run

```bash
# Development (auto-reload)
npm run dev

# Or production mode
npm start
```

### 4. Test

```bash
# Health check
curl http://localhost:8787/health

# Test pattern analysis
curl http://localhost:8787/github-patterns/analyze

# Create project draft
curl -X POST http://localhost:8787/project-orchestrator/draft \
  -d '{"idea":"Build URL shortener","username":"your-github-username"}'
```

---

## Why Native (Not Docker)?

| Feature | Docker | Native |
|---------|--------|--------|
| File system access | Limited to volumes | **Full access** |
| Terminal/Shell | No | **Yes** |
| System notifications | No | **Yes** |
| macOS integrations | No | **Yes** |
| Spotify control | No | **Yes** |
| Email/Calendar | Hard | **Easy** |

**For Jarvis vision**, native is required because:
1. **Full file access** - can read/write anywhere in your home directory
2. **Terminal integration** - can execute shell commands
3. **System access** - notifications, calendar, email, etc.
4. **Future extensibility** - easier to add system-level features

---

## Redis Setup (Required)

Redis is used for:
- Pattern caching (GitHub analysis results)
- Draft sessions (interactive planning state)

### macOS

```bash
# Install
brew install redis

# Start at login
brew services start redis

# Stop
brew services stop redis

# Restart
brew services restart redis
```

### Linux

```bash
# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### Verify

```bash
redis-cli ping
# Expected: PONG

redis-cli info
# Shows Redis stats
```

---

## Project Structure

```
mcp-server/
├── src/
│   ├── core/
│   │   ├── redis.js          # Redis client
│   │   ├── tool-registry.js  # MCP tool registry
│   │   └── jobs.js           # Job queue
│   ├── plugins/
│   │   ├── github-pattern-analyzer/  # NEW: Pattern learning
│   │   ├── project-orchestrator/       # NEW: Interactive planning
│   │   ├── brain/            # AI/LLM integration
│   │   ├── rag/              # Document indexing
│   │   ├── git/              # Git operations
│   │   ├── tests/            # Test runner
│   │   ├── workspace/        # File operations
│   │   ├── notion/           # Notion integration
│   │   └── ...
│   └── index.js              # Server entry
├── workspace/                # Your projects go here
├── .env                      # Your config
└── package.json
```

---

## Development Workflow

### 1. Start Redis (if not running)

```bash
redis-cli ping
# If not PONG:
brew services start redis
```

### 2. Start Server

```bash
npm run dev
```

### 3. Test Interactive Flow

```bash
# 1. Create draft
DRAFT=$(curl -s -X POST http://localhost:8787/project-orchestrator/draft \
  -H "Content-Type: application/json" \
  -d '{"idea":"Build a todo app","username":"your-github-username"}' | jq -r '.draftId')

# 2. Select architecture (replace opt-1 with actual option)
curl -X POST "http://localhost:8787/project-orchestrator/draft/$DRAFT/select-architecture" \
  -d '{"optionId":"opt-1"}'

# 3. Execute
curl -X POST "http://localhost:8787/project-orchestrator/draft/$DRAFT/execute" \
  -d '{"autoExecuteFirstPhase":true}'
```

---

## Troubleshooting

### "Redis connection refused"

```bash
# Check if Redis is running
redis-cli ping

# Start Redis
brew services start redis

# Or check logs
redis-cli monitor
```

### "OPENAI_API_KEY not set"

```bash
# Check .env file exists
cat .env | grep OPENAI

# Or set temporarily
export OPENAI_API_KEY=sk-...
```

### "GITHUB_TOKEN not set"

Required for pattern learning. Get token at:
https://github.com/settings/tokens

Scopes needed: `repo` (for private repos) or `public_repo` (for public only)

### Port 8787 already in use

```bash
# Find process
lsof -i :8787

# Kill it
kill -9 <PID>

# Or use different port
PORT=9999 npm run dev
```

---

## Future: Phase 2 (Jarvis Features)

With native setup, you can easily add:

| Feature | Implementation |
|---------|---------------|
| File watcher | `chokidar` npm package |
| Email monitoring | `imap` + `mailparser` |
| Calendar | `node-ical` or Google Calendar API |
| Spotify | `spotify-web-api-node` |
| Notifications | `node-notifier` |
| Screenshot | `screenshot-desktop` |
| Shell commands | `child_process.exec` |

All require **native access** - Docker would block these.

---

## VS Code Integration

For best development experience:

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## Ready to Test?

```bash
# 1. Start Redis
redis-cli ping

# 2. Start server
npm run dev

# 3. Open new terminal, test:
curl http://localhost:8787/health
curl http://localhost:8787/plugins
```

Server running at `http://localhost:8787` 🚀
