# MCP-Hub — Kod Seviyesi Tam Audit

**Kapsam:** `mcp-server/` altındaki gerçek kaynak, testler, CI ve Dockerfile. README/docs hariç tutuldu.  
**Yöntem:** Dosya okuma, `grep`, statik akış izleme; varsayımsız iddia.

---

## Current architecture map (metinsel)

**Startup (HTTP):**
1. `src/index.js` → `validateStartup()` (`src/core/sanity.js` → `runStartupChecks`)
2. `createServer()` (`src/core/server.js`)
3. `import { config } from "./config.js"` — `validateConfig()` (`src/core/config-schema.js`), başarısızsa `process.exit(1)`
4. Middleware sırası: `cors` → `morgan` → `express.json` → `correlationIdMiddleware` → `projectContextMiddleware` → `workspaceContextMiddleware` → `auditMiddleware` → `responseEnvelopeMiddleware` → `policyGuardrailMiddleware`
5. Çekirdek route’lar (health, plugins, openapi, audit, jobs, approvals, `/mcp`) tanımlanır
6. `loadPresetsAtStartup()` (`src/core/policy-guard.js`)
7. `initializeToolHooks()` (`src/core/tool-registry.js` — gövde no-op; `registerBeforeExecutionHook` plugin’lerden)
8. `await loadPlugins(app)` (`src/core/plugins.js`)

**STDIO:** `bin/mcp-hub-stdio.js` → `loadPlugins` + `createMcpServer` + `StdioServerTransport`; HTTP express app sadece plugin `register(app)` için kullanılıyor (satır 124–126).

**Plugin → tool:** `loadPlugins` içinde `registerTool()` (`src/core/tool-registry.js`); her plugin kendi `register(app)` ile router mount eder.

**Tool çağrısı:** `callTool(name, args, context)` → `executeBeforeHooks` → handler → `logToolExecution` (stderr JSON) → `executeAfterHooks`. Policy: `registerBeforeExecutionHook` (`src/plugins/policy/index.js`).

**Job:** `submitJob` (`src/core/jobs.js`) → `setImmediate(runJob)`; Redis varsa `RedisJobStore.enqueue` + `runJob` yine yerel `get(id)` ile okur.

---

# 1) Genel mimari

| Soru | Durum | Kanıt | Çalışma | Eksik / risk |
|------|--------|-------|---------|--------------|
| Entrypoint’ler | ✅ | `src/index.js`, `bin/mcp-hub-stdio.js` | HTTP: listen; STDIO: MCP SDK | CLI başka bin yok (`package.json` `"bin"`) |
| HTTP server | ✅ | `src/core/server.js` `createServer`, `src/index.js` `app.listen` | Express 4 | — |
| STDIO | ✅ | `bin/mcp-hub-stdio.js` | Plugins + gateway | — |
| Bootstrap | ✅ | `server.js` `export async function createServer` | Yukarıdaki sıra | `createServer` async; plugin yükleme **route tanımından sonra** (satır 623–631) |
| Core modüller | ✅ | `src/core/*.js`, `src/core/audit/`, `src/core/jobs.js`, `src/core/workspace*.js` | — | `src/core/tenancy/` sunucuya bağlı değil (aşağıda) |
| Plugin zinciri | ✅ | `src/core/plugins.js` `loadPlugins` | `readdirSync(PLUGINS_DIR)`, `validatePluginMeta`, dynamic `import`, `register(app)`, `registerTool` | n8n ailesi `config.plugins` ile atlanabilir (`plugins.js` satır 45–59) |
| Tool registry | ✅ | `src/core/tool-registry.js` `registerTool`, `callTool` | `Map` tabanlı | — |
| Job bağlantısı | ⚠️ | `src/core/jobs.js`; tek production `registerJobRunner`: `src/plugins/rag-ingestion/index.js` satır 110 | Async ingest | Geniş orchestration yok |
| Policy | ⚠️ | `policyGuardrailMiddleware` (`policy-guard.js`); `getPolicyEvaluator()` yoksa `next()` (satır 104–107) | Sadece POST/PUT/PATCH/DELETE | GET write yok sayılır |
| Audit | ✅ | `auditMiddleware` (`audit.js`); `AuditManager` (`audit/audit.manager.js`) | Ring buffer + opsiyonel dosya | İki ayrı audit kanalı (HTTP ring vs plugin audit) |
| Auth | ✅ | `src/core/auth.js` `requireScope`, `src/core/server.js` route’larda | Bearer / `x-hub-api-key` | Key yoksa open mode (`auth.js` satır 63–64) |
| Observability | ⚠️ | `src/plugins/observability/index.js` `/observability/metrics`; `src/core/metrics.js`, `observability/*.js` | Prometheus format route var | Tool çağrısı için `registerAfterExecutionHook` **hiçbir yerde kayıtlı değil** (`grep registerAfterExecutionHook` sadece `tool-hooks.js` tanımı) |

