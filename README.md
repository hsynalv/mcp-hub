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

## Web Panel (/ui)

Sunucu çalışırken web panel:

`http://localhost:8787/ui`

Auth etkinse panel, 6 haneli kısa ömürlü bir UI kodu ile `read` scope yetkisi alabilir (localhost üzerinden `POST /ui/token`). Detaylar: `mcp-server/README.md`.

## Admin Panel (/admin)

20 plugin (PLAN-V2) yönetimi, detaylı loglar ve plugin kontrolü:

`http://localhost:8787/admin`

- **20 Plugins:** PLAN-V2 listesi, katman (AI Zeka / Kod & Git / Proje / Altyapı), yüklü mü, tool sayısı, health/audit linkleri.
- **İşlem audit:** Core audit kayıtları (plugin, işlem, actor, izin, süre); plugin/operation filtre, satıra tıklayınca detay JSON.
- **İstek logu:** HTTP istek logu (method, path, plugin, status, süre).
- **Jobs:** Job istatistikleri ve son job listesi.

Aynı Bearer token (read scope) ile erişilir.

## Plugin Maturity Matrix

### Phase 1 — Core AI Platform (11 plugins ✅)

| Plugin | Status | Auth | MCP Tools | Notes |
|--------|--------|------|-----------|-------|
| llm-router | 🟢 stable | ✅ | ✅ | Multi-provider routing, vLLM support |
| notion | 🟢 stable | ✅ | ✅ | Full DB management, pagination |
| github | 🟢 stable | ✅ | ✅ | Repos, PRs, branches, comments |
| database | 🟢 stable | ✅ | ✅ | SQL + MongoDB, safety controls |
| shell | 🟢 stable | ✅ | ✅ | Allowlist, dangerous pattern blocking |
| rag | 🟢 stable | ✅ | ✅ | OpenAI embeddings, semantic search |
| brain | 🟢 stable | ✅ | ✅ (16) | Memory, habits, FS awareness |
| github-pattern-analyzer | 🟢 stable | ✅ | ✅ | Pattern learning, Redis cache |
| n8n | 🟢 stable | ✅ | ✅ (9) | Workflow CRUD + execute |
| repo-intelligence | 🟢 stable | ✅ | ✅ | Git analysis, AI summaries |
| project-orchestrator | 🟢 stable | ✅ | ✅ | AI planning, Notion, GitHub, Redis |

### Phase 2 — Infrastructure & Tooling (9/9 complete ✅)

| Plugin | Status | Auth | MCP Tools | Notes |
|--------|--------|------|-----------|-------|
| http | 🟢 stable | ✅ | ✅ (3) | SSRF, allowlist, rate limit, cache |
| secrets | 🟢 stable | ✅ | ✅ (4) | `{{secret:NAME}}` ref system |
| workspace | 🟢 stable | ✅ | ✅ (8) | Safe file CRUD, path traversal blocked |
| git | 🟢 stable | ✅ | ✅ (11) | Full git ops, path validation |
| prompt-registry | 🟡 beta | ⚠️ partial | ❌ | Sync I/O, race conditions |
| observability | 🟢 stable | ✅ | ✅ (3) | Aggregate health, Prometheus, error log |
| tech-detector | 🟢 stable | ✅ | ✅ (3) | ~50 tech patterns, path validation |
| n8n-workflows | 🟢 stable | ✅ | ✅ (5) | Cached list, audit, graceful n8n-credentials |
| code-review | 🟢 stable | ✅ | ✅ (4) | Security scan, quality, LLM review, path safety |

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
