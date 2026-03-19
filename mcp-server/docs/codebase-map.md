# MCP-Hub Codebase Map

Kök: **`mcp-server/`** (asıl uygulama). Repo kökünde ek olarak `docs/`, `.github/workflows/` vardır.

---

## Özet ağaç (mantıksal gruplar)

```
mcp-server/
├── package.json              # scripts, dependencies, bin entry
├── vitest.config.js          # test glob + coverage eşikleri
├── Dockerfile                # production image
├── bin/
│   ├── mcp-hub-stdio.js      # MCP STDIO girişi
│   ├── mcp-cli.js            # CLI yardımcısı
│   ├── create-plugin.js      # plugin şablonu
│   └── run-retrieval-evals.js
├── src/
│   ├── index.js              # HTTP sunucu bootstrap
│   ├── mcp/                  # MCP gateway + transport
│   ├── core/                 # sunucu, auth, jobs, registry, …
│   ├── plugins/              # tüm feature plugin’leri (~1 klasör = 1 plugin)
│   └── public/               # /ui, /admin, landing static
└── tests/                    # vitest; contract + plugin + core
```

---

## 1) Entry points

| Dosya | Rol |
|--------|-----|
| **`src/index.js`** | `validateStartup()` sonrası `createServer()` ve `listen`; süreç girişi. |
| **`bin/mcp-hub-stdio.js`** | Cursor/Claude tarzı STDIO MCP: env/CLI context, `loadPlugins`, `createMcpServer`, SDK transport. |
| **`src/core/server.js`** | Express uygulaması: middleware, çekirdek route’lar, `loadPlugins`, 404/error handler. |
| **`src/mcp/http-transport.js`** | `/mcp` HTTP köprüsü: auth, `authInfo` → gateway. |
| **`src/mcp/gateway.js`** | MCP `listTools` / `callTool`; HTTP + STDIO için ortak sunucu mantığı. |
| **`bin/mcp-cli.js`**, **`bin/create-plugin.js`**, **`bin/run-retrieval-evals.js`** | Operasyon / iskelet / eval yardımcıları; ana HTTP loop değil. |

---

## 2) Core modules (çekirdek)

| Dosya / klasör | Rol |
|----------------|-----|
| **`src/core/server.js`** | Tüm HTTP yüzeyi ve middleware sırasının kalbi. |
| **`src/core/plugins.js`** | `src/plugins/*` tarama, `plugin.meta.json` doğrulama, `register(app)`, `registerTool`. |
| **`src/core/plugin-meta.js`** | Meta şema; eksik `.json` → varsayılan (yüklemeyi durdurmaz). |
| **`src/core/tool-registry.js`** | MCP araçları `Map`; `registerTool`, `callTool`, hook’lar, stderr audit satırı. |
| **`src/core/tool-hooks.js`** | `before`/`after` execution hook listeleri. |
| **`src/core/openapi-generator.js`** | `/openapi.json` için manifest’ten path üretimi (`server.js` içinden). |
| **`src/core/errors.js`**, **`error-standard.js`**, **`error-categories.js`** | HTTP/App hata tipleri ve plugin hata yardımcıları. |
| **`src/core/workspace.js`** | Workspace/project/conversation modelleri (bellek), `workspaceContextMiddleware`. |
| **`src/core/workspace-paths.js`** | Güvenli path çözümleme, workspace kökü, traversal kontrolleri. |
| **`src/core/workspace-permissions.js`** | `canReadWorkspace`, `canModifyIndex`, `canRunTool` (çağrı çoğu pluginde sınırlı). |
| **`src/core/sanity.js`** | Boot sanity (Node sürümü, opsiyonel uyarılar). |
| **`src/core/validate.js`** | Genel body doğrulama yardımcıları. |
| **`src/core/policy/index.js`**, **`policy-guard.js`**, **`policy-hooks.js`**, **`policy/**`** | Çekirdek policy yardımcıları + guardrail middleware bağlantı noktası. |
| **`src/core/health/**`** | Aggregate health tipleri/servis (observability plugin bunu kullanır). |
| **`src/core/metrics.js`** | Genel sayaç/gauge (bazı alt sistemlerle ilişkili). |
| **`src/core/cache.js`**, **`redis.js`**, **`resilience.js`**, **`security-guard.js`**, **`sandbox.js`** | Entegrasyon / yardımcı; sandbox isimli modül tam VM izolasyonu değil. |
| **`src/core/plugin-sdk/**`** | `registerTool` sarmalayıcı, audit/metrics yardımcıları (isteğe bağlı kullanım). |
| **`src/core/plugins/**`** | Plugin contract, validation, status enum’ları, iç testler. |
| **`src/core/tenancy/**`** | Tenant registry **abstraksiyonu**; prod sunucu bootstrap’ında doğrudan bağlı değil. |

