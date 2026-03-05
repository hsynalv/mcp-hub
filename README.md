# AI-Hub

> A plugin-based HTTP knowledge service for AI agents — universal tool and service bridge for Cursor, Claude Desktop, n8n and custom LLM applications.

**AI-Hub** bridges AI agents (running in Cursor, Claude Desktop, n8n, or any LLM environment) with the tools and platforms they need. Instead of guessing API parameters, credential names, or service structures, the agent asks AI-Hub and gets ground truth back.

No LLM calls. No hallucinations. Just clean REST endpoints backed by real data.

---

## ✨ What's New

### Phase 4: AI Enhancement
- **Tech Stack Detector** - Automatically detect project technologies
- **Multi-LLM Router** - Route tasks to specialized LLMs (Claude for coding, GPT-4o for design)
- **Code Review Plugin** - Automated PR reviews, security scanning, quality checks
- **Image Generation** - DALL-E 3 & Stability AI for logos, mockups, UI assets
- **Video Generation** - Runway & Pika for demos, tutorials, promos

### Developer Tools
- **CLI Interface** - Interactive terminal for managing the server
- **Plugin Generator** - Scaffold new plugins with one command
- **Debug Mode** - Request tracing, performance profiling, detailed logging
- **Hot Reload** - Auto-restart on file changes during development

---

## What it does

| Capability | Description |
|------------|-------------|
| **Universal API Bridge** | Connect any AI agent to 20+ services via REST |
| **GitHub Integration** | Repository analysis, file tree, commits, issues, PRs |
| **Notion Management** | Pages, databases, projects and tasks |
| **HTTP Control** | Safe, rate-limited HTTP requests with caching |
| **Database Access** | MSSQL, PostgreSQL, MongoDB connections |
| **File Storage** | S3, Google Drive, local file operations |
| **OpenAPI Support** | Load and analyze API specifications |
| **n8n Integration** | Node catalog, workflow validation, credentials |
| **Secret Management** | Secure credential reference system |
| **Policy Engine** | Rule-based approval system |
| **Observability** | Health checks, Prometheus metrics, structured logging |
| **AI Enhancement** | Tech detection, multi-LLM routing, image/video generation |
| **Developer Tools** | CLI, hot reload, debug mode, plugin generator |

---

## Plugins

| Plugin | Endpoints | Description |
|--------|-----------|-------------|
| `github` | `/github/*` | Repository analysis, file tree, commits, issues |
| `notion` | `/notion/*` | Pages, databases, projects and tasks |
| `http` | `/http/*` | Controlled HTTP requests with rate limiting |
| `database` | `/database/*` | MSSQL, PostgreSQL, MongoDB connections |
| `file-storage` | `/files/*` | S3, Google Drive, local file operations |
| `openapi` | `/openapi/*` | API specification loading and analysis |
| `secrets` | `/secrets/*` | Secure credential reference system |
| `policy` | `/policy/*` | Rule-based approval system |
| `observability` | `/observability/*` | Health checks, metrics, error tracking |
| `projects` | `/projects/*` | Multi-project configuration management |
| `n8n` | `/n8n/*` | **Optional**: Node catalog, context, validation |
| `n8n-credentials` | `/credentials/*` | Credential metadata from n8n |
| `n8n-workflows` | `/n8n/workflows/*` | Workflow list, detail, search |
| **tech-detector** | `/tech/*` | **NEW:** Auto-detect project technologies |
| **llm-router** | `/llm/*` | **NEW:** Multi-LLM task routing |
| **code-review** | `/code-review/*` | **NEW:** Automated PR reviews |
| **image-gen** | `/image/*` | **NEW:** AI image generation |
| **video-gen** | `/video/*` | **NEW:** AI video generation |

---

## Quick Start

```bash
cd mcp-server
npm install
cp .env.example .env
# edit .env with your API keys
npm run dev
```

For non-n8n deployments, disable n8n plugins:

```bash
# Set these in your .env
ENABLE_N8N_PLUGIN=false
ENABLE_N8N_CREDENTIALS=false
ENABLE_N8N_WORKFLOWS=false
```

---

## Developer Tools

### CLI Interface

```bash
# Start interactive CLI
node bin/mcp-cli.js

# Inside CLI
mcp> help              # Show commands
mcp> status            # Check server health
mcp> plugins           # List plugins
mcp> tools             # List MCP tools
mcp> generate my-plugin # Create new plugin
mcp> test all          # Run tests
mcp> exit
```

### Hot Reload

```bash
# Auto-restart on file changes
node src/core/hot-reload.js start

# Check status
node src/core/hot-reload.js status
```

### Debug Mode

```bash
# Enable verbose logging
DEBUG=true npm start

# Or via CLI
mcp> debug on
```

### Plugin Generator