**Akış (özet):**  
`index.js` → `config` (Zod) → `createServer` → middleware → çekirdek route’lar → `loadPresetsAtStartup` → `initializeToolHooks` (no-op) → `loadPlugins` → 404 → global error handler.

---

# 2) Plugin sistemi

| Özellik | Durum | Kanıt |
|---------|--------|-------|
| Discovery | ✅ | `plugins.js` `readdirSync(PLUGINS_DIR)` |
| `plugin.meta.json` zorunlu mu | ❌ (kısmi enforce) | `plugin-meta.js` `validatePluginMeta`: dosya yoksa `valid: true`, `warnings`, `createDefaultMeta` |
| `register(app)` | ✅ | `plugins.js` `await plugin.register(app)` |
| `registerTool` | ✅ | `plugins.js` `registerTool({ ...tool, plugin })` |
| Lifecycle hook (core) | ⚠️ | Sadece `tool-hooks.js` pattern; plugin başına unload yok |
| Enable/disable runtime | ⚠️ | `plugins.js` sadece env ile n8n* klasörleri skip; `marketplace` kendi `enable` endpoint’ini idare eder (`marketplace/index.js`) ama `loadPlugins` bunu okumaz |
| Versiyonlama | ⚠️ | `manifest.version` plugin export / meta; çekirdek semver enforce yok (sadece meta varsa regex) |
| Plugin dependency resolution | ❌ | `plugins.js` içinde yok |
| Capability tagging | ⚠️ | `plugin-meta.js` + manifest `capabilities`; runtime enforcement yok |
| Sandbox / isolation | ❌ | Aynı Node süreci; `src/core/sandbox.js` var ama plugin sandbox değil |
| Plugin permissions model | ⚠️ | `workspace.js` `isPluginAllowed` + `workspace-permissions.js`; sadece workspace entity’si varsa ve çağıran kod kontrol ederse |
| Plugin başına config schema | ❌ | Çekirdek tek `ConfigSchema`; plugin özel env validate yok |
| Healthcheck | ⚠️ | Birçok plugin `router.get("/health", ...)`, standart zorunlu değil |

**“Core gibi” davrananlar:** `src/core/*`, `policy` (hook kaydı), `observability` (metrics route).  
**REST-only / MCP tools=0 (kod sayımı):** `docker`, `file-storage`, `marketplace`, `n8n-credentials`, `openapi`, `projects`, `retrieval-evals`, `slack` — `export const tools` yok; MCP listesinde görünmezler.

**Deprecated / legacy:** `src/core/legacy/registry/`, `src/core/legacy/tools/` — `legacy/README.md`: startup’ta kullanılmıyor; `registry.test.js`, `tools.test.js` bağlı.

---

# 3) Tool registry ve discovery

| Özellik | Durum | Kanıt |
|---------|--------|-------|
| Merkezi registry | ✅ | `tool-registry.js` `const tools = new Map()` |
| Metadata | ✅ | `name`, `description`, `inputSchema`, `plugin`, `tags` saklanır (`registerTool` satır 155–162) |
| Argüman şeması validate | ❌ | `validateTool` sadece şema **varlığı**; `callTool` args’ı JSON Schema ile doğrulamaz |
| Discovery API | ⚠️ | `listTools()`, `GET /plugins` manifest `tools`; ayrı search endpoint yok |
| Filtre / tag | ⚠️ | `listToolsByTags` (`tool-registry.js`); MCP `ListTools` tümünü döner (`gateway.js` `listTools()`) |
| Semantic selection / ranking | ❌ | Kodda yok |
| Tool permission boundary | ⚠️ | Policy `registerBeforeExecutionHook` (`policy/index.js` satır 174); workspace tool visibility yok |
| Tenant/workspace görünürlüğü | ❌ | `listTools` filtrelemez |
| Tool invocation audit | ⚠️ | `logToolExecution` → `console.error` JSON (`tool-registry.js` satır 393–401); `executeAfterHooks` boş |
| Timeout / retry / circuit breaker | ❌ | `callTool` içinde timeout yok; circuit breaker yok |

