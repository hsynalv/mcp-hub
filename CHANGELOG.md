# Changelog

All notable changes to AI-Hub will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Vector DB plugin (planned)
- CI/CD plugin (planned)
- Enhanced documentation

### Changed
- Improved error handling across all plugins
- Better rate limiting support

## [1.0.0] - 2026-03-04

### 🎉 Major Release - AI-Hub Launch

#### Added
- **Plugin System**: Extensible plugin architecture
- **Core Plugins**: 13 production-ready plugins
  - `github` - Repository analysis and management
  - `notion` - Project and task management
  - `http` - Controlled HTTP requests
  - `database` - Multi-database support (MSSQL, PostgreSQL, MongoDB)
  - `file-storage` - S3, Google Drive, local storage
  - `openapi` - API specification loading
  - `secrets` - Secure credential management
  - `policy` - Rule-based approval system
  - `observability` - Health checks and metrics
  - `projects` - Multi-project configuration
  - `docker` - Container and image management
  - `slack` - Team communication and bot integration

#### Features
- **Universal AI Agent Bridge**: Connect any AI agent via REST API
- **Optional n8n Integration**: Backward compatible with n8n workflows
- **Environment-based Configuration**: Flexible deployment options
- **Comprehensive Documentation**: Integration guides and examples
- **Security First**: API key management, authentication, rate limiting
- **Production Ready**: Error handling, logging, monitoring

#### Documentation
- **Integration Guides**:
  - Cursor integration
  - Claude Desktop (MCP) integration
  - Custom LLM application integration
- **Use Cases**: Real-world workflow examples
- **Plugin Development**: Complete development guide
- **API Reference**: All endpoints documented

#### Breaking Changes
- Project renamed from `mcp-hub` to `ai-hub`
- n8n plugins now optional (disable with environment variables)

#### Migration Guide
For existing `mcp-hub` users:

1. **Update package name**: `npm install ai-hub@latest`
2. **Update environment variables**:
   ```bash
   # Optional: Disable n8n plugins for non-n8n use
   ENABLE_N8N_PLUGIN=false
   ENABLE_N8N_CREDENTIALS=false
   ENABLE_N8N_WORKFLOWS=false
   ```
3. **Update integration endpoints**:
   - All endpoints remain the same
   - New plugins available at `/docker/*`, `/slack/*`

#### Security
- Input validation with Zod schemas
- Rate limiting on all endpoints
- Secure credential handling
- No secrets in logs
- HTTPS enforcement in production

#### Performance
- Efficient caching mechanisms
- Parallel API requests
- Optimized Docker socket communication
- Memory-efficient plugin loading

#### Developer Experience
- Hot-reload development server
- Comprehensive error messages
- Plugin auto-discovery
- Standardized response format

## [0.9.0] - Previous Versions (mcp-hub)

### Legacy Features
- n8n-specific workflow generation
- Node catalog with 439+ nodes
- Credential metadata extraction
- Workflow validation and application

---

## Version Support

| Version | Supported | End of Life |
|----------|------------|---------------|
| 1.0.x   | ✅ Yes     | TBD          |
| 0.9.x   | ⚠️ Legacy  | 2026-06-01   |

## Migration Path

### From mcp-hub 0.9.x to ai-hub 1.0.0

1. **Backup your configuration**
   ```bash
   cp .env .env.backup
   ```

2. **Update dependencies**
   ```bash
   npm uninstall mcp-hub
   npm install ai-hub@1.0.0
   ```

3. **Update configuration**
   - Add new plugin tokens (Slack, etc.)
   - Set n8n plugin preferences

4. **Test your setup**
   ```bash
   npm run dev
   curl http://localhost:8787/plugins
   ```

5. **Update integrations**
   - Update AI agent tool configurations
   - Test new endpoints

## Security Updates

### Critical Security Updates

Security vulnerabilities will be documented here with:

- CVE identifier (if applicable)
- Severity level (Critical/High/Medium/Low)
- Affected versions
- Fixed version
- Mitigation steps

Example:
```
## [1.0.1] - 2026-03-15

### Security
- Fixed CVE-2026-1234: Authentication bypass in Slack plugin
- Severity: High
- Affected: 1.0.0
- Fixed: 1.0.1
- Mitigation: Update to version 1.0.1 immediately
```

## Roadmap

### Upcoming Features (Planned)

#### Version 1.1.0
- [ ] Vector DB plugin (Pinecone, Chroma, Weaviate)
- [ ] CI/CD plugin (GitHub Actions, GitLab CI)
- [ ] Enhanced monitoring dashboard
- [ ] Plugin marketplace

#### Version 1.2.0
- [ ] Email plugin (SendGrid, AWS SES)
- [ ] Calendar integration (Google Calendar, Outlook)
- [ ] Advanced workflow builder
- [ ] Multi-tenant support

#### Version 2.0.0
- [ ] Web UI for management
- [ ] Real-time collaboration features
- [ ] Advanced AI orchestration
- [ ] Enterprise features

---

For more detailed information about releases, visit:
- [GitHub Releases](https://github.com/your-org/ai-hub/releases)
- [Migration Guide](./docs/migration.md)
- [Security Policy](./docs/security.md)