---

## 3) Auth

| Dosya | Rol |
|--------|-----|
| **`src/core/auth.js`** | `requireScope(read|write|admin)`, API key map, UI token (`ui-tokens` ile), OAuth introspection opsiyonel. |
| **`src/core/ui-tokens.js`** | Kısa ömürlü UI oturum token’ı (localhost `POST /ui/token`). |

---

## 4) Policy

| Dosya | Rol |
|--------|-----|
| **`src/core/policy-guard.js`** | REST yazma istekleri için rule evaluate; evaluator yoksa **geçiş**. |
| **`src/core/policy-hooks.js`** | Policy plugin’in `evaluate` / approval store’unu çekirdeğe enjekte eden köprü. |
| **`src/plugins/policy/index.js`** | Hook kaydı, rule API, `registerBeforeExecutionHook` ile **tool** policy/onay. |
| **`src/plugins/policy/presets.json`** | Startup’ta yüklenen varsayılan kurallar (`loadPresetsAtStartup`). |

---

## 5) Audit

| Dosya | Rol |
|--------|-----|
| **`src/core/audit.js`** | HTTP middleware: ring buffer, `getLogs`/`getStats`, istek gövdesi maskeleme, opsiyonel dosya. |
| **`src/core/audit/index.js`** | Public export: `auditLog`, `AuditManager`, sanitization. |
| **`src/core/audit/audit.manager.js`**, **`audit.standard.js`**, **`sinks/**`** | Yapılandırılabilir sink’ler (memory, file, multi). |

---

## 6) Config

| Dosya | Rol |
|--------|-----|
| **`src/core/config.js`** | `process.env` → ham obje → `validateConfig`. |
| **`src/core/config-schema.js`** | Zod şeması; hata → `process.exit(1)`. |
| **`.env`** (yerel, gitignore) | Gerçek secret’lar; örnek için `.env.example` (varsa) bakılır. |

---

## 7) Jobs

| Dosya | Rol |
|--------|-----|
| **`src/core/jobs.js`** | **Asıl kullanılan** kuyruk: `registerJobRunner`, `submitJob`, `runJob`, bellek/Redis store. |
| **`src/core/jobs.redis.js`** | Redis-backed job persistence. |
| **`src/core/jobs/index.js`** | Bazı export alias’ları (`registerJobHandler` vb.). |
| **`src/core/jobs/job.manager.js`**, **`job.worker.js`**, **`worker.js`**, **`queue.js`**, **`job.store.js`** | Alternatif/paralel job alt sistemi parçaları; **fiili `server.js` + `rag-ingestion` akışı `jobs.js` üzerinden.** |

---

## 8) Observability

| Dosya | Rol |
|--------|-----|
| **`src/plugins/observability/index.js`** | `/observability/metrics` (çoğunlukla `audit.getStats` + uptime), health, dashboard static. |
| **`src/core/observability/metrics.js`**, **`tools.metrics.js`**, **`jobs.metrics.js`**, **`plugin.metrics.js`** | Prometheus tarzı registry fonksiyonları; **çoğu üretim yolunda otomatik tetiklenmeyebilir**. |
| **`src/core/observability/observability.manager.js`**, **`tracing.js`**, **`runtime.stats.js`** | Yöneticisel/tracing yardımcıları ve istatistik toplama. |

---

## 9) MCP (protocol)

| Dosya | Rol |
|--------|-----|
| **`src/mcp/gateway.js`** | SDK `Server`, tool listesi ve `callTool`. |
| **`src/mcp/http-transport.js`** | Express `/mcp` middleware. |
| **`src/mcp/stdio-transport.js`** | (Varsa) STDIO ile ilgili yardımcı; ana STDIO girişi **`bin/mcp-hub-stdio.js`**. |