**Security theater uyarısı:** `inputSchema.properties` uyarısı var, runtime validation yok — LLM/trusted client dışında zayıf sözleşme.

---

# 4) Job / queue / orchestration

| Özellik | Durum | Kanıt |
|---------|--------|-------|
| Job modeli | ✅ | `jobs.js` `submitJob` → `job` objesi `state`, `payload`, `context` |
| States | ✅ | `JobState` (`jobs.js` satır 51–60): queued, running, completed/done, failed, cancelled |
| Persistence | ⚠️ | Bellek Map; `REDIS_URL` varsa `RedisJobStore` (`jobs.redis.js`) — `enqueue`/`markCompleted` |
| Retry | ❌ | `jobs.js` / `jobs.redis.js` içinde retry döngüsü yok |
| DLQ | ❌ | Ayrı dead-letter queue yok |
| Scheduling | ❌ | Zamanlayıcı yok |
| Cancellation | ✅ | `cancelJob` (`jobs.js` satır 290) |
| Concurrency control | ❌ | `setImmediate(runJob)` başına job; global worker limit yok |
| Idempotency | ❌ | Job submit idempotency key yok |
| Multi-step workflow | ❌ | Sadece tek runner çağrısı |
| Job telemetry | ⚠️ | `observability/jobs.metrics.js` registry increment — `jobs.js` ile entegrasyon grep ile sınırlı |
| Job auth / workspace | ⚠️ | `submitJob` context `workspaceId` (`jobs.js` 107–112); `POST /jobs` `req.workspaceId` (`server.js` 337–341) |

**Gerçek kullanım:** `registerJobRunner("rag.ingestion", ...)` yalnızca `rag-ingestion/index.js`. Başka plugin job runner kaydetmiyor (`grep registerJobRunner`).

**Redis vs yürütme:** `submitJob` her durumda `setImmediate(() => runJob(id))` (satır 151–152); Redis öncelikle durum/storage için; ayrı worker process消费 pattern’i yok.

---

# 5) Multi-tenancy / workspace isolation

**Kavramlar (kod):**
- `Workspace`, `Project`, `Conversation` — `src/core/workspace.js` (in-memory `Map`)
- `x-workspace-id`, `x-project-id` — `workspaceContextMiddleware` (`workspace.js` satır 298–328)
- `workspace-paths.js` — fiziksel path sınırı
- `TenantRegistry` — `src/core/tenancy/tenant.registry.js` (**sadece `tenancy.test.js` import ediyor**; `server.js` / `plugins.js` import yok)

| Katman | Durum | Kanıt |
|--------|--------|-------|
| Identity present | ⚠️ | API key scopes (`auth.js`); tenant id yok |
| Context propagated | ✅ | `req.workspaceId`, MCP `gateway.js` `workspaceId` from `authInfo` / `HUB_WORKSPACE_ID` |
| Authorization enforced | ⚠️ | `canModifyIndex` / `canReadWorkspace` sadece seçili pluginlerde; `canRunTool` **production plugin kodunda kullanılmıyor** (`grep` sadece test) |
| Storage isolated | ⚠️ | `getWorkspaceRoot(workspaceId)` (`workspace-paths.js`) — fs izolasyonu path ile; RAG memory store workspace bağlı mı plugin’e bağlı |

| Soru | Sonuç |
|------|--------|
| Plugin visibility tenant bazlı | ❌ | `listTools` filtre yok |
| Tool visibility | ❌ | Aynı |
| Job tenant split | ⚠️ | `context.workspaceId` alanı var; runner içi enforce plugin’e bağlı |
| Config tenant bazlı | ❌ | Tek global `config` |
| Policy tenant bazlı | ❌ | `evaluate(method, path, body, requestedBy)` — tenant parametresi yok (`policy` plugin) |
| Audit tenant bazlı | ⚠️ | `auditLog` `workspaceId` alanı destekler (`audit.manager.js` `log`); HTTP ring buffer plugin inference `inferPlugin` path regex (`audit.js` satır 42–44) — tenant zorunlu değil |
| Cross-tenant engel | ⚠️ | `checkCrossWorkspaceAccess` (`workspace-permissions.js`) — çağıran az sayıda yerde |

