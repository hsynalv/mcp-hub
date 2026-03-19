# Kod Tabanlı Audit Raporu

**Tarih:** 2025-03-17  
**Yöntem:** Doğrudan kaynak kod incelemesi (raporlara değil)  
**Kapsam:** Core, MCP, plugins, config, testler

---

## 1. Mimari Özet

### Giriş Noktaları
| Dosya | Rol |
|-------|-----|
| `src/index.js` | Ana giriş; sanity check → createServer → listen |
| `src/core/server.js` | Express app, middleware zinciri, route montajı |
| `bin/mcp-hub-stdio.js` | STDIO transport CLI; `--workspace-id`, `--project-id`, `HUB_*` env |

### Plugin Yükleme
- **Canonical loader:** `src/core/plugins.js` → `loadPlugins(app)`
- `server.js` satır 631: `loadPlugins(app)` — registry kullanılmıyor
- Her plugin: `plugin.meta.json` validasyonu → `register(app)` → `registerTool()` ile MCP araçları

### Deprecated / Legacy
| Yol | Durum | Kullanım |
|-----|-------|----------|
| `src/core/legacy/registry/` | @deprecated | Sadece `registry.test.js` |
| `src/core/legacy/tools/tool.discovery.js` | @deprecated | Sadece `tools.test.js` |
| `src/core/legacy/tools/tool.registry.js` | @deprecated | tool.discovery tarafından |
| `legacy/README.md` | Açıklama | Canonical path: plugins.js, tool-registry.js |

---

## 2. Workspace & Context

### workspace.js (satır 298–328)
- `workspaceContextMiddleware`: `x-workspace-id` **doğrudan** `req.workspaceId` yapıyor (satır 305–308)
- `x-project-id` → `resolveWorkspaceContext()` → `req.workspaceId`
- Fallback: `req.workspaceId = "global"`

### MCP Gateway (gateway.js satır 46–55)
```javascript
const context = {
  workspaceId: authInfo.workspaceId ?? process.env.HUB_WORKSPACE_ID ?? null,
  projectId: authInfo.projectId ?? process.env.HUB_PROJECT_ID ?? null,
  env: authInfo.env ?? process.env.HUB_ENV ?? null,
};
```
- HTTP: `authInfo` middleware’den geliyor (`req.workspaceId`, `req.projectId`)
- STDIO: `authInfo` boş → `process.env.HUB_*` kullanılıyor

### mcp-hub-stdio.js
- `--workspace-id` ve `HUB_WORKSPACE_ID` destekleniyor (satır 49–50, 63–65)
- Başlangıçta `process.env.HUB_WORKSPACE_ID` set ediliyor (satır 119)

### Test
- `tests/mcp/stdio-workspace-context.test.js`: STDIO env fallback test ediliyor

---

## 3. Jobs Sistemi

### jobs.js
- `submitJob(type, payload, context)` → `jobContext`: `workspaceId`, `projectId`, `userId`, `env`
- `workspaceId` fallback: `context.workspaceId ?? "global"`
- `registerJobRunner(type, handler)` — handler `(payload, context, updateProgress, log)` alıyor

### rag-ingestion
- `registerJobRunner("rag.ingestion", ...)` (satır 110–122)
- `execCtx.workspaceId = context.workspaceId ?? payloadCtx?.workspaceId ?? "global"`
- `submitJob(..., { workspaceId: ctx.workspaceId, ... })` (satır 373–376)

---

## 4. Workspace Path Güvenliği

### workspace-paths.js
- `validateWorkspacePath`, `getWorkspaceRoot`, `resolveWorkspacePath`, `requireWorkspaceId`, `sanitizeWorkspaceId`, `canAccessWorkspace`, `validatePathWithinBase`
- `WORKSPACE_STRICT_BOUNDARIES`, `WORKSPACE_REQUIRE_ID` env ile kontrol

### workspace-permissions.js
- `canReadWorkspace`, `canWriteWorkspace`, `canRunTool`, `canModifyIndex`, `checkCrossWorkspaceAccess`

### Kullanan pluginler
- workspace, repo-intelligence, tech-detector, rag-ingestion, rag

---

## 5. OCR