```bash
# Generate a new plugin scaffold
mcp> generate my-awesome-plugin

# Creates:
# - src/plugins/my-awesome-plugin/index.js
# - tests/plugins/my-awesome-plugin.test.js
```

---

## Use Cases

### For AI Agent Developers
- **Cursor Integration**: Add AI-Hub endpoints to your Cursor tools
- **Claude Desktop**: Use as MCP server for Claude
- **Custom LLM Apps**: HTTP endpoints for any AI application

### For Development Teams
- **GitHub Analysis**: Repository insights and code structure
- **Project Management**: Notion integration for task tracking
- **API Documentation**: OpenAPI spec loading and analysis

### For Automation
- **Database Operations**: Query and manage multiple databases
- **File Management**: S3, Google Drive, local storage
- **HTTP Requests**: Controlled external API calls

---

## Project Structure

```
ai-hub/
├── mcp-server/                   # Main application (port 8787)
│   ├── src/
│   │   ├── core/                 # Server, plugin loader, auth, audit
│   │   └── plugins/
│   │       ├── github/            # GitHub repository analysis
│   │       ├── notion/            # Notion pages, databases, tasks
│   │       ├── http/              # Controlled HTTP requests
│   │       ├── database/          # MSSQL, PostgreSQL, MongoDB
│   │       ├── file-storage/      # S3, Google Drive, local
│   │       ├── openapi/           # API spec loading
│   │       ├── secrets/           # Secret management
│   │       ├── policy/            # Rule engine
│   │       ├── observability/     # Health, metrics
│   │       ├── projects/          # Multi-project config
│   │       ├── tech-detector/     # Tech stack detection
│   │       ├── llm-router/        # Multi-LLM routing
│   │       ├── code-review/       # Automated code review
│   │       ├── image-gen/         # AI image generation
│   │       ├── video-gen/         # AI video generation
│   │       └── n8n*/             # n8n integration
│   ├── bin/
│   │   └── mcp-cli.js            # CLI interface
│   ├── tests/                     # Unit tests
│   └── .env.example
├── PLAN.md                       # Plugin roadmap
└── README.md                     # This file
```

→ See [`mcp-server/README.md`](./mcp-server/README.md) for the full documentation.

---

## AI Agent Integration Examples

### Cursor Integration
Add to your Cursor tools:
```json
{
  "name": "ai-hub-github",
  "endpoint": "http://localhost:8787/github/analyze",
  "method": "POST",
  "description": "Analyze GitHub repository"
}
```

### Claude Desktop (MCP)
```json
{
  "mcpServers": {
    "ai-hub": {
      "command": "node",
      "args": ["/path/to/ai-hub/mcp-server/src/index.js"],
      "env": {
        "ENABLE_N8N_PLUGIN": "false"
      }
    }
  }
}
```

### Custom LLM Application
```python
import requests

def analyze_repo(repo_name):
    response = requests.post(
        "http://localhost:8787/github/analyze",
        json={"repo": repo_name}
    )
    return response.json()
```

---

## 🚀 Getting Started

### Quick Install
```bash
# Clone the repository
git clone https://github.com/your-org/ai-hub.git
cd ai-hub/mcp-server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start the server
npm run dev
```

### 🎯 Try It Out

```bash
# Check available plugins
curl http://localhost:8787/plugins

# Analyze a GitHub repository
curl -X POST http://localhost:8787/github/analyze \
  -H "Content-Type: application/json" \
  -d '{"repo": "vercel/next.js"}'

# Detect tech stack
curl -X POST http://localhost:8787/tech/detect \
  -H "Content-Type: application/json" \
  -d '{"path": "./src"}'

# Generate an image
curl -X POST http://localhost:8787/image/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "modern dashboard UI", "type": "mockup"}'

# List Docker containers (requires Docker)
curl http://localhost:8787/docker/containers

# Send Slack message (requires Slack token)
curl -X POST http://localhost:8787/slack/message \
  -H "Content-Type: application/json" \
  -d '{"channel": "#general", "text": "Hello from AI-Hub!"}'
```

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/chart.svg?repo=your-org/ai-hub)]

## 🏆 Community

- **Discord**: [Join our Discord](https://discord.gg/ai-hub)
- **GitHub Discussions**: [Ask questions](https://github.com/your-org/ai-hub/discussions)
- **Twitter**: Follow [@AIHubDev](https://twitter.com/AIHubDev)

## 📊 Stats

![GitHub stars](https://img.shields.io/github/stars/your-org/ai-hub?style=social)
![GitHub forks](https://img.shields.io/github/forks/your-org/ai-hub?style=social)
![GitHub issues](https://img.shields.io/github/issues/your-org/ai-hub)
![GitHub license](https://img.shields.io/github/license/your-org/ai-hub)

## 🎁 Contributors

Thanks to all our contributors! 🙏

<a href="https://github.com/your-org/ai-hub/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=your-org/ai-hub" />
</a>