**Risk:** Çoğu tool çağrısında workspace sadece **parametre**; merkezi “her tool öncesi workspace authorization” yok.

---

# 6) Auth / security / policy

| Konu | Durum | Kanıt |
|------|--------|-------|
| Authentication | ⚠️ | Bearer key → scope (`auth.js`); key yoksa `requireScope` geçer |
| Authorization | ⚠️ | Scope read/write/admin; resource-level RBAC yok |
| Policy engine | ⚠️ | `policy.plugin` `evaluate`; REST: write-only middleware; tools: before-hook |
| Tool-level yetki | ⚠️ | Policy hook + `ToolTags`; approval store |
| Plugin-level yetki | ❌ | Yok |
| Workspace erişim | ⚠️ | Bölüm 5 |
| Shell guardrail | ✅ | `shell/index.js` `ALLOWED_COMMANDS`, `DANGEROUS_PATTERNS`, timeout |
| SSRF (HTTP plugin) | ✅ | `http/security.js` `validateUrlSafety`, `isBlockedHost` |
| Path traversal | ⚠️ | `workspace-paths.js`, `git/core`, vb. — tüm pluginlerde tek tip değil |
| Secrets | ⚠️ | `secrets` plugin; `tool-registry` log `parameters: args` (mask yok, `logToolExecution`) |
| Rate limit | ⚠️ | HTTP plugin config `rateLimitRpm`; policy `policy_rate_limit` action |
| Input sanitization | ⚠️ | Plugin bazlı Zod / regex; global yok |
| Audit policy violation | ⚠️ | Block cevapları middleware’den; tool block policy sonucu hook’ta |

**Security theater:** `policyGuardrailMiddleware` `getPolicyEvaluator()` null ise **sessizce** `next()` (`policy-guard.js` 104–107). Policy plugin yüklenmezse REST write koruması yok.

---

# 7) Observability

| Özellik | Durum | Kanıt |
|---------|--------|-------|
| Metrics | ✅ | `src/core/metrics.js` `MetricsRegistry`; `observability` plugin `/observability/metrics` |
| Correlation | ⚠️ | `correlationIdMiddleware` + `auditMiddleware` her ikisi de `req.requestId` yazar — çift kaynak (`server.js` sıra) |
| Structured logging | ⚠️ | `morgan`, `console.error` pattern; tek logger standardı yok |
| Plugin telemetry | ⚠️ | Audit / metrics yardımcıları; zorunlu değil |
| Tool telemetry | ❌ | After-hook kayıt yok |
| Job telemetry | ⚠️ | `jobs.metrics.js` registry — `jobs.js` doğrudan çağrı grep sınırlı |
| Error classification | ⚠️ | `error-categories.js` var (dosya mevcut); tüm handler’larda kullanım tek tip değil |
| Health | ✅ | `/health` `server.js` satır 198 |
| Readiness/liveness | ❌ | Tek endpoint; ayrım yok |
| Prometheus export | ✅ | `observability/index.js` router `GET /metrics` → text format (dosya satır 162+) |
| Dashboard | ⚠️ | Static HTML under observability plugin |

**Canlı akış:** Request audit ring + opsiyonel dosya; tool stderr JSON; metrics endpoint okuma ile.

---

# 8) Audit ve compliance readiness

| Özellik | Durum | Kanıt |
|---------|--------|-------|
| Audit modeli | ✅ | `audit.standard.js` validation; `AuditManager` `emit` / `log` |
| Kim/ne zaman/tool | ⚠️ | `tool-registry.js` `logToolExecution` — parametreler maskelenmeden JSON; actor `context.user` |
| Request/response metadata | ⚠️ | `audit.js` middleware özet; tam body response yok |
| Policy decision audit | ⚠️ | Policy plugin kendi akışı; merkezi “policy_decision” tablosu yok |
| Immutable / append-only | ❌ | Memory ring, rotate; file sink append ama compliance tasarımı yok |
| PII / secret masking | ⚠️ | `audit.js` `maskBody`; `logToolExecution` mask yok |
| Enterprise eksikleri | | WORM storage, merkezi SIEM entegrasyonu, tenant-scoped retention, imzalı audit |

