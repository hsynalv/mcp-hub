# mcp-hub — Sunduğu Arayüzler

> Sistemin dışarıya açtığı tüm erişim noktaları: ne var, ne yok, tutarsızlıklar.

---

## 1. Özet Tablo

| Arayüz | Var mı? | Yol / Giriş | Not |
|--------|---------|-------------|-----|
| **HTTP API (REST)** | ✅ | `http://localhost:8787` | Tüm plugin route'ları + core |
| **MCP over HTTP** | ✅ | `GET/POST /mcp` | SSE + JSON-RPC, Bearer auth |
| **MCP over STDIO** | ✅ | `npx mcp-hub-stdio` (bin) | Cursor / Claude Desktop için ayrı process |
| **Landing sayfası** | ✅ | `GET /` | `public/landing/` (hero, canlı istatistik, son audit) |
| **Web panel (UI)** | ✅ | `GET /ui` | `public/ui/` — health, plugin, tool listesi, token |
| **Observability dashboard** | ✅ | `GET /observability/dashboard` | Plugin içi HTML/JS/CSS |
| **Admin panel (20 plugin, loglar)** | ✅ | `GET /admin` | 20 plugin kartları, işlem audit, istek logu, jobs |
| **OpenAPI spec** | ✅ | `GET /openapi.json` | Plugin endpoint'lerinden üretilir |
| **Swagger UI / API docs** | ❌ | `/api-docs` yok | Sadece JSON spec var; tarayıcıda doküman arayüzü yok |
| **Merkezi audit UI** | ⚠️ Kısmi | `/audit/logs`, `/audit/stats` (API) + dashboard’da “errors” | Sadece API + observability errors; ayrı “audit viewer” sayfası yok |
| **Plugin bazlı audit** | ✅ | Çoğu plugin: `GET /<plugin>/audit` | shell, workspace, http, database, rag, secrets, llm, file-storage |

---

## 2. HTTP API (REST) — Ne Var?

### 2.1 Core (server.js)

| Method | Path | Açıklama | Auth |
|--------|------|----------|------|
| GET | `/health` | Sunucu sağlık | Yok |
| GET | `/whoami` | Auth + proje bilgisi | read |
| GET | `/plugins` | Yüklü plugin listesi | read |
| GET | `/plugins/:name/manifest` | Plugin manifest | read |
| GET | `/openapi.json` | OpenAPI 3 spec (tüm plugin endpoint’leri) | read |
| GET | `/audit/logs` | Request audit logları (query: plugin, status, limit) | read |
| GET | `/audit/stats` | İstek istatistikleri (byPlugin vb.) | read |
| GET | `/audit/operations` | Plugin işlem audit kayıtları (query: plugin, operation, limit, offset) | read |
| POST | `/jobs` | Job gönder | write |
| GET | `/jobs` | Job listesi | read |
| GET | `/jobs/stats` | Job istatistikleri | read |
| GET | `/jobs/:id` | Tek job detayı | read |
| POST | *(onay endpoint)* | Policy onayı sonrası tool çalıştırma | — |
| **ALL** | **`/mcp`** | **MCP HTTP (GET=SSE, POST=JSON-RPC)** | Bearer (auth açıksa zorunlu) |