### ocr/index.js
- `getOcrProvider(name)` → `RAG_OCR_PROVIDER` env veya `name`
- `registerOcrProvider(name, instance)`, `listOcrProviders()`

### Tesseract
- `tesseract.provider.js`: `TesseractOcrProvider` sınıfı
- `rag-ingestion/index.js` satır 346–353: `RAG_OCR_PROVIDER=tesseract` ise register ediliyor
- pdf.loader: boş metin → `getOcrProvider()` → OCR çağrısı

---

## 6. Config & Auth

### config-schema.js (Zod)
- **Zorunlu:** `HUB_READ_KEY`, `HUB_WRITE_KEY`, `HUB_ADMIN_KEY`, `NOTION_API_KEY` (min 1)
- **Opsiyonel:** n8n.apiKey, database.*, sentry.dsn, vb.
- `validateConfig` fail → `process.exit(1)`

### auth.js
- `requireScope("read"|"write"|"admin")` — key yoksa open mode
- Scope hiyerarşisi: read < write < admin (danger → admin alias)
- UI token: 6 haneli kısa ömürlü token, admin scope

---

## 7. Middleware Zinciri (server.js)

Sıra:
1. cors, morgan, express.json
2. correlationIdMiddleware (x-correlation-id)
3. projectContextMiddleware (x-project-id, x-env)
4. workspaceContextMiddleware (x-workspace-id, x-project-id)
5. auditMiddleware
6. responseEnvelopeMiddleware (ok/data/meta normalizasyonu)
7. policyGuardrailMiddleware

---

## 8. MCP HTTP Transport

### http-transport.js
- `req.workspaceId`, `req.projectId` → `authInfo` → `clientTransport.send(message, { authInfo })`
- MCP SDK InMemoryTransport; gateway `extra.authInfo` alıyor

### Gateway
- `CallToolRequestSchema` handler: `extra?.authInfo` → context
- STDIO: authInfo yok → `process.env.HUB_WORKSPACE_ID` vb.

---

## 9. Test Kapsamı

| Kategori | Örnek testler |
|----------|----------------|
| Core | workspace-security, workspace-middleware-context, tool-registry |
| MCP | workspace-context, stdio-workspace-context, integration, security |
| Jobs | workspace-context, jobs-api |
| Plugins | 40+ plugin testi (shell, notion, github, rag-ingestion, ocr, vb.) |
| Contract | notion, github, llm-router |

---

## 10. Tespit Edilen Durumlar

### Doğru Çalışanlar
- Workspace middleware `x-workspace-id` ile `req.workspaceId` set ediyor
- STDIO `HUB_WORKSPACE_ID` ile workspace context alıyor
- Gateway `authInfo.workspaceId ?? process.env.HUB_WORKSPACE_ID` fallback kullanıyor
- Tesseract OCR `RAG_OCR_PROVIDER=tesseract` ile register ediliyor
- Job context `workspaceId` taşıyor
- Plugin loader sadece `plugins.js` kullanıyor

### Dikkat Edilmesi Gerekenler
1. **Config:** `NOTION_API_KEY` schema’da zorunlu; README’de opsiyonel denebilir — minimal setup için çatışma olabilir.
2. **Legacy kod:** `legacy/registry`, `legacy/tools` sadece testler için duruyor; silinirse testler güncellenmeli.
3. **Tool parameters:** `parameters` → `inputSchema` mapping deprecated uyarısı veriyor.

### Eksik / Belirsiz
- `HUB_WORKSPACE_ID` STDIO için dokümante edilmiş mi kontrol edilmeli
- Job workspace context’in `workspace-security-model.md` veya benzeri dokümanda açıklanıp açıklanmadığı

---

## 11. Özet Tablo

| Alan | Kod Durumu | Not |
|-----|------------|-----|
| Workspace middleware | ✅ | x-workspace-id → req.workspaceId |
| STDIO workspace | ✅ | HUB_WORKSPACE_ID, --workspace-id |
| Job context | ✅ | workspaceId taşınıyor |
| Plugin loader | ✅ | plugins.js canonical |
| OCR | ✅ | Tesseract + RAG_OCR_PROVIDER |
| Legacy | ⚠️ | Deprecated, sadece testlerde |
| Config | ⚠️ | NOTION_API_KEY zorunlu |