---

# 9) API surface

**Middleware zinciri:** Bölüm 1.

**Route grupları (çoğu `server.js`):**

| Grup | Örnek path | Scope |
|------|------------|-------|
| Public/anon | `GET /health`, `GET/POST` landing, `GET /ui`, `GET /admin`, `POST /ui/token` (localhost check) | — |
| Read | `/plugins`, `/openapi.json`, `/audit/*`, `/jobs`, `/approvals/pending`, `/whoami` | `requireScope("read")` |
| Write | `/jobs` POST, `/approve` POST | write |
| MCP | `ALL /mcp` | `createMcpHttpMiddleware` auth |
| Plugin | Her plugin `register(app)` ile `/shell`, `/notion`, … | plugin içi `requireScope` |

**Versioning:** URL path’te `/v1` yok (`grep` yok).

**OpenAPI:** `GET /openapi.json` plugin manifest’ten üretim (`server.js` ~230–302).

**Error envelope:** `responseEnvelopeMiddleware` (`server.js` 52–93); `AppError.serialize` (`errors.js`).

**Validation tutarlılığı:** Core’da tek tip yok; plugin’ler Zod veya manuel.

---

# 10) Config ve deployment

| Konu | Durum | Kanıt |
|------|--------|-------|
| Config loading | ✅ | `config.js` `dotenv/config` + `validateConfig` |
| Env validation | ✅ | `config-schema.js` Zod; fail → exit |
| Default güvenlik | ⚠️ | Auth key’ler schema’da zorunlu **ama** `auth.js` runtime’da key yoksa open; çelişkili model |
| Docker | ✅ | `mcp-server/Dockerfile` multi-stage, non-root, HEALTHCHECK `GET /health` |
| Compose | ❌ | Repo kökünde `docker-compose*.yml` yok (glob 0) |
| Local vs prod | ⚠️ | `NODE_ENV`, `REQUIRE_PROJECT_HEADERS` (`server.js` projectContextMiddleware) |
| Migration/bootstrap komutları | ❌ | Özel migrate komutu yok (`package.json` scripts) |
| CI | ✅ | `.github/workflows/ci.yml` pnpm install, lint, `vitest run`, coverage |

**Open source release readiness:** Lisans MIT (`package.json`); CI var; compose eksik; config için zorunlu secret set gerekli.

**Self-hosted SaaS readiness:** Tenant registry kullanılmıyor; multi-tenant auth/isolation zayıf; horizontal job worker yok.

---

# 11) Kod kalitesi ve maintainability

| Konu | Gözlem | Kanıt |
|------|--------|-------|
| Modülerlik | İyi ayrılmış core/plugin | `src/core/` vs `src/plugins/` |
| Circular dependency risk | policy dinamik import `tool-registry.js` (`policy/index.js` 204) | bilinçli kaçınma |
| Büyük dosyalar | `llm-router/index.js`, `project-orchestrator/index.js`, `shell/index.js`, `brain/index.js` yüzlerce satır | dosya boyutları |
| Dead code | `initializeToolHooks` no-op | `tool-registry.js` 384–387 |
| Deprecated | `src/core/legacy/` | legacy README |
| Duplicate | İki audit yolu (`audit.js` vs `audit/`) | iki modül |
| Error handling | Karışık envelope + legacy | `responseEnvelopeMiddleware` |
| Testler | vitest + coverage threshold | `vitest.config.js` |
| Mock utilities | policy tests `vi.mock` | çeşitli testler |

### High risk refactor zones

1. **Tek tool execution güvenlik borusu:** `callTool` + policy hook + eksik schema validation + stderr audit.
2. **İki workspace modeli:** `workspace.js` entity Map vs `tenant.registry` kullanılmıyor — gelecekte birleştirme riski.
3. **Job sistemi:** Redis kuyruk ile yerel `setImmediate` birleşimi; ölçekleme belirsiz.
4. **Policy optional:** Evaluator yoksa REST write açık.

---

# 12) Plugin bazlı tablo

