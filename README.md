# mcp-hub

AI ajanları için plugin-tabanlı HTTP servisi. REST API ve MCP (Model Context Protocol) desteği ile Cursor, Claude Desktop, n8n ve özel LLM uygulamalarına entegrasyon sağlar.

## Özellikler

- **Çift Arayüz**: REST API + MCP Araçları
- **Plugin Sistemi**: Otomatik keşif ve yükleme
- **Policy Motoru**: Onay workflow'ları ve rate limiting
- **Job Kuyruğu**: Async görev yürütme
- **Çoklu Entegrasyon**: GitHub, Notion, n8n, veritabanları, dosya depolama

## Hızlı Başlangıç

```bash
cd mcp-server
npm install
cp .env.example .env
# .env dosyasını düzenleyin
npm run dev
```

## Plugin Maturity Matrix

| Plugin | Owner | Status | Auth | Tests | Docs | Production Ready |
|--------|-------|--------|------|-------|------|------------------|
| github | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| notion | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| llm-router | @hsynalv | 🟢 stable | ❌ | unit | ✅ | Yes |
| policy | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| rag | @hsynalv | 🟡 beta | ❌ | unit | ✅ | No |
| database | @hsynalv | 🟡 beta | ✅ | unit | ✅ | No |
| shell | @hsynalv | 🔴 experimental | ✅ | none | ✅ | No |
| file-storage | @hsynalv | 🟡 beta | ✅ | unit | ✅ | No |
| workspace | @hsynalv | 🟡 beta | ❌ | unit | ✅ | No |

**Legend:** 🟢 Stable | 🟡 Beta | 🔴 Experimental

📋 [View Full Plugin Maturity Matrix →](docs/plugin-maturity-matrix.md)

## Configuration

MCP Hub uses a validated configuration system with Zod schema validation.

### Required Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HUB_READ_KEY` | API key for read operations | Yes |
| `HUB_WRITE_KEY` | API key for write operations | Yes |
| `HUB_ADMIN_KEY` | API key for admin operations | Yes |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 8787 |
| `NODE_ENV` | Environment mode | development |
| `REDIS_URL` | Redis connection URL | - |
| `NOTION_API_KEY` | Notion integration API key | - |
| `GITHUB_TOKEN` | GitHub API token | - |
| `N8N_API_KEY` | n8n API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |

### Configuration Validation

On startup, the server validates all environment variables against a Zod schema:

- **Fail-fast**: Server exits immediately if required config is missing
- **Type validation**: Ensures correct types (numbers, booleans, strings)
- **Sanitized logging**: Secrets are masked in startup logs

### Example .env file

```bash
# Required
HUB_READ_KEY=your-read-key-here
HUB_WRITE_KEY=your-write-key-here
HUB_ADMIN_KEY=your-admin-key-here

# Optional integrations
NOTION_API_KEY=secret_xxx
GITHUB_TOKEN=ghp_xxx
OPENAI_API_KEY=sk-xxx

# Server settings
PORT=8787
NODE_ENV=development
```

## Dökümantasyon

- [Server Detayları](mcp-server/README.md)
- [Mimari](mcp-server/ARCHITECTURE.md)
- [Plugin Geliştirme](mcp-server/docs/plugin-development.md)

## Lisans

MIT