---

## 10) Plugins

| Konum | Rol |
|--------|-----|
| **`src/plugins/<name>/index.js`** | Her plugin: `register(app)`, çoğunda `export const tools`, REST route’ları. |
| **`src/plugins/<name>/plugin.meta.json`** | Yalnızca **bazı** plugin’lerde; eksik olanlar varsayılan meta ile yüklenir. |
| Örnek yoğun plugin’ler | `shell`, `notion`, `github`, `llm-router`, `brain`, `rag`, `rag-ingestion`, `workspace`, `git`, `project-orchestrator`, `policy`, `observability`, … |

*(Tam liste: `src/plugins/` altındaki dizin adları = plugin adları.)*

---

## 11) Tests

| Konum | Rol |
|--------|-----|
| **`tests/smoke.test.js`** | Sunucu ayağa kalkıyor mu, `/health`. |
| **`tests/mcp/*.test.js`** | MCP gateway/transport sözleşmesi. |
| **`tests/core/*.test.js`** | tool-registry, workspace, logger, … |
| **`tests/plugins/*.test.js`** | Plugin davranışı. |
| **`tests/contract/*.test.js`** | Dış API sözleşmeleri (mock/gerçek ağa göre). |
| **`tests/jobs*.test.js`**, **`tests/security/**`** | Job ve path güvenliği. |
| **`src/core/legacy/**/*.test.js`** | Eski registry/tool testleri (vitest `include` içinde). |

---

## Dead / legacy / deprecated (önce okuma — dikkat)

| Konum | Not |
|--------|-----|
| **`src/core/legacy/`** | Eski plugin registry + tool discovery; **`plugins.js` + `tool-registry.js` runtime’da kullanılır.** README: `legacy/README.md`. |
| **`src/core/tenancy/`** | Kod var; **HTTP bootstrap bu registry’yi bağlamıyor** — davranışı “future / test” gibi oku. |
| **`src/core/jobs/job.manager.js`**, **`job.worker.js`**, … | `jobs.js` ile paralel tasarım; entegrasyon önceliğini `jobs.js` ve `rag-ingestion` belirler. |

---

## İlk okunacak 20 dosya (yeni geliştirici)

Bu sıra ile repo akışını en hızlı anlarsın:

1. `mcp-server/package.json`
2. `mcp-server/src/index.js`
3. `mcp-server/src/core/server.js`
4. `mcp-server/src/core/config.js`
5. `mcp-server/src/core/config-schema.js`
6. `mcp-server/src/core/plugins.js`
7. `mcp-server/src/core/plugin-meta.js`
8. `mcp-server/src/core/tool-registry.js`
9. `mcp-server/src/core/tool-hooks.js`
10. `mcp-server/src/core/auth.js`
11. `mcp-server/src/core/policy-guard.js`
12. `mcp-server/src/core/policy-hooks.js`
13. `mcp-server/src/plugins/policy/index.js`
14. `mcp-server/src/core/jobs.js`
15. `mcp-server/src/mcp/gateway.js`
16. `mcp-server/src/mcp/http-transport.js`
17. `mcp-server/bin/mcp-hub-stdio.js`
18. `mcp-server/src/core/workspace.js`
19. `mcp-server/src/core/workspace-paths.js`
20. `mcp-server/src/core/audit.js`

**Hemen ardından (21–22):** `src/core/audit/audit.manager.js` (plugin operation audit) + `src/plugins/rag-ingestion/index.js` (tek job runner + ingest örneği).

---

## Hızlı navigasyon ipuçları

- **“Route nerede?”** → Önce `server.js`, sonra ilgili `src/plugins/<name>/index.js`.
- **“MCP tool nerede?”** → `tool-registry.js` + ilgili plugin `export const tools`.
- **“Workspace path güvenliği?”** → `workspace-paths.js` + tüketen plugin (ör. `workspace`, `repo-intelligence`).
- **“Eski kod mu?”** → `src/core/legacy/` ve `job.manager` ailesi; değişiklik öncesi grep ile referans kontrolü yap.