Amaç / risk / tenant / observability özet; **tool sayıları** `index.js` içindeki `export const tools` bloklarından otomatik sayım (script); REST-only olanlar **0 tool**.

| Plugin | Amaç | status.meta | Entry | Tools | Ext. dep (tipik) | Auth | Risk | Tenant-aware | Observability | Notlar |
|--------|------|-------------|-------|-------|------------------|------|------|--------------|---------------|--------|
| brain | Bellek / context | metadata export | index.js | 20 | Opsiyonel store | requireScope | high | partial (context) | audit calls | Büyük yüzey |
| code-review | statik/LLM review | metadata | index.js | 4 | — | requireScope | med | partial | audit | — |
| database | SQL/Mongo tools | metadata | index.js | 5 | DB URI | requireScope | high | partial | audit | — |
| docker | konteyner API | plain name | index.js | 0 | DOCKER_HOST | requireScope routes | high | hayır | hayır | REST only |
| email | e-posta | | index.js | 3 | SMTP | | med | hayır | | |
| example-sdk | örnek | | index.js | 3 | — | | low | hayır | | |
| file-storage | S3/GDrive/local | metadata | index.js | 0 | keys path | requireScope | high | metadata claim | adapter audit | MCP yok |
| file-watcher | dosya izleme | | index.js | 4 | — | | med | hayır | | |
| git | git CLI | | index.js | 11 | git | | high | path validate | | |
| github | GitHub API | plugin.meta | index.js | 8 | token | | med-high | hayır | | |
| github-pattern-analyzer | pattern | | index.js | 2 | redis/llm | | med | hayır | | |
| http | outbound HTTP | | index.js | 3 | — | | high | SSRF guard | audit | |
| image-gen | görüntü | | index.js | 4 | API keys | | med | hayır | | |
| llm-router | LLM | plugin.meta | index.js | 8 | providers | | med | audit manager | | |
| local-sidecar | yerel köprü | | index.js | 5 | — | | med | hayır | | |
| marketplace | npm install | | index.js | 0 | npm | requireScope | **yüksek** (`exec`) | hayır | hayır | REST only; `exec` |
| n8n | workflow | plugin.meta | index.js | 9 | n8n | | med | hayır | | |
| n8n-credentials | cred metadata | | index.js | 0 | n8n | | low | hayır | | REST only |
| n8n-workflows | workflow disk | | index.js | 5 | n8n | | med | hayır | | |
| notifications | bildirim | | index.js | 5 | çeşitli | | med | hayır | | |
| notion | Notion API | plugin.meta | index.js | 19 | notion | | med | hayır | | |
| observability | metrics/health | | index.js | 5 | — | | low | hayır | kendi metrics | |
| openapi | spec analiz | | index.js | 0 | — | | low | hayır | | REST only |
| policy | kurallar/onay | | index.js | 5 | — | | med | hayır | hooks | Hook kritik |
| project-orchestrator | planlama | | index.js | 14 | redis/notion/gh | | high | partial | | |
| projects | proje registry | | index.js | 0 | — | | med | config scope | | REST only |
| prompt-registry | prompt CRUD | | index.js | 10 | — | | low | hayır | | |
| rag | arama/index | | index.js | 6 | openai | | med | **canModifyIndex** | audit | |
| rag-ingestion | pipeline | plugin.meta beta | index.js | 5 | pdf/tesseract | | med | **canModifyIndex** + jobs | audit | Tek job runner |
| repo-intelligence | yerel repo | | index.js | 6 | — | | med | path guard | | |
| retrieval-evals | benchmark | metadata beta | index.js | 0 | — | | low | partial | metrics-store | REST only |
| secrets | secret ref | | index.js | 6 | store | | high | workspace path | | |
| shell | komut | plugin.meta | index.js | 7 | OS | | **critical** | allowlist | audit | |
| slack | Slack API | | index.js | 0 | SLACK_BOT | | med | hayır | | REST only |
| tech-detector | stack tespit | | index.js | 3 | — | | low | path guard | | |
| tests | internal | | index.js | 3 | — | | low | hayır | | meta “tests” |
| video-gen | video | | index.js | 5 | API | | med | hayır | | |
| workspace | dosya CRUD | | index.js | 8 | WORKSPACE_ROOT | | med | **path** | audit | |