### 2.2 Landing & UI

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/` | Landing page (varsa `public/landing/index.html`; yoksa kısa JSON fallback) |
| GET | `/landing/styles.css` | Landing CSS |
| GET | `/landing/app.js` | Landing JS (canlı veri çekiyor) |
| GET | `/ui`, `/ui/` | Web panel (`public/ui/index.html`) |
| POST | `/ui/token` | UI için kısa ömürlü token (sadece localhost) |

### 2.3 Plugin Route’ları (prefix’ler)

Her plugin kendi prefix’i altında mount:

- `/prompts` — prompt-registry  
- `/tech` — tech-detector  
- `/llm` — llm-router (route, models, audit, providers, vb.)  
- `/marketplace` — marketplace  
- `/file-storage` — file-storage  
- `/shell` — shell (execute, sessions, audit, safety)  
- `/projects` — projects  
- `/notion` — notion (search, pages, databases, tasks, vb.)  
- `/database` — database (tables, query, crud, audit)  
- `/docker` — docker (containers, images, logs)  
- `/github-patterns` — github-pattern-analyzer  
- `/project-orchestrator` — project-orchestrator (draft, execute, repo, structure, tasks, code, pr)  
- `/github` — github (repos, file, commits, pulls, branches, analyze)  
- `/n8n/workflows` — n8n-workflows  
- `/file-watcher` — file-watcher  
- `/notifications` — notifications  
- `/workspace` — workspace (read, write, list, search, patch, file, move, audit)  
- `/email` — email  
- `/git` — git (status, diff, log, branches, branch, checkout, add, commit, push, pull, stash)  
- `/secrets` — secrets (list, register, delete, resolve, audit)  
- `/n8n` — n8n (workflow list, execute, vb.)  
- `/local` — local-sidecar (fs, drive)  
- `/rag` — rag (stats, index, search, documents)  
- `/http` — http (request, cache_clear, policy_info, audit)  
- `/observability` — observability (health, health/detailed, metrics, errors, **dashboard**, dashboard/app.js, dashboard/styles.css)  
- `/observability/dashboard` — HTML dashboard  
- `/observability/dashboard/app.js` — Dashboard JS  
- `/observability/dashboard/styles.css` — Dashboard CSS  
- `/prompt-registry` → aslında **`/prompts`** (app.use("/prompts", router))  
- `/openapi` — openapi plugin (load, specs, generate) — **core `/openapi.json` ile karışmasın**; bu plugin “harici spec yükleme” için.

(Not: Bazı plugin’lerin `metadata.endpoints` içindeki `path` değeri ile gerçek mount path’i aynı olmayabilir; gerçek davranış `app.use(..., router)` ile belirlenir.)

---

## 3. MCP (Model Context Protocol)

- **HTTP:** Tek giriş noktası `app.all("/mcp", createMcpHttpMiddleware())`.  
  - GET: SSE stream (session bilgisi + keep-alive).  
  - POST: JSON-RPC (tool listesi, tool çağrısı vb.).  
  - Auth: Bearer token; `HUB_AUTH_ENABLED=true` ise zorunlu.
- **STDIO:** Ayrı process.  
  - `npx mcp-hub-stdio` (veya `node bin/mcp-hub-stdio.js`).  
  - Cursor / Claude Desktop için; HTTP sunucusu çalıştırmadan MCP araçlarına erişim.  
  - Dokümantasyonda eski path olarak `stdio-bridge.js` geçebilir; güncel giriş `bin/mcp-hub-stdio.js`.

---

## 4. Web Arayüzleri — Detay

### 4.1 Landing (`/`)

- **Dosyalar:** `public/landing/index.html`, `styles.css`, `app.js`.  
- **İçerik:** Hero, “System Online”, plugin/job/uptime istatistikleri, canlı aktivite (son audit logları), kod örneği.  
- **Veri:** `app.js` içinde `/observability/health`, `/jobs/stats`, `/audit/logs` vb. çağrılıyor.

### 4.2 Web Panel (`/ui`)

- **Dosya:** `public/ui/index.html` (tek sayfa, Tailwind CDN).  
- **İçerik:** Health, plugin sayısı, tool sayısı, API key/token girişi, “Request token” (localhost’tan POST /ui/token), refresh.  
- **Auth:** Token ile `read` scope; panel API çağrılarında Bearer kullanıyor.

### 4.3 Observability Dashboard (`/observability/dashboard`)

- **Dosyalar:** `plugins/observability/dashboard/index.html`, `app.js`, `styles.css`.  
- **İçerik:** Aggregate health, Prometheus metrics, son hatalar (audit log’dan), job listesi/stats.  
- **Scope:** `requireScope("read")` ile korunuyor.

---

## 5. Eksik / Tutarsızlıklar

| Konu | Durum |
|------|--------|
| **`/api-docs`** | Landing yokken dönen JSON’da `docs: "/api-docs"` yazıyor; fakat **hiçbir yerde `GET /api-docs` route’u yok**. Swagger UI veya ReDoc yok; sadece `/openapi.json` var. |
| **OpenAPI tarayıcı** | Spec var, insanların tarayıcıda denemesi için bir UI yok (Swagger UI / ReDoc eklenebilir). |
| **Merkezi audit “sayfası”** | Audit verisi `/audit/logs` ve plugin bazlı `/…/audit` ile alınabiliyor; observability dashboard’da “errors” var. Ayrı bir “tüm audit’i filtrele/görüntüle” sayfası yok. |
| **Landing fallback** | `public/landing/index.html` yoksa root’ta kısa JSON dönüyor ve içinde `docs: "/api-docs"` geçiyor; bu path 404. |
| **Plugin path vs metadata** | Bazı plugin’lerin `metadata.endpoints[].path` değeri (örn. `/workspace/health`) ile gerçek mount path’i aynı; bazılarında farklı (örn. prompt-registry → `/prompts`). Tek bir “tüm endpoint’lerin listesi” dokümanı veya OpenAPI dışında tutarlı bir kaynak yok. |

---

## 6. Öneriler (Kısa)

1. **`/api-docs`:** Ya bir Swagger UI (veya ReDoc) route’u ekleyip `GET /api-docs` ile OpenAPI spec’i gösterin ya da fallback JSON’daki `docs` alanını kaldırın / `/openapi.json` yapın.  
2. **OpenAPI UI:** `/openapi.json` için en az bir basit “try it” arayüzü (Swagger UI veya ReDoc) eklenebilir.  
3. **Audit UI:** İstenirse tek bir “Audit” sayfası (core + plugin filtreleri) observability veya ayrı bir route olarak eklenebilir.  
4. **Dokümantasyon:** Cursor/Claude için güncel MCP girişi `bin/mcp-hub-stdio.js`; dokümanlarda `stdio-bridge.js` geçiyorsa `mcp-hub-stdio` ile güncellenmeli.

---

_Son güncelleme: 2026-03-11_