---

# 13) Gerçek eksik listesi

## Confirmed missing (kodda yok)

- Tool çağrısında JSON Schema ile argüman doğrulama (`callTool`).
- `registerAfterExecutionHook` kullanımı (metrics/audit için merkezi after pipeline).
- Job retry, scheduler, idempotency key, DLQ.
- URL API versioning (`/v1/...`).
- Readiness vs liveness ayrımı.
- `docker-compose` dosyası (repo taraması).
- **Production’da** `TenantRegistry` entegrasyonu (import kullanımı yok).
- Tenant/workspace bazlı MCP `listTools` filtrelemesi.
- Global tool invocation timeout / circuit breaker.

## Partial / superficial

- `plugin.meta.json` — eksik dosyada yükleme engeli yok (`plugin-meta.js`).
- Workspace permissions — `canRunTool` sadece testte; RAG’de `canModifyIndex`.
- Policy REST — evaluator yoksa bypass (`policy-guard.js`).
- OAuth / kullanıcı kimliği — sadece API key + UI token (`auth.js`, `ui-tokens.js`).
- Redis jobs — persist var, worker modeli dağınık.
- `logToolExecution` — “audit” iddiası; stderr’e tam args.

## Strong / production-leaning areas

- Shell allowlist + dangerous patterns (`shell/index.js`).
- HTTP outbound SSRF kontrolleri (`http/security.js`).
- Workspace path canonicalization (`workspace-paths.js`).
- Plugin yükleme + MCP gateway (`plugins.js`, `gateway.js`).
- CI pipeline (lint + test + coverage) `.github/workflows/ci.yml`.
- Dockerfile non-root + HEALTHCHECK.

## Top 10 next priorities (teknik)

1. `callTool` öncesi/sonrası: schema validate + argüman masking audit.
2. Policy evaluator yoksa REST için fail-closed veya açık “dev mode” bayrağı.
3. `TenantRegistry` ya silinmeli ya `workspace` ile birleştirilmeli — şu an ölü kod.
4. `registerAfterExecutionHook` ile metrics/audit standardizasyonu.
5. Job worker modeli: Redis dequeue + concurrency limit + retry politikası.
6. MCP `listTools` için opsiyonel workspace/policy filtresi (gerçek multi-tenant).
7. `logToolExecution` stderr yerine AuditManager veya güvenli sink.
8. `openapi`/`docker`/… için MCP tool export veya “REST-only” manifest alanı (keşfedilebilirlik).
9. `marketplace` `exec` yüzeyi güvenlik gözden geçirmesi.
10. İki `requestId` middleware birleştirmesi (`correlationIdMiddleware` vs `auditMiddleware`).

---

## Executive summary (1 sayfa)

MCP-Hub tek Node sürecinde **Express tabanlı HTTP** ve **MCP (HTTP + STDIO)** sunan, **klasör taramalı plugin yükleyici** (`plugins.js`) ve **merkezi `Map` tool registry** ile çalışır. **Başlıca güçlü yanlar:** shell ve HTTP plugin’lerinde somut güvenlik kontrolleri, workspace path yardımcıları, policy plugin’in tool hook ile çalışması, audit altyapısı (AuditManager + HTTP ring buffer), gözlemlenebilirlik plugin’inde Prometheus metrik endpoint’i, CI ve Dockerfile. **Zayıf / eksik yanlar:** tool argümanları için **runtime schema validation yok**; **tenant registry üretimde kullanılmıyor**; workspace yetkisi **çoğunlukla birkaç pluginde** (ör. `canModifyIndex`) ve `canRunTool` **yalnızca testte**; policy REST katmanında evaluator yoksa **write istekleri filtrelenmeden geçer**; job kuyruğu pratikte **rag-ingestion** ile sınırlı ve Redis ile **tam worker ayrımı yok**; MCP araç listesi **tenant’a göre kısıtlanmaz**; tool audit’i **stderr + maskesiz args** riski taşır. **Sonuç:** Dağıtılmış ajan aracı olarak çekirdek sağlam bir iskelete sahip; **enterprise multi-tenant SaaS** veya **yüksek güvenlik compliance** için authorization birleştirme, tool sözleşmesi enforce’u ve audit sertleştirmesi gerekiyor.
