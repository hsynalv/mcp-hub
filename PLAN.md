# mcp-hub Development Path

> Bu dosya projenin geliştirme yol haritasıdır.  
> Her plugin için "mükemmel" tanımı, yapılacaklar ve core uyum kontrol listesi yer alır.  
> Tamamlanan adımlar `[x]` ile işaretlenir.

---

## Genel Felsefe

**Hedef:** Az ama mükemmel. 11 plugin, her biri production-ready, tutarlı mimari, güvenilir davranış.

**"Mükemmel Plugin" Tanımı:**
1. Core altyapıyı tam olarak kullanıyor (`createMetadata`, `createPluginErrorHandler`, `auditLog`)
2. Tüm tool'lar ve endpoint'ler hatasız çalışıyor (happy path + edge case)
3. En az 1 entegrasyon testi var
4. README gerçek çalışan örnekler içeriyor
5. Başka plugin'in kodunu kopyalamıyor, core'daki paylaşımlı servisi kullanıyor

---

## Evrensel Standardizasyon Kontrol Listesi

Her plugin'e uygulanacak ortak adımlar. Hepsini tamamlanmadan "mükemmel" denemez.

```
[ ] createMetadata() kullanıyor mu? (core/plugins/index.js)
[ ] createPluginErrorHandler() kullanıyor mu? (core/error-standard.js)
[ ] auditLog() kullanıyor mu? (core/audit/index.js)
[ ] validateBody() / validateQuery() kullanıyor mu? (core/validate.js)
[ ] ToolTags doğru atanmış mı? (core/tool-registry.js)
[ ] Kendi callLLM() kopyası var mı? → Silinmeli, llm-router kullanılmalı
[ ] register(app) içinde gerçekten route mount ediyor mu?
[ ] requires[] array'i doğru env var'ları listeliyor mu?
[ ] README'de çalışan curl örnekleri var mı?
[ ] En az 1 entegrasyon testi var mı?
```

---

## Plugin Geliştirme Sırası

Bağımlılık sırasına göre: önce temel servisler, sonra onları kullananlar.

| Sıra | Plugin | Öncelik | Neden Bu Sıra |
|---|---|---|---|
| 1 | `llm-router` | 🔴 Kritik | 4 plugin buna bağımlı; önce o düzelsin |
| 2 | `notion` | 🔴 Kritik | project-orchestrator buna bağımlı; Türkçe hardcode sorun |
| 3 | `github` | 🟡 Yüksek | github-pattern-analyzer ve repo-intelligence buna bağımlı |
| 4 | `database` | 🟡 Yüksek | Neredeyse hazır, küçük eksikler |
| 5 | `shell` | 🟡 Yüksek | Pipe bloklaması çok agresif, güvenlik dengesi kuralmalı |
| 6 | `rag` | 🔴 Kritik | Gerçek embedding yok, kelime sayımı yapıyor |
| 7 | `brain` | 🟢 Orta | callLLM kopyası kaldırılacak |
| 8 | `github-pattern-analyzer` | 🟢 Orta | callLLM kopyası kaldırılacak |
| 9 | `n8n` | 🟢 Orta | Yapı iyi, standardizasyon eklenecek |
| 10 | `repo-intelligence` | 🟢 Orta | llm-router zaten kullanıyor, küçük eksikler |
| 11 | `project-orchestrator` | 🟠 Son | Self-HTTP call düzeltilecek, diğerleri hazır olduktan sonra |

---

---

# Plugin 1: llm-router

## Mevcut Durum

**En olgun plugin.** `createMetadata`, `createPluginErrorHandler`, `auditLog`, `withResilience` hepsi mevcut.
Ama kritik bir sorun var: `register(app)` fonksiyonu hiçbir route mount etmiyor.

```js
// MEVCUT — Sadece log basıyor, route yok!
export function register(app, dependencies) {
  console.log("[LLM Router] Registered with providers:", ...);
}
```

`endpoints` array'i handler fonksiyonlarıyla tanımlanmış ama bunlar `register()` içinde `app.post()` / `app.get()` ile mount edilmiyor. Yani `/llm/route` endpoint'i muhtemelen çalışmıyor.

## Kritik Sorunlar

### S1: register() içinde route mount edilmiyor
```js
// YANLIŞ: endpoints array'i export edilmiş ama mount edilmemiş
export const endpoints = [
  { path: "/llm/route", method: "POST", handler: async (req, res) => { ... } },
  ...
];
export function register(app) {
  console.log(...); // routes mount edilmiyor!
}
```

### S2: Model isimleri güncel değil (2024 sonu modelleri)
```js
// MEVCUT — Eski modeller
models: ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"]

// OLMASI GEREKEN — 2025/2026 modelleri
models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
// veya en azından:
models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
```

### S3: AbortController timeout fetch'e bağlı değil
```js
const abortController = new _AbortController();
const timeoutId = setTimeout(() => abortController.abort(), ...);

// Ama client.chat.completions.create çağrısına signal geçilmiyor!
// Anthropic, Google, Ollama client'larının hiçbiri signal desteklemiyor
// Sadece OpenAI için kısmen çalışıyor
```

### S4: compareLLMs bug'ı
```js
// routeTask'a targetProvider geçiliyor ama routeTask bu parametreyi kullanmıyor
const result = await routeTask(task, prompt, { targetProvider: provider });
```

### S5: Maliyet tablosu güncel değil
```js
// 2026 gerçek fiyatları farklı, GPT-4o fiyatı değişti
"gpt-4o": { input: 5, output: 15 }, // 2024 fiyatı
```

## Yapılacaklar Listesi

### Adım 1: register() içinde route'ları mount et
```js
export function register(app) {
  const router = Router();
  
  router.post("/route", async (req, res) => { ... });
  router.post("/compare", async (req, res) => { ... });
  router.get("/models", (req, res) => { ... });
  router.post("/estimate-cost", (req, res) => { ... });
  router.get("/audit", async (req, res) => { ... });
  
  app.use("/llm", router);
  console.log("[LLM Router] Registered with providers:", ...);
}
```

### Adım 2: Model listelerini güncelle
- OpenAI: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`
- Anthropic: `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5` (veya sonnet-20241022)
- Google: `gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-flash`
- Mistral: güncel model isimleri

### Adım 3: AbortController düzelt
Tüm provider client'larına `signal` desteği ekle ya da elle timeout ile `Promise.race` kullan:
```js
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
]);
```

### Adım 4: compareLLMs bug'ını düzelt
`routeTask` içine `options.targetProvider` desteği ekle:
```js
// routeTask içinde
const provider = options.targetProvider || (useFallback ? rule.fallback.provider : rule.primary.provider);
```

### Adım 5: Streaming desteği ekle (nice-to-have)
SSE üzerinden streaming response. MCP gateway zaten SSE destekliyor.

### Adım 6: Maliyet tablosunu çevresel değişkenle override et
```
LLM_PRICING_OVERRIDE={"gpt-4o":{"input":5,"output":15}}
```

### Adım 7: Test yaz
```js
// tests/llm-router.test.js
test("routes coding task to anthropic", ...)
test("falls back when primary unavailable", ...)
test("blocks prompt exceeding max length", ...)
test("GET /llm/models returns available providers", ...)
test("POST /llm/route returns completion", ...)
```

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() kullanıyor
[x] createPluginErrorHandler() kullanıyor
[x] auditLog() kullanıyor
[x] withResilience() kullanıyor
[x] register() içinde route mount ediyor         ← DÜZELTİLDİ
[x] Model isimleri güncel                        ← DÜZELTİLDİ (2026 modelleri)
[x] AbortController → Promise.race ile değiştirildi ← DÜZELTİLDİ
[x] compareLLMs targetProvider bug'ı giderildi   ← DÜZELTİLDİ
[x] plugin.meta.json güncellendi
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- `/llm/route` endpoint'i çalışıyor ve doğru provider'a yönlendiriyor ✅
- `/llm/models` ve `/llm/providers` mevcut, aktif provider'ları gösteriyor ✅
- Timeout (Promise.race) tüm provider'larda çalışıyor ✅
- Model isimleri 2026 itibarıyla güncel ✅
- Fallback zinciri çalışıyor ✅
- vLLM / custom OpenAI-compatible endpoint desteği ✅
- `VLLM_BASE_URL` + `VLLM_MODEL` ile herhangi bir self-hosted model bağlanabiliyor ✅
- `/llm/providers/vllm/test` ile connectivity kontrolü yapılabiliyor ✅
- `/llm/providers/vllm/models` ile server'daki modeller listelenebiliyor ✅
- [ ] Entegrasyon testi (gelecek sprint)

---

---

# Plugin 2: notion

## Mevcut Durum

**En kapsamlı endpoint koleksiyonu** — 15+ endpoint, parallel işlemler, template sistemi.
Ama iki büyük sorunu var: kişisel workspace'e hardcode edilmiş ve core altyapı kullanılmıyor.

## Kritik Sorunlar

### S1: Türkçe field isimleri hardcode
```js
// MEVCUT — Sadece bu workspace'te çalışır
status: z.enum(["Yapılmadı", "Yapılıyor", "Tamamlandı"])
oncelik: z.enum(["Az", "Normal", "Yüksek"])
properties["Başlangıç"] = { date: { start: data.baslangic } }
properties["bitiş"] = { date: { start: data.bitis } }
properties["Görev"] = { title: [...] }
properties["Projeler"] = { relation: [...] }
```
Bu alanlar başka hiçbir Notion workspace'inde çalışmaz.

### S2: createMetadata() yok
Plugin `PluginStatus`, `RiskLevel` kullanmıyor. Startup kalite raporu eksik.

### S3: createPluginErrorHandler() yok
Kendi `err()` helper'ı var ama bu core standardından farklı format döndürüyor.

### S4: auditLog() yok
Notion'da yapılan write operasyonları (page oluşturma, arşivleme) audit log'a yazılmıyor.

### S5: `toNotionBlock()` fonksiyonu eksik ama çağrılıyor
```js
// index.js'de bu çağrı var:
contentBlocks = parsed.map(toNotionBlock).filter(Boolean);
// Ama toNotionBlock import edilmemiş veya tanımlanmamış!
// blocks.js'deki toNotionBlocks() (çoğul) farklı bir fonksiyon
```

### S6: Template sistemi çok sınırlı
Sadece `feature_delivery` ve `task` template'i var. Şablon ekleme mekanizması kapalı.

### S7: Database query pagination yok
`/databases/:id/rows/query` sadece tek sayfa döndürüyor. Büyük veritabanlarında eksik veri riski.

## Yapılacaklar Listesi

### Adım 1: createMetadata() ekle
```js
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

export const metadata = createMetadata({
  name: "notion",
  version: "1.0.0",
  description: "Notion pages, databases, projects and tasks",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write"],
  capabilities: ["read", "write", "notion", "pages", "databases"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: false,
  supportsWorkspaceIsolation: false,
  hasTests: false, // test yazılana kadar
  hasDocs: true,
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  tags: ["notion", "pages", "databases", "tasks", "projects"],
});
```

### Adım 2: createPluginErrorHandler() ile hata standardize et
```js
import { createPluginErrorHandler } from "../../core/error-standard.js";
const pluginError = createPluginErrorHandler("notion");

// Mevcut err() helper'ını kaldır, pluginError kullan:
// err(res, 502, ...) → throw pluginError.external("Notion API", message)
// err(res, 400, ...) → throw pluginError.validation(message)
```

### Adım 3: Write operasyonlarına auditLog ekle
```js
import { auditLog } from "../../core/audit/index.js";

// Her POST/PATCH/DELETE sonrası:
await auditLog({
  plugin: "notion",
  operation: "create_page",
  actor: req.user?.id || "anonymous",
  workspaceId: req.headers["x-workspace-id"] || null,
  allowed: true,
  success: true,
  durationMs: Date.now() - startTime,
  metadata: { pageId: result.data.id, title: data.title },
});
```

### Adım 4: Türkçe field'ları konfigürasyona taşı
```js
// .env.example'a eklenecek:
// NOTION_PROJECTS_DB_STATUS_FIELD=Status          # varsayılan "Status"
// NOTION_PROJECTS_DB_PRIORITY_FIELD=Priority      # varsayılan "Priority"
// NOTION_TASKS_DB_TASK_FIELD=Name                 # varsayılan "Name"
// NOTION_TASKS_DB_DUE_DATE_FIELD=Due Date         # varsayılan "Due Date"

// config.js'de:
notion: {
  projectsDbId: process.env.NOTION_PROJECTS_DB_ID,
  tasksDbId: process.env.NOTION_TASKS_DB_ID,
  fields: {
    projectStatus: process.env.NOTION_PROJECTS_STATUS_FIELD || "Status",
    projectPriority: process.env.NOTION_PROJECTS_PRIORITY_FIELD || "Priority",
    taskName: process.env.NOTION_TASKS_NAME_FIELD || "Name",
    taskDueDate: process.env.NOTION_TASKS_DUE_DATE_FIELD || "Due Date",
    taskProject: process.env.NOTION_TASKS_PROJECT_FIELD || "Project",
    taskDone: process.env.NOTION_TASKS_DONE_FIELD || "Done",
  }
}
```

### Adım 5: toNotionBlock() bug'ını düzelt
`blocks.js` dosyasına `toNotionBlock()` (tekil) fonksiyon ekle veya `toNotionBlocks()` kullanan kodu düzelt:
```js
// index.js'de çağrılan:
contentBlocks = parsed.map(toNotionBlock).filter(Boolean);
// blocks.js'den import edilmeli:
import { toNotionBlocks, toNotionBlock } from "./blocks.js";
```

### Adım 6: Template sistemini genişlet
Dışarıdan template eklenebilir hale getir:
```js
// POST /notion/templates (register a new template)
// Template registry → Map<name, templateFn>
const templateRegistry = new Map();
export function registerTemplate(name, fn) {
  templateRegistry.set(name, fn);
}
```
Varsayılan template'lere ekle: `meeting_notes`, `weekly_review`, `bug_report`, `project_brief`

### Adım 7: Database query pagination ekle
```js
// GET /notion/databases/:id/rows?cursor=xxx&limit=50
// Notion cursor-based pagination desteği
router.get("/databases/:id/rows", async (req, res) => {
  const { cursor, limit = 50 } = req.query;
  const payload = { page_size: Math.min(Number(limit), 100) };
  if (cursor) payload.start_cursor = cursor;
  const result = await notionRequest("POST", `/databases/${req.params.id}/query`, payload);
  res.json({
    ok: true,
    rows: result.data.results.map(formatRow),
    hasMore: result.data.has_more,
    nextCursor: result.data.next_cursor || null,
  });
});
```

### Adım 8: MCP tool'larına auditLog ekle
Her MCP tool handler'ında write operasyonları loglanmalı (şu an yok).

### Adım 9: Test yaz
```js
// tests/notion.test.js
test("POST /notion/pages creates a page", ...)
test("GET /notion/search returns results", ...)
test("POST /notion/row handles missing databaseId", ...)
test("POST /notion/rows/archive archives multiple pages", ...)
test("POST /notion/setup-project creates project + tasks", ...)
```

### Adım 10: Notion API client'ına retry ekle
`notion.client.js`'e `withResilience()` veya basit retry ekle:
```js
import { withResilience } from "../../core/resilience.js";

export async function notionRequest(method, path, body) {
  return withResilience("notion-api", () => _notionRequest(method, path, body), {
    circuit: { failureThreshold: 5, resetTimeoutMs: 60000 },
    retry: { maxAttempts: 2, backoffMs: 1000 },
  });
}
```

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() eklendi
[x] createPluginErrorHandler() import edildi (pluginError hazır)
[x] auditLog() write operasyonlara eklendi (9 operasyon)
[x] validateBody() kullanılıyor
[x] ToolTags kullanılıyor
[x] toNotionBlock() import bug'ı düzeltildi
[x] Türkçe field'lar notionFields config'e taşındı (env override destekli)
[x] notion.client.js'e withResilience + rate-limit retry eklendi
[x] Template sistemi genişletildi (6 template + registerTemplate() API)
[x] GET /databases/:id/rows cursor pagination eklendi
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- Herhangi bir Notion workspace'inde alan adları env var ile konfigüre edilebilir ✅
- Tüm write operasyonları (9 adet) audit log'a yazılıyor ✅
- `POST /notion/setup-project` güvenilir, field config'i kullanıyor ✅
- Template sistemi 6 hazır template + dışarıdan registerTemplate() ile genişletilebilir ✅
- Cursor-based pagination ile büyük veritabanları destekleniyor ✅
- notion.client.js retry + rate limit yönetimi ile production-grade ✅
- toNotionBlock() import bug'ı giderildi ✅
- **Database yönetimi eksiksiz:** custom column desteği, kolon ekleme/yeniden adlandırma ✅
  - `POST /notion/databases` → custom columns ile database oluşturma
  - `PATCH /notion/databases/:id/properties` → mevcut database'e kolon ekleme / rename
  - MCP tools: `notion_create_database`, `notion_add_columns`, `notion_rename_column`, `notion_get_database_schema`, `notion_add_row`
  - Desteklenen kolon tipleri: title, rich_text, number, select, multi_select, status, date, checkbox, url, email, phone_number, people, files, created_time, last_edited_time
- [ ] Entegrasyon testi (gelecek sprint)

---

---

# Plugin 3–11: Detaylı Planlar

---

---

# Plugin 3: github

## Mevcut Durum

Yapısal olarak iyi — ayrı client dosyası, `analyzeRepo()` REST+MCP arasında paylaşılıyor, PR/branch/comment CRUD mevcut, `createPluginErrorHandler` ve `validateBody` / `validateQuery` kullanılıyor.

**Ancak ciddi sorunlar var:**

### Kritik Sorunlar

**1. `err` fonksiyonu runtime'da shadow ediliyor — CRASH riski**

```js
// BUG: catch bloğundaki `err` parametresi, dışarıdaki `err()` fonksiyonunu gölgeliyor
router.get("/repo/:owner/:repo/analyze", async (req, res) => {
  try {
    const data = await analyzeRepo(p.owner, p.repo);
    res.json({ ok: true, ...data });
  } catch (err) {              // ← bu satır dıştaki err() fonksiyonunu kapatıyor
    err(res, 502, ...);        // ← HATA: err artık Error objesi, fonksiyon değil → TypeError!
  }
});
```
Aynı bug `/analyze` GET ve POST route'larında da var. Endpoint'e istek gelip hata oluşunca crash atar.

**2. `createMetadata()` yok — raw export kullanılıyor**

```js
// MEVCUT — tutarsız
export const name = "github";
export const version = "1.0.0";
export const description = "...";
// createMetadata() yok
```

**3. Write operasyonlarda `auditLog()` yok**

PR create, branch create, PR comment oluşturma operasyonları hiç loglanmıyor.

**4. `github.client.js`'de retry/resilience yok**

GitHub API rate limit döndürdüğünde (403/429) doğrudan hata fırlatıyor. Retry logic yok.
`X-RateLimit-Remaining` ve `X-RateLimit-Reset` header'ları yakalanmıyor.

**5. `endpoints[]` eksik — write endpoint'leri manifeste yansımıyor**

`/pulls`, `/pulls/:number/comments`, `/branches` POST endpoint'leri `endpoints` array'inde yok.
OpenAPI spec'te ve `/plugins/github/manifest`'te görünmüyorlar.

**6. `capabilities` yanlış — sadece `["read"]` ama write işleri var**

**7. `analyzeRepo` için cache yok**

Aynı repo kısa aralıklarla analiz edildiğinde gereksiz GitHub API çağrıları yapılıyor. Rate limit tükeniyor.

**8. MCP tool tag tutarsızlığı**

```js
// github_analyze_repo tool'unda:
tags: ["READ", "NETWORK", "EXTERNAL_API", "GIT"],   // ← string! ToolTags kullanılmıyor
// Diğer tool'larda:
tags: [ToolTags.READ, ToolTags.NETWORK, ...],        // ← doğru
```

## Yapılacaklar

### Adım 1: `err` shadow bug'ını düzelt
```js
// Her catch bloğunda:
} catch (e) {                          // ← err → e
  err(res, 502, "analysis_failed", e.message);
}
```
3 yerde düzeltilecek: `/repo/:owner/:repo/analyze`, `GET /analyze`, `POST /analyze`.

### Adım 2: `createMetadata()` ekle
```js
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

export const metadata = createMetadata({
  name: "github",
  version: "1.0.0",
  description: "GitHub repository management — read access + PR/branch write operations",
  status: PluginStatus.STABLE,
  capabilities: ["read", "write"],
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  requiresAuth: false,      // public repos token'sız çalışır
  supportsAudit: true,
  tags: ["github", "git", "vcs", "repository"],
  requires: [],             // GITHUB_TOKEN opsiyonel (private repos için)
});
```

### Adım 3: `auditLog()` write operasyonlara ekle
```js
import { auditLog } from "../../core/audit.js";

function githubAudit(req, operation, success, meta = {}) {
  auditLog({
    plugin: "github",
    operation,
    actor: req.actor || req.user?.id || "anonymous",
    projectId: req.projectId || null,
    allowed: true,
    success,
    metadata: meta,
  });
}

// PR create, branch create, PR comment sonrası:
githubAudit(req, "create_pull_request", true, { repo: `${owner}/${repo}`, pr: result.data.number });
githubAudit(req, "create_branch", true, { repo: `${owner}/${repo}`, branch: branchName });
githubAudit(req, "create_pr_comment", true, { repo: `${owner}/${repo}`, pr: number });
```

### Adım 4: `github.client.js`'e retry + rate limit header desteği ekle
```js
import { withResilience } from "../../core/resilience.js";

export async function githubRequest(method, path, body = null) {
  return withResilience("github-api", () => _githubRequest(method, path, body), {
    circuit: { failureThreshold: 10, resetTimeoutMs: 60000 },
    retry: { maxAttempts: 3, backoffMs: 1000 },
  });
}

// _githubRequest içinde:
const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
const rateLimitReset     = res.headers.get("X-RateLimit-Reset");

// 429 / rate limit 403 → Retry-After kadar bekle
if (res.status === 429 || (res.status === 403 && rateLimitRemaining === "0")) {
  const resetTime = rateLimitReset ? Number(rateLimitReset) * 1000 - Date.now() : 60000;
  await new Promise(r => setTimeout(r, Math.min(resetTime, 60000)));
  throw new Error("rate_limited"); // resilience.js retry tetikler
}

// Response'a rate limit bilgilerini ekle:
return {
  ok: true,
  data: json,
  rateLimit: {
    remaining: rateLimitRemaining ? Number(rateLimitRemaining) : null,
    resetAt: rateLimitReset ? new Date(Number(rateLimitReset) * 1000).toISOString() : null,
  },
};
```

### Adım 5: `analyzeRepo` için in-memory cache ekle
```js
// 5 dakikalık TTL cache
const repoCache = new Map(); // key: "owner/repo", value: { data, expiresAt }

async function analyzeRepo(owner, repo) {
  const cacheKey = `${owner}/${repo}`;
  const cached = repoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // ... mevcut analiz kodu ...

  const result = { repo: ..., tree: ..., commits: ..., issues: ..., pullRequests: ..., readme };
  repoCache.set(cacheKey, { data: result, expiresAt: Date.now() + 5 * 60 * 1000 });
  return result;
}
```

### Adım 6: `endpoints[]` array'ini tamamla
```js
export const endpoints = [
  // ... mevcut read endpoint'leri ...
  { method: "GET",  path: "/github/repo/:owner/:repo/pulls",           description: "List pull requests",           scope: "read"  },
  { method: "POST", path: "/github/repo/:owner/:repo/pulls",           description: "Create a pull request",        scope: "write" },
  { method: "POST", path: "/github/repo/:owner/:repo/pulls/:n/comments", description: "Comment on a pull request",  scope: "write" },
  { method: "POST", path: "/github/repo/:owner/:repo/branches",        description: "Create a new branch",          scope: "write" },
];
```

### Adım 7: Tag tutarsızlığını düzelt + MCP tool `github_get_file` ekle
```js
// github_analyze_repo tool'unda:
tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],

// Yeni tool: tek dosya okuma (AI için çok kullanışlı)
{
  name: "github_get_file",
  description: "Get the content of a specific file from a GitHub repository",
  tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
  inputSchema: {
    type: "object",
    properties: {
      repo:   { type: "string", description: "owner/repo format" },
      path:   { type: "string", description: "File path e.g. src/index.js" },
      branch: { type: "string", description: "Branch name (default: main)" },
    },
    required: ["repo", "path"],
  },
  handler: async (args) => { /* GET /repos/:owner/:repo/contents/:path */ },
}
```

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() eklendi
[x] createPluginErrorHandler() mevcut
[x] auditLog() write operasyonlara eklendi (PR create, branch, comment)
[x] validateBody() / validateQuery() kullanılıyor
[x] ToolTags kullanılıyor (düzeltildi)
[x] err() shadow bug'ı düzeltildi (3 catch bloğu)
[x] github.client.js'e withResilience() + rate limit handling eklendi
[x] analyzeRepo() cache eklendi (5 dk TTL)
[x] endpoints[] array'i tamamlandı (write endpoint'ler eklendi)
[x] github_get_file MCP tool'u eklendi
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- `analyzeRepo()` cache sayesinde rate limit tehlikesi minimize edilmiş ✅
- PR create, branch, comment operasyonları audit log'da görünüyor ✅
- `github.client.js` rate limit 403/429 alınca otomatik retry yapıyor ✅
- `X-RateLimit-Remaining` tüm response'lara ekleniyor ✅
- `GET /analyze` ve `POST /analyze` crash bug'ı giderilmiş ✅
- `endpoints[]` manifest'te tüm endpoint'leri gösteriyor ✅
- MCP'de `github_get_file` ile dosya okuma mümkün ✅
- GITHUB_TOKEN olmadan public repolar çalışıyor ✅
- [ ] Entegrasyon testi (gelecek sprint)

---

---

# Plugin 4: database

## Mevcut Durum

Altyapı sağlam — `createMetadata()`, SQL classification, query timeout, result size limit, policy check (`canAccessDatabase`), `validateBody()` hepsi mevcut. MongoDB adapter'ı da gerçek CRUD metodları içeriyor (insert/update/delete/select).

**Ancak kritik bir açık var: MCP tool'ları hiç yok.**

Bir AI agent bu plugin'i yalnızca REST ile kullanabilir. MCP üzerinden database erişimi mümkün değil.

### Sorunlar

**1. MCP tools dizisi yok — sıfır AI erişimi**

```js
// index.js'de export const tools = [...] yok
// → AI agent'lar /database/* endpoint'lerini MCP üzerinden çağıramıyor
```

**2. `extractContext()` sonuçları bazı route'larda unused**

```js
router.get("/tables", requireScope("read"), async (req, res) => {
  const type = req.query.type;
  const { actor, workspaceId, projectId } = extractContext(req);  // ← hepsi kullanılmıyor!
  await runAdapter(type, async (_signal) => {
    const adapter = await getAdapter(type);
    return await adapter.getTables();
    // auditEntry() çağrısı yok burada
  }, res, req, { operationName: "getTables" });
});
```
`/tables` ve `/tables/:name/schema` route'larında `auditEntry()` çağrısı eksik.

**3. `withTimeout` → AbortController signal adapterlara iletilmiyor**

```js
async function withTimeout(fn, timeoutMs, operationName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const result = await fn(controller.signal);  // signal veriliyor ama...
  // ...
}

// Ancak runAdapter'da:
await runAdapter(type, async (_signal) => {  // ← _signal: ignored! (underscore)
  const adapter = await getAdapter(type);
  return await adapter.query(query, p);      // ← signal hiç kullanılmıyor
```
Timeout mekanizması çalışmıyor — 30 saniye dolunca AbortController abort ediyor ama aktif DB sorgusu iptal edilmiyor.

**4. `/database/health` çok zayıf**

```js
router.get("/health", requireScope("read"), (_req, res) => {
  res.json({ ok: true, status: "healthy", plugin: name, version });
  // Gerçek bağlantı testi yok
});
```

**5. Local `dbAuditLog` yerine core `auditLog()` kullanılmalı**

Şu an database plugin kendi `dbAuditLog` array'ini tutuyor. Core audit sistemi ile entegre değil.
`GET /database/audit` mevcut ama core `/audit/logs` endpoint'iyle ayrı çalışıyor.

**6. `requires[]` boş ama en az bir DB bağlantısı gerekiyor**

```js
export const requires = [];   // ← yanıltıcı — en az bir DB bağlantı string'i gerekli
```

## Yapılacaklar

### Adım 1: MCP tools ekle — en kritik

```js
export const tools = [
  {
    name: "database_query",
    description: "Execute a read-only SQL query (SELECT, WITH, EXPLAIN) or MongoDB aggregation pipeline. Write operations are blocked by default.",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["postgres", "mssql", "mongodb"], description: "Database type" },
        query: { type: "string", description: "SQL query (SELECT only) or MongoDB collection name" },
        pipeline: { type: "array", description: "MongoDB aggregation pipeline (if type=mongodb)" },
        filter:   { type: "object", description: "MongoDB filter object (if type=mongodb)" },
        params:   { type: "array", description: "SQL query parameters ($1, $2...)" },
        explanation: { type: "string", description: "Explain what you are querying and why" },
      },
      required: ["type", "explanation"],
    },
    handler: async (args) => { /* adapter.query() */ },
  },
  {
    name: "database_select",
    description: "Select rows from a table/collection with optional filters and limit",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["postgres", "mssql", "mongodb"] },
        table: { type: "string", description: "Table or collection name" },
        where: { type: "object", description: "Filter conditions as key-value pairs" },
        limit: { type: "number", default: 50, description: "Max rows to return (max 1000)" },
        explanation: { type: "string" },
      },
      required: ["type", "table", "explanation"],
    },
    handler: async (args) => { /* adapter.select() */ },
  },
  {
    name: "database_tables",
    description: "List all tables or collections in the connected database",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["postgres", "mssql", "mongodb"] },
      },
      required: ["type"],
    },
    handler: async (args) => { /* adapter.getTables() */ },
  },
  {
    name: "database_schema",
    description: "Get the schema (columns and types) of a specific table or collection",
    tags: [ToolTags.READ, ToolTags.DATABASE],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["postgres", "mssql", "mongodb"] },
        table: { type: "string", description: "Table or collection name" },
      },
      required: ["type", "table"],
    },
    handler: async (args) => { /* adapter.getSchema() */ },
  },
  {
    name: "database_write",
    description: "Insert, update, or delete rows. Requires DATABASE_DEFAULT_MODE=readwrite env var. Will be blocked in readonly mode.",
    tags: [ToolTags.WRITE, ToolTags.DATABASE, ToolTags.DESTRUCTIVE],
    inputSchema: {
      type: "object",
      properties: {
        type:      { type: "string", enum: ["postgres", "mssql", "mongodb"] },
        operation: { type: "string", enum: ["insert", "update", "delete"] },
        table:     { type: "string" },
        data:      { type: "object", description: "Data to insert or set values for update" },
        where:     { type: "object", description: "Filter for update/delete (required for update/delete)" },
        explanation: { type: "string", description: "Explain exactly what data you are modifying and why" },
      },
      required: ["type", "operation", "table", "explanation"],
    },
    handler: async (args) => { /* adapter.insert/update/delete */ },
  },
];
```

### Adım 2: `/tables` ve `/tables/:name/schema` route'larına `auditEntry()` ekle
```js
router.get("/tables", requireScope("read"), async (req, res) => {
  const type = req.query.type;
  const ctx = extractContext(req);   // destructure etme, obje olarak tut
  await runAdapter(type, async (_signal) => {
    const adapter = await getAdapter(type);
    const result = await adapter.getTables();
    auditEntry({ operation: "getTables", type, allowed: true, rowCount: result.rows?.length, ...ctx });
    return result;
  }, res, req, { operationName: "getTables" });
});
```

### Adım 3: `withTimeout` düzelt → `Promise.race` kullan (AbortController'a güvenme)
```js
async function withTimeout(fn, timeoutMs, operationName) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("query_timeout")), timeoutMs)
  );
  return Promise.race([fn(), timeout]);
}

// runAdapter'da:
await runAdapter(type, async () => {  // ← _signal parametresini kaldır
  const adapter = await getAdapter(type);
  return await adapter.query(query, p);
}, res, req);
```

### Adım 4: `/database/health` endpoint'ini zenginleştir
```js
router.get("/health", requireScope("read"), async (_req, res) => {
  const adapters = ["postgres", "mssql", "mongodb"];
  const checks = await Promise.allSettled(
    adapters.map(async (type) => {
      if (!isConfigured(type)) return { type, status: "not_configured" };
      const start = Date.now();
      try {
        const adapter = await getAdapter(type);
        await adapter.getTables();
        return { type, status: "connected", latencyMs: Date.now() - start };
      } catch (e) {
        return { type, status: "error", error: e.message };
      }
    })
  );

  const results = checks.map(r => r.value || r.reason);
  const healthy = results.every(r => r.status === "connected" || r.status === "not_configured");
  res.status(healthy ? 200 : 503).json({ ok: healthy, adapters: results });
});
```

### Adım 5: `requires[]` array'ini düzgün doldur + env var belgele
```js
export const requires = [];   // Opsiyonel — hangi adapter kullanılıyorsa o gerekli:
// POSTGRES_URL  → postgres adapter için
// MSSQL_HOST + MSSQL_USER + MSSQL_PASSWORD + MSSQL_DATABASE → mssql için
// MONGODB_URI   → mongodb için
// DATABASE_DEFAULT_MODE = "readonly" | "readwrite" (default: readonly)
```
Bunları `.env.example`'a da ekle.

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() mevcut
[x] createPluginErrorHandler() mevcut
[x] validateBody() mevcut
[x] SQL classification mevcut (DDL bloklanıyor)
[x] Query timeout → Promise.race() ile düzeltildi
[x] Result size limit mevcut
[x] Policy check (canAccessDatabase) mevcut
[x] MCP tools eklendi (database_query, database_select, database_tables, database_schema, database_write)
[x] /tables ve /tables/:name/schema route'larına auditEntry() eklendi
[x] /database/health gerçek bağlantı testi yapıyor (latency dahil)
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- AI agent MCP üzerinden `database_query`, `database_select`, `database_tables` tool'larını kullanabiliyor ✅
- `database_write` tool'u readonly modda düzgün reddediyor ✅
- `/database/health` her adapter'ı gerçekten test ediyor (latency dahil) ✅
- Query timeout gerçekten çalışıyor (Promise.race ile) ✅
- MongoDB insert/update/delete adapter desteği zaten mevcut ✅
- [ ] Entegrasyon testi (gelecek sprint)

---

---

## Plugin 5: shell

---

---

# Plugin 5: shell

## Mevcut Durum

`createMetadata`, `auditLog`, policy check, allowlist ve MCP tools hepsi mevcut. Güçlü bir temel var. Ama **üç runtime crash** ve **bir güvenlik bypass** bug'ı var, üstüne `DANGEROUS_PATTERNS` o kadar agresif ki AI agent hiçbir yararlı komut çalıştıramaz.

### Kritik Sorunlar

**1. `require("path")` — ESM'de crash**

```js
function validateWorkingDir(cwd) {
  if (!cwd) return true;
  const path = require("path");   // ← ESM'de require() yok → ReferenceError!
```
`cwd` parametresi geçilen her çağrıda crash. AI `cwd` belirtirse plugin çöker.

**2. `requireScope("write")` import edilmemiş — route crash**

```js
router.post("/execute", requireScope("write"), async (req, res) => {
// ↑ requireScope hiçbir yerde import edilmemiyor → ReferenceError on first POST
```

**3. Streaming policy check hiç çalışmıyor — güvenlik bypass**

```js
canExecute({...}).then(policyResult => {
  if (!policyResult.allowed) {
    policyDenied = true;    // ← bu flag'i hiçbir şey kontrol etmiyor!
  }
}).catch(() => {});
// spawn() hemen çalışıyor, policy sonucunu beklemeden
```
Stream endpoint'inde policy tamamen by-pass ediliyor.

**4. `DANGEROUS_PATTERNS` çok agresif — AI agent için kullanılamaz**

```js
/&&|\|\||;/,   // ← "git status && git diff" blocked!
/\|/,          // ← "ls | grep foo" blocked!
/[<>]/,        // ← "cat file.txt" blocked (bazı terminallerde)
```
Gerçekte tehlikeli olan `rm -rf`, `sudo`, `dd if=`, `mkfs` vb. zaten bloke. Ama pipe ve compound komut yasağı, AI'nın yararlı işler yapmasını tamamen engelliyor.

**5. `shell_execute` MCP tool'unda `explanation` yok**

AI hangi komutu neden çalıştırdığını açıklamak zorunda değil. Audit log'u anlamsız kalıyor.

## Yapılacaklar

### Adım 1: `require("path")` → static import

```js
// index.js'in en başına:
import { resolve, sep } from "path";

function validateWorkingDir(cwd) {
  if (!cwd) return true;
  const resolved = resolve(cwd);
  const currentCwd = resolve(process.cwd());

  if (ALLOWED_WORKING_DIRS.length === 0) {
    return resolved === currentCwd || resolved.startsWith(currentCwd + sep);
  }
  return ALLOWED_WORKING_DIRS.some(allowed => resolved.startsWith(resolve(allowed)));
}
```

### Adım 2: `requireScope` → import ekle

```js
import { requireScope } from "../../core/auth.js";
```

### Adım 3: Streaming policy check → async yap

```js
// executeCommandStream'i async'e çevir ve policy'yi await ile bekle
async function executeCommandStream(command, options = {}) {
  const allowedCheck = isCommandAllowed(command);
  if (!allowedCheck.allowed) { /* throw */ }
  if (!validateWorkingDir(cwd)) { /* throw */ }

  const policyManager = getPolicyManager();
  if (policyManager) {
    const policyResult = await canExecute({ actor, command, workspaceId: cwd });
    if (!policyResult.allowed) {
      throw Errors.authorization(`Policy denied: ${policyResult.reason}`);
    }
  }
  // artık spawn() çağrılıyor
  const child = spawn(...);
  return child;
}

// Route'u da async yap:
router.post("/execute/stream", async (req, res) => {
  try {
    const child = await executeCommandStream(command, { ... }); // ← await
    ...
  } catch (err) { ... }
});
```

### Adım 4: `DANGEROUS_PATTERNS` — akıllı güvenlik

**Kaldırılanlar** (çok agresif, allowlist bunu zaten hallediyor):
- `/&&|\|\||;/` — compound komutları analiz et, her parçayı allowlist'e karşı kontrol et
- `/\|/` — pipe destination'ı allowlist'e karşı kontrol et
- `/[<>]/` — basit yönlendirme genellikle güvenli; yalnızca `/dev/sd*`, `/dev/hd*` gibi disk aygıtlarına yönlendirme bloke edilmeli

**Eklenenler** (gerçekten tehlikeli):
- `/\brm\s+-[rf]*r[f]*/i` — `rm -rf` ve varyasyonları (zaten var ama güçlendirilecek)
- `/\bcurl\b.*\|\s*\bbash\b/i` — `curl | bash` pattern'i

```js
// Compound komut analizi:
function parseCompoundCommand(command) {
  // && || ; | ile ayrılmış komutları parçalara böl
  const parts = command.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean);
  return parts.map(part => part.split(/\s+/)[0].toLowerCase());
}

function isCommandAllowed(command) {
  const trimmed = command.trim();

  // Gerçekten tehlikeli pattern'lar
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: "Dangerous pattern detected", pattern: pattern.source };
    }
  }

  // Compound komutlarda her binary allowlist'te mi?
  const binaries = parseCompoundCommand(trimmed);
  for (const bin of binaries) {
    if (!ALLOWED_COMMANDS.has(bin)) {
      return { allowed: false, reason: `Command not in allowlist: ${bin}`, baseCmd: bin };
    }
  }

  return { allowed: true, reason: null };
}
```

### Adım 5: `shell_execute` MCP tool'una `explanation` ekle

```js
{
  name: "shell_execute",
  description: "Execute a shell command. Only allowed commands (see shell_safety_check) will run. Always explain why.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to execute. Pipes and && are allowed if all parts are in the allowlist." },
      cwd:     { type: "string", description: "Working directory (must be within project root)" },
      timeout: { type: "number", description: "Timeout in ms (default: 30000, max: 300000)" },
      explanation: { type: "string", description: "Explain what this command does and why you need to run it" },
    },
    required: ["command", "explanation"],
  },
```

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() mevcut
[x] auditLog() mevcut
[x] ToolTags kullanılıyor
[x] requireScope import edildi
[x] require("path") → static import düzeltildi
[x] streaming policy check await ile çalışıyor
[x] DANGEROUS_PATTERNS akıllandırıldı (pipe/&& allowlist-aware)
[x] shell_execute'da explanation zorunlu
[x] parseCommandBinaries: tırnak içi operatörler strip ediliyor (echo "a && b" → safe)
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- `git status && git diff` çalışıyor ✅
- `ls | grep foo` çalışıyor ✅
- `echo "hello && world"` yanlış bloke edilmiyor ✅
- `curl | bash` bloke ediliyor ✅
- `sudo`, `rm -rf`, `dd if=`, `mkfs` bloke ediliyor ✅
- Streaming endpoint policy'yi atlayamıyor ✅
- `cwd` verildiğinde crash yok ✅
- Audit log'da her komutun açıklaması var ✅
- Allowlist env var'dan kolayca genişletilebilir ✅

---

---

## Plugin 6: rag

---

---


## Mevcut Durum

`createMetadata`, `auditLog`, workspace isolation, MCP tools, chunk logic, metadata sanitization hepsi mevcut. Altyapı sağlam. Ama **çekirdeği sahte**: "semantic search" aslında kelime frekansı sayıyor. Gerçek embedding yok.

### Kritik Sorunlar

**1. `createEmbedding()` sahte — semantic search değil**

```js
function createEmbedding(text) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const vocab = [...new Set(words)];
  return vocab.map(word => words.filter(w => w === word).length / words.length);
  // ↑ Bu TF (term frequency) vektörü. "semantic" hiçbir yanı yok.
  // "araba" ve "otomobil" sıfır benzerlik döndürür.
}
```

**2. `/rag/audit` route'unda `await` eksik — Promise objesi dönüyor**

```js
router.get("/audit", (req, res) => {
  const limit = ...;
  res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  // ↑ getAuditLogEntries async! await yok → client hep {} alıyor
});
```

**3. `/rag/clear` — kimlik doğrulama yok**

```js
router.post("/clear", async (req, res) => {
  // requireScope() yok, auth yok — herkes tüm workspace'i silebilir
  const count = await store.clearWorkspace(wsId);
```

**4. Sadece ilk chunk'ın embedding'i alınıyor**

```js
const embeddingText = chunks.length > 0 ? chunks[0] : content.slice(0, MAX_CHUNK_SIZE);
const embedding = createEmbedding(embeddingText);
// Uzun belgelerin 2. 3. chunk'ları asla aranmıyor
```

**5. Chunk overlap mantığı yanlış — chunk'lar büyüyor**

```js
const prevEnd = chunks[i - 1].slice(-overlap);
overlappedChunks.push(prevEnd + chunks[i]);  // ← chunk max_size'dan büyük!
```

## Yapılacaklar

### Adım 1: Gerçek OpenAI embedding + keyword fallback

```js
import OpenAI from "openai";

const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small

// Embedding cache: text → vector (5 dk TTL)
const embeddingCache = new Map();

async function createEmbedding(text) {
  const key = text.slice(0, 200); // cache key
  const cached = embeddingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.vector;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Keyword fallback — açıkça belirt
    console.warn("[rag] OPENAI_API_KEY not set — using keyword fallback (not semantic)");
    return keywordEmbedding(text);
  }

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8191), // API limit
    });
    const vector = res.data[0].embedding;
    embeddingCache.set(key, { vector, expiresAt: Date.now() + 5 * 60 * 1000 });
    return vector;
  } catch (err) {
    console.warn("[rag] OpenAI embedding failed, falling back to keyword:", err.message);
    return keywordEmbedding(text);
  }
}

function keywordEmbedding(text) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const vocab = [...new Set(words)];
  return vocab.map(word => words.filter(w => w === word).length / words.length);
}
```

### Adım 2: Her chunk'ı ayrı ayrı embed et

```js
// index handler'da:
const chunkEmbeddings = await Promise.all(
  chunks.map(chunk => createEmbedding(chunk))
);

await store.upsertDocument(wsId, id, {
  id,
  content,
  chunks,
  chunkEmbeddings,   // ← her chunk'ın vektörü ayrı
  embedding: chunkEmbeddings[0],  // backward compat
  metadata: { ...metadata, workspaceId: wsId },
  indexedAt: new Date().toISOString(),
  embeddingModel: process.env.OPENAI_API_KEY ? EMBEDDING_MODEL : "keyword",
});
```

### Adım 3: Search'ü her chunk üzerinden yap

```js
// store.searchDocuments'ı her chunk embedding'e karşı karşılaştır,
// en yüksek chunk skoru belgenin skoru olsun.
// Bu sayede uzun belgeler de doğru rank alır.
```

### Adım 4: `/rag/audit` → await ekle

```js
router.get("/audit", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const entries = await getAuditLogEntries(limit);  // ← await
  res.json({ ok: true, data: { audit: entries } });
});
```

### Adım 5: `/rag/clear` → auth + confirmation

```js
import { requireScope } from "../../core/auth.js";

router.post("/clear", requireScope("write"), async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== "DELETE_ALL") {
    return res.status(400).json({
      ok: false,
      error: { code: "confirmation_required", message: 'Send { "confirm": "DELETE_ALL" } to clear the index' },
    });
  }
  const context = extractContext(req);
  const count = await store.clearWorkspace(context.workspaceId || "global");
  auditEntry({ operation: "clear", ...context, success: true, docCount: count });
  res.json({ ok: true, cleared: count });
});
```

### Adım 6: Chunk overlap mantığını düzelt

```js
// Overlap: bir sonraki chunk'ın başına bir öncekinin sonunu ekle ama toplam max_size'ı geçme
function chunkText(text, chunkSize = MAX_CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  if (!text || text.length === 0) return chunks;

  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    start += chunkSize - overlap;  // ← sliding window, overlap geri gider
    if (start >= text.length) break;
  }
  return chunks;
}
```

### Adım 7: `rag_search` MCP tool'unu güncelle

```js
{
  name: "rag_search",
  description: "Search indexed documents by semantic similarity. Requires OPENAI_API_KEY for true semantic search; falls back to keyword matching otherwise.",
  inputSchema: {
    properties: {
      query:    { type: "string", description: "What you are looking for" },
      limit:    { type: "number", default: 5 },
      minScore: { type: "number", default: 0.1, description: "0.0-1.0 similarity threshold. For keyword fallback, 0.05+ is recommended." },
      workspaceId: { type: "string", description: "Limit search to a specific workspace" },
    },
    required: ["query"],
  },
```

## Standardizasyon Kontrol Listesi

```
[x] createMetadata() mevcut
[x] auditLog() mevcut
[x] ToolTags kullanılıyor
[x] Workspace isolation mevcut
[x] createEmbedding() → OpenAI text-embedding-3-small (keyword fallback)
[x] Her chunk ayrı embed edildi (index.js)
[x] MemoryStore.searchDocuments → chunkEmbeddings[] üzerinden arama (max similarity)
[x] Embedding cache eklendi (5 dk TTL)
[x] /rag/audit → await düzeltildi
[x] /rag/clear → requireScope + confirmation eklendi
[x] Chunk overlap sliding window'a çevrildi
[x] rag_search description güncellendi (semanticSearch: bool döndürüyor)
[ ] En az 1 entegrasyon testi var
```

## "Mükemmel" Tanımı

- `OPENAI_API_KEY` varsa gerçek semantic search: "araba" sorgusu "otomobil" dokümanını buluyor ✅
- `OPENAI_API_KEY` yoksa "keyword fallback" log'da açıkça görünüyor, kullanıcı aldatılmıyor ✅
- Embedding cache sayesinde aynı metin için API tekrar çağrılmıyor ✅
- Uzun belgeler her chunk'ından aranabiliyor (sadece ilk chunk değil) ✅
- MemoryStore her chunk embedding'ini karşılaştırıyor, en yüksek score döndürüyor ✅
- `/rag/clear` confirmation olmadan çalışmıyor ✅
- `/rag/audit` endpoint gerçek veriyi dönüyor ✅

---

---

## Plugin 7: brain

> ⚠️ **Bu plugin diğerleri tamamlandıktan sonra yeniden tasarlanacak.**
> Şu anki implementasyon temel alınmayacak; tamamen yeni bir rol üstlenecek.
> Aşağıdaki vizyon ve plan nihai hedefi tanımlar.

---

### Yeni Rol: AI Agent'ın Uzun Vadeli Belleği + Koordinatörü

Şu anki `brain`, `llm-router`'ın yarım kalmış kopyasından ibaret.
`summarize`, `classify`, `extract_entities` skill'leri AI client'ın (Claude, GPT) zaten
native olarak yaptığı şeyler — ayrı bir plugin'e ihtiyaç yok.

**Brain'in gerçek değeri:** AI agent her session başında sıfırdan başlar.
Brain bu boşluğu doldurur: kalıcı bellek + çok adımlı iş koordinasyonu.

```
Brain olmadan: Her session → "hangi stack kullanıyorsun, ne yaptın, ne tercih edersin?"
Brain ile:     Her session → "TypeScript+Express+Zod, BullMQ tercih ettik, geçen shell+rag bitti."
```

---

### Kaldırılacak Şeyler (Şu Anki Koddan)

| Özellik | Neden |
|---|---|
| `summarize`, `classify`, `extract_entities`, `ask`, `plan` skill'leri | AI client zaten yapıyor, değer yok |
| `callLLM()` kopyası | `llm-router` var |
| `/brain/generate` endpoint | `llm-router`'ın tekrarı |
| In-memory `facts` ve `contexts` Map | Restart'ta sıfırlanıyor → Redis |

---

### Yeni 5 Temel MCP Tool

```
brain_remember          → Karar/tercih/bağlam Redis'e kaydet
brain_recall            → Mevcut task için ilgili hafızayı çek
brain_plan              → Goal'ı adımlara böl; opsiyonel olarak diğer plugin'lerle execute et
brain_summarize_session → Oturum özetini çıkar, RAG'a indexle (aranabilir geçmiş)
brain_get_context       → Proje bağlamını tek çağrıda getir (AI sistem promptuna enjekte için)
```

---

### Mimarisi

```
Memory Layer   → Redis (facts, decisions, preferences, session summaries)
Search Layer   → RAG plugin (geçmiş session'lar semantik olarak aranabilir)
LLM Layer      → routeTask() via llm-router (özetleme, planlama için)
Action Layer   → callTool() via tool-registry (shell, github, notion, rag orchestration)
```

---

### Standardizasyon Kontrol Listesi (Sonra Yapılacak)

```
[ ] Mevcut skill'leri kaldır (summarize, classify, extract_entities, ask, plan)
[ ] callLLM() kaldır → routeTask() kullan
[ ] brain_remember   → Redis'e HSET, TTL opsiyonel
[ ] brain_recall     → Redis HGETALL + anlama göre filtreleme
[ ] brain_plan       → routeTask("planning") + callTool() orchestration
[ ] brain_summarize_session → routeTask("summarize") + rag_index()
[ ] brain_get_context → Redis'ten proje context'ini tek seferde çek
[ ] createMetadata() ekle
[ ] auditLog() ekle (her bellek yazma ve okuma işlemi)
[ ] requireScope("write") → yazma endpoint'lerine
[ ] In-memory Map → Redis (contexts, facts)
[ ] Session izolasyonu: x-project-id bazlı key prefix
[ ] En az 1 entegrasyon testi
```

### "Mükemmel" Tanımı

- `brain_remember` ile saklanan bir karar, server restart sonrasında `brain_recall` ile geri geliyor
- `brain_get_context` → AI'ın sistem promptuna eklenebilir hazır bir bağlam döndürüyor
- `brain_summarize_session` → RAG'a indexleniyor; "geçen haftaki auth kararı ne" aranabiliyor
- `brain_plan` → hedefi adımlara bölüyor ve her adımı doğru plugin'e yönlendiriyor
- Tüm bellek `x-project-id` ile izole — farklı projeler farklı brain'e sahip

---

**NOT:** Bu plugin diğer tüm plugin'ler (llm-router ✅, notion ✅, github ✅,
database ✅, shell ✅, rag ✅, github-pattern-analyzer, n8n, repo-intelligence)
tamamlandıktan sonra ele alınacak. `project-orchestrator` ile birlikte
son iki büyük parçayı oluşturuyor.

**Güçlü yönler (mevcut kod):**
- `registerSkill()` API → dışarıdan skill eklenebilir, genişletilebilir mimari
- Session-tabanlı context memory (getOrCreateContext)
- `createJob()` ile async planner entegrasyonu (fikir doğru)
- Zod validation tüm route'larda mevcut
- 5 built-in skill: summarize, classify, extract_entities, ask, plan
- MCP tools eksiksiz ve tutarlı

---

> Aşağısı eski analiz notları — referans için korundu, yeni implementasyonda kullanılmayacak.

### Kritik Sorunlar (Eski Kod — Referans)

**1. `callLLM()` kopyası — llm-router'dan bihaber**

```js
// brain/index.js — kendi callLLM() tanımlıyor
async function callLLM(messages, options = {}) {
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, { ... });
}
```

`llm-router`'ın `routeTask()` fonksiyonu provider routing, fallback, timeout,
cost tracking, ve vLLM desteği sağlıyor. Brain hiçbirinden habersiz.

**2. `brain_invoke_skill` MCP tool'unda `process.env` race condition**

```js
handler: async (args) => {
  const originalDefault = DEFAULT_MODEL; // ← module-scope const, değişmez
  if (args.options?.model) process.env.BRAIN_LLM_MODEL = args.options.model; // ← env set
  const result = await skill.handler(args.inputs); // ← callLLM DEFAULT_MODEL kullanır, env'e bakmaz!
  if (args.options?.model) process.env.BRAIN_LLM_MODEL = originalDefault; // ← geri alınamaz
  return result;
}
```

`DEFAULT_MODEL` modül yüklendiğinde sabitlenir. `process.env`'i sonradan değiştirmek işe yaramaz.
Skill handler'ları `callLLM(messages)` çağırır, `model` parametresi iletilmez → model override çalışmıyor.

**3. Async planner'da unhandled rejection riski**

```js
if (async) {
  const job = createJob(...);
  res.status(202).json({ ... }); // ← yanıt gönderildi
  const result = await skill.handler(...); // ← burada throw olursa crash!
  job.resolve(result);
  return;
}
```

Yanıt gönderildikten sonra `throw` olursa `Express`'e yakalatılamaz → işlem çöker.

**4. Yazma endpoint'lerinde auth yok**

`/brain/chat`, `/brain/facts`, `/brain/planner`, `/brain/generate` →
`requireScope("write")` yok. Herkes kullanabilir.

**5. Session izolasyonu yok**

Session ID kullanıcı tarafından seçiliyor. `sessionId: "admin-session"` bilen herkes
admin'in conversation history'sine erişir. `x-project-id` veya `Authorization` tabanlı
izolasyon gerekli.

**6. `callLLM()` timeout yok**

`brain`'deki `callLLM()` ne `AbortController` ne `Promise.race` kullanıyor.
Yavaş bir LLM yanıtı tüm request handler'ı sonsuza askıya alır.

**7. `createMetadata()` ve `auditLog()` yok**

```js
export const name = "brain"; // ← ham export
// LLM çağrıları (maliyetli!) hiç audit loglanmıyor
```

---

### Çözüm Planı

#### Adım 1: `callLLM()` → `routeTask()` ile değiştir

```js
import { routeTask } from "../llm-router/index.js";

// Skill handler'larındaki callLLM(messages) çağrıları:
async function brainLLM(messages, options = {}) {
  // routeTask, task türüne göre provider seçer
  return await routeTask({
    task: options.task || "chat",
    messages,
    model:       options.model,
    temperature: options.temperature,
    maxTokens:   options.maxTokens,
    provider:    options.provider,
  });
}
```

`brain_invoke_skill` MCP tool'unda model override'ı düzgün ilet:

```js
handler: async (args) => {
  const skill = skills.get(args.skill);
  // Skill handler'larına options geçilemiyorsa, skill API'sini genişlet:
  const result = await skill.handler(args.inputs, args.options || {});
  return result;
}
```

Her built-in skill handler'ını `(inputs, options = {})` alacak şekilde güncelle,
`brainLLM(messages, options)` çağır.

#### Adım 2: `createMetadata()` ekle

```js
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

export const metadata = createMetadata({
  name: "brain",
  version: "1.1.0",
  description: "...",
  status: PluginStatus.STABLE,
  risk: RiskLevel.MEDIUM,
  capabilities: ["read", "write"],
  requires: ["OPENAI_API_KEY or BRAIN_LLM_API_KEY"],
  ...
});
```

#### Adım 3: `auditLog()` ekle

Her LLM çağrısı (chat, skill invoke, generate) loglanmalı:

```js
import { auditLog } from "../../core/audit.js";

function brainAudit(req, action, details) {
  return auditLog({
    plugin:  "brain",
    action,
    userId:  req?.headers?.["x-user-id"] || "anonymous",
    details,
    risk:    RiskLevel.MEDIUM,
  });
}

// /brain/chat içinde:
await brainAudit(req, "chat", { sessionId, model: result.model, turns: ctx.messages.length });
```

#### Adım 4: `requireScope("write")` ekle

```js
import { requireScope } from "../../core/auth.js";

router.post("/chat",     requireScope("write"), async (req, res) => { ... });
router.post("/facts",    requireScope("write"), async (req, res) => { ... });
router.post("/planner",  requireScope("write"), async (req, res) => { ... });
router.post("/generate", requireScope("write"), async (req, res) => { ... });
```

#### Adım 5: Async planner'ı güvenli hale getir

```js
if (async) {
  const job = createJob("planner", { goal, constraints });
  res.status(202).json({ ok: true, jobId: job.id });

  // fire-and-forget ama hata yönetimiyle:
  Promise.resolve()
    .then(() => skill.handler({ goal, constraints }))
    .then(result => job.resolve(result.ok ? result.data : result.error))
    .catch(err  => job.reject({ code: "planner_error", message: err.message }));

  return;
}
```

#### Adım 6: Session izolasyonu (proje bazlı)

```js
function getSessionKey(req, sessionId) {
  const projectId = req.headers["x-project-id"] || "global";
  return `${projectId}:${sessionId}`;
}
```

Session lookup ve create işlemlerini `getSessionKey()` üzerinden yap.

---

### Standardizasyon Kontrol Listesi

```
[ ] callLLM() → routeTask() (llm-router)
[ ] createMetadata() ekle
[ ] createPluginErrorHandler() ekle
[ ] auditLog() → chat, invoke, generate, planner
[ ] requireScope("write") → yazma endpoint'leri
[ ] brain_invoke_skill: model override bug düzelt
[ ] Async planner: try/catch + job.reject()
[ ] Session key: x-project-id ile izole et
[ ] callLLM timeout yok → routeTask() ile çözülür (zaten var orada)
[ ] En az 1 entegrasyon testi
```

### "Mükemmel" Tanımı

- `POST /brain/chat` çalışıyor, session geçmişi korunuyor
- `brain_invoke_skill` model parametresi gerçekten işe yarıyor
- Her LLM çağrısı audit log'da görünüyor (plugin, action, model, token count)
- `async: true` planner bir hata fırlatsa bile server çökmüyor
- Session izolasyonu: farklı `x-project-id` başlıkları farklı bellekler görüyor
- Tüm yazma route'larında auth var

---

---

## Plugin 8: github-pattern-analyzer

**Güçlü yönler:**
- Redis cache kullanıyor — pahalı analizi tekrar yapmak zorunda kalmıyor
- `callTool()` ile github plugin'ını çağırıyor — self-HTTP değil, doğru pattern
- `invalidatePatterns()` endpoint'i mevcut — cache yönetimi var
- Çok detaylı pattern extraction prompt (techStack, architecture, codingStyle, projectStandards)
- Architecture options generator — projeye özgü mimari önerisi, çok özgün bir özellik

---

### Kritik Sorunlar

**1. `callLLM()` kopyası — brain ile aynı sorun**

```js
// github-pattern-analyzer/index.js — yine kendi callLLM()
async function callLLM(messages, options = {}) {
  const controller = new globalThis.AbortController();
  setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, { signal: controller.signal, ... });
}
```

`AbortController.abort()` fetch bağlantısını keser ama LLM provider server-side
processing'i durdurmaz. Maliyet tahakkuk eder, token sayılır. `routeTask()` ile değiştirilmeli.

**2. `createMetadata()`, `capabilities[]`, `requires[]` yok**

```js
export const name = "github-pattern-analyzer";
export const version = "1.0.0";
// capabilities → yok
// requires → yok (ama OPENAI_API_KEY olmadan çalışmıyor)
// metadata → ham export
```

**3. `/analyze` GET ama ağır bir write işlemi**

```
GET /github-patterns/analyze
→ 5 GitHub API çağrısı (repo list + 5× repo analyze)
→ 1 OpenAI API çağrısı (4000 token yanıt)
→ Redis yazma
```

GET semantiği "tekrar çağrılabilir, yan etkisiz" demek. Bu endpoint Redis'e yazıyor →
`POST /github-patterns/analyze` olmalı.

**4. LLM prompt'unda token sınırı yok**

```js
tree: (Array.isArray(r?.tree) ? r.tree : r?.tree?.items)?.slice(0, 20),
readme: (r?.readme ?? "")?.slice(0, 1000),
```

5 repo × (20 tree item + 1000 char readme + 5 commit) ≈ 15-20K token. `gpt-4o`'nun
8K output limit'i var. Büyük repo'larda prompt truncation gerekmeden context overflow olabilir.

**5. Cache TTL yok — analiz sonsuza kadar geçerli**

`setCachedPatterns()` muhtemelen varsayılan Redis TTL'ini (yok = sonsuza kadar) kullanıyor.
Developer yeni projeye geçse eski pattern'lar döner. TTL veya versiyon stratejisi gerekli.

**6. Health endpoint yok**

Diğer plugin'lerin hepsinde `/health` var. github-pattern-analyzer'da yok.

**7. `auditLog()` yok**

Pattern analizi: 5 GitHub API çağrısı + 1 OpenAI çağrısı = maliyetli işlem.
Kim ne zaman analiz yaptırdı? Bilinmiyor.

---

### Çözüm Planı

#### Adım 1: `callLLM()` → `routeTask()` ile değiştir

```js
import { routeTask } from "../llm-router/index.js";

async function patternLLM(messages, options = {}) {
  return await routeTask({
    task: "analysis",         // llm-router analiz için doğru modeli seçer
    messages,
    maxTokens: options.maxTokens ?? 4000,
    jsonMode:  options.jsonMode ?? false,
  });
}
```

`extractPatterns()` ve `generateArchitectureOptions()` bu helper'ı kullanır.

#### Adım 2: `createMetadata()` + `createPluginErrorHandler()` ekle

```js
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { createPluginErrorHandler } from "../../core/errors.js";

export const metadata = createMetadata({
  name: "github-pattern-analyzer",
  version: "1.1.0",
  status: PluginStatus.STABLE,
  risk: RiskLevel.LOW,
  capabilities: ["read"],
  requires: ["OPENAI_API_KEY", "GITHUB_TOKEN", "REDIS_URL"],
});

const err = createPluginErrorHandler("github-pattern-analyzer");
```

#### Adım 3: `auditLog()` ekle

```js
import { auditLog } from "../../core/audit.js";

// /analyze içinde, başarılı analizin ardından:
await auditLog({
  plugin:  "github-pattern-analyzer",
  action:  "analyze_patterns",
  userId:  req.headers["x-user-id"] || "anonymous",
  details: { username, repoCount: analyses.length, confidence: patternsResult.patterns.confidence },
  risk:    RiskLevel.LOW,
});
```

#### Adım 4: `/analyze` → POST'a çevir + token budget ekle

```js
router.post("/analyze", requireScope("read"), async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body); // body'den al
  ...
});

// extractPatterns'te güvenli truncation:
tree:    (Array.isArray(r?.tree) ? r.tree : r?.tree?.items)?.slice(0, 15),
readme:  (r?.readme ?? "").slice(0, 800),      // ~200 token
commits: (Array.isArray(r?.commits) ? r.commits : r?.commits?.items)
           ?.slice(0, 3)
           .map(c => ({ message: c.message?.slice(0, 100), sha: c.sha?.slice(0,7) })),
```

Toplam tahmini token: 5 × (15 item + 800 char + 3×100 char) ≈ 7-8K → güvenli.

#### Adım 5: Cache TTL ekle

```js
const PATTERN_CACHE_TTL_HOURS = parseInt(process.env.PATTERN_CACHE_TTL_HOURS || "72", 10);

// setCachedPatterns çağrısına TTL ekle:
await setCachedPatterns(username, patternsResult.patterns, PATTERN_CACHE_TTL_HOURS * 3600);
// → Redis TTL: 72 saat varsayılan, env var ile değiştirilebilir
```

#### Adım 6: Health endpoint ekle

```js
router.get("/health", async (_req, res) => {
  const redisOk = await checkRedisHealth(); // redis ping
  const llmOk   = !!process.env.OPENAI_API_KEY;
  const githubOk = !!process.env.GITHUB_TOKEN;

  const healthy = redisOk && llmOk && githubOk;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    status: healthy ? "healthy" : "degraded",
    checks: { redis: redisOk, llm: llmOk, github: githubOk },
  });
});
```

---

### Standardizasyon Kontrol Listesi

```
[x] callLLM() → routeTask("analysis", ...) — provider routing + timeout + fallback
[x] createMetadata() ekle (capabilities, requires dahil)
[x] createPluginErrorHandler() ekle
[x] auditLog() → analyze, invalidate, architecture-options endpoint'lerine
[x] /analyze GET → POST'a çevrildi (HTTP semantiği düzeltildi)
[x] LLM prompt'una token budget → truncateRepoForPrompt() ile per-repo sınır
[x] Cache TTL → core/redis.js PATTERN_CACHE_TTL_DAYS env var (varsayılan 7 gün)
[x] Health endpoint eklendi (/github-patterns/health)
[x] requireScope("read") → /analyze, /invalidate, /architecture-options
[x] JSON parse güvenli hale getirildi (markdown code fence strip)
[ ] En az 1 entegrasyon testi
```

### "Mükemmel" Tanımı

- `POST /github-patterns/analyze` → pattern analizi çalışıyor, Redis'e yazıyor, audit loglanıyor ✅
- `GET /github-patterns/architecture-options` → cached pattern'dan kişiselleştirilmiş mimari öneri üretiyor ✅
- Cache 7 gün sonra otomatik expire oluyor (`PATTERN_CACHE_TTL_DAYS` env var) ✅
- Büyük repo'larda bile LLM context overflow olmuyor (`truncateRepoForPrompt`) ✅
- `/health` → LLM key ve GitHub token durumunu gösteriyor ✅
- `routeTask()` sayesinde provider fallback ve timeout koruması var ✅
- LLM markdown code fence yanıtlarını güvenle parse ediliyor ✅

---

## Plugin 9: n8n ✅

**Güçlü yönler:** En iyi yapılandırılmış plugin (validate.js, write.js ayrı dosyalar), catalog cache sistemi iyi,
semantic workflow validator (orphan detection, connection checks), sticky note annotation, context endpoint (AI-first).

**Tamamlananlar:**
```
[x] createMetadata() → RiskLevel.HIGH (workflow deployment operasyonu)
[x] createPluginErrorHandler() → pluginError helper
[x] auditLog() → apply_workflow ve execute_workflow operasyonlarına
[x] Health endpoint → /n8n/health (apiKey, baseUrl, catalog durumu, writeEnabled)
[x] MCP tools eklendi (9 adet):
    - n8n_get_context     : tek çağrıda node schema + credentials + examples
    - n8n_search_nodes    : anahtar kelime ile node arama
    - n8n_get_node        : tam node şeması ve property'ler
    - n8n_validate_workflow: workflow'u apply etmeden önce doğrula
    - n8n_apply_workflow  : create/update/upsert (write guard + auto-validate)
    - n8n_execute_workflow: workflow'u tetikle (write guard)
    - n8n_get_execution   : execution sonucunu getir
    - n8n_list_examples   : örnek workflow'ları listele
    - n8n_refresh_catalog : node kataloğunu yenile
[ ] Test: catalog search, workflow validate, workflow apply (mock n8n API ile)
```

---

## Plugin 10: repo-intelligence ✅

**Güçlü yönler:** routeTask() zaten kullanılıyordu (dynamic import ile), MCP tools vardı, git log parsing ve TODO scanner sağlamdı.

**Tamamlananlar:**
```
[x] createMetadata() → RiskLevel.LOW, requires["OPENAI_API_KEY"] eklendi
[x] createPluginErrorHandler() → pluginError helper
[x] auditLog() → /repo/analyze ve /repo/summary endpoint'lerine
[x] Health endpoint → /repo/health (LLM key durumu + BASE_REPO_PATH gösteriyor)
[x] Path güvenliği → safeResolvePath() eklendi (repo.core.js)
    BASE_REPO_PATH = REPO_PATH env var | process.cwd()
    getRecentCommits / getProjectStructure / getOpenIssues hepsi path traversal'a karşı korunuyor
[x] Dynamic import → static import (getLLMRouter() kaldırıldı, per-call overhead gitti)
[x] REST route'lara Zod validation → pathQuerySchema, analyzeBodySchema
[x] LLM response parsing shared helper'a taşındı (parseAnalysis, fallbackAnalysis)
[x] Summary prompt token budget → keyFiles 1000 char, keyFile okuma 1000 char'a indirildi
[ ] Test: commits, structure, analyze endpoint'leri
```

---

## Plugin 11: project-orchestrator ✅

**Güçlü yönler:** En kapsamlı iş akışı. Fikir → AI analiz → Notion → Task zinciri.
3 fazlı interaktif flow (draft → select-architecture → execute), Redis draft storage, MCP tools.

**Tamamlananlar:**
```
[x] callLLM() → routeTask("analysis", ...) — provider routing + fallback
[x] 4 self-HTTP helper kaldırıldı (callTool, callNotion, callGit, callWorkspace)
    → callTool from core/tool-registry.js (notion_create_page, notion_create_task, github_pr_create)
    → direct Node.js fs ops (mkdir, writeFile) for codebase scaffold
[x] activeProjects in-memory Map → Redis (orch:project:{id}, 14 gün TTL)
[x] project_open_pr: GitHub issue açıyordu → github_pr_create tool kullanılıyor (gerçek PR)
[x] Dosya yazma path safety: safeWorkspacePath() ile WORKSPACE_BASE sınırı
    AI-generated "../../etc/evil" path'leri reddediliyor
[x] createMetadata() → RiskLevel.HIGH (dosya yaratma + GitHub + Notion)
[x] createPluginErrorHandler() → pluginError helper
[x] auditLog() → create_draft, select_architecture, execute_project, project_init
[x] health endpoint → LLM, Notion, GitHub, Redis, NOTION_TASK_DATABASE_ID durumu
[x] parseJSON() helper → markdown fence strip + regex JSON extract
[ ] Test: create project → analyze → notion task flow (mock ile)
```

---

## Plugin 7 (Sıra 12): brain ✅

**Vizyon:** Semantic Kernel'den ilham alan, Redis + RAG tabanlı kişisel AI hafıza motoru.
Kullanıcının kim olduğunu, projelerini, kararlarını ve dosya sistemini hatırlar.
Tüm plugin'lere "context" sağlayan ortak zemin katmanı.

**Mimari (3 dosya):**
- `brain.memory.js` — Redis CRUD: profile, episodic memories, project registry, session, FS snapshot
- `brain.context.js` — LLM system prompt için context assembler
- `index.js` — REST routes + 9 MCP tool

**Tamamlananlar:**
```
[x] brain.memory.js
    getProfile / updateProfile     → Redis Hash (brain:profile)
    addMemory / listMemories / deleteMemory → Redis String + Set index (brain:mem:*)
      - type: fact | decision | preference | event | project_note
      - tags, projectId, importance (0-1), source (user|agent|system)
      - TTL: BRAIN_MEM_TTL_DAYS (default 365 gün)
      - Stale entry auto-cleanup (expired TTL'ler index'ten temizleniyor)
    registerProject / getProject / updateProject / listProjects → Redis Hash (brain:project:*)
      - slug = auto-generated from name
      - fields: path, stack, status, description, githubRepo, notionPageId
    getSession / setSession / clearSession → Redis String (brain:session:*)
      - TTL: BRAIN_SESSION_TTL_HOURS (default 24h)
    setFsSnapshot / getFsSnapshot → Redis String (no TTL, survives restarts)

[x] brain.context.js
    buildContext({ task, projectId, includeFs, maxMemories })
      → profile + project(ler) + memories → markdown contextBlock
    buildCompactContext({ ...opts, maxChars })
      → truncated single string for system prompt injection
    formatProfile / formatProject / formatProjectList / formatMemories / formatFs helpers

[x] index.js — createMetadata() + createPluginErrorHandler() + auditLog() + requireScope()
    REST: GET/PUT /brain/profile
    REST: GET/POST/DELETE /brain/memories
    REST: GET/POST/PATCH /brain/projects
    REST: POST /brain/context
    REST: POST /brain/index-filesystem
    REST: POST /brain/summarize-session
    GET /brain/health → Redis + LLM key status

[x] v2.1 — 14 ek düzeltme uygulandı:
    fix-1  brain_search_files   — brain-fs RAG workspace'i sorgulanabilir
    fix-2  Delete→RAG sync      — deleteMemoryWithRagSync() her silmede RAG'ı da temizliyor
    fix-3  brain_update_memory  — içerik/importance/confidence güncellenebilir + RAG re-index
    fix-4  Deduplication        — brain_remember öncesi %88 eşik ile similarity check, duplicate güncelleniyor
    fix-5  brain_forget         — query veya ID'lerle bulk delete (dryRun: true ile önizleme)
    fix-6  brain_analyze_habits — LLM ile preference/decision memory'lerinden alışkanlık çıkarımı
                                   + saveAsMemory=true ile otomatik kayıt + deduplication koruması
    fix-7  brain_what_do_you_know_about — memories+FS+projects birleştirip LLM synthesis
    fix-8  GET /brain/stats + brain_get_stats — namespace/memory/project/FS istatistikleri
    fix-9  brain_recall ranking — semantic×0.5 + importance×0.3 + recency×0.2
    fix-10 confidence field     — memory'lere 0-1 kesinlik skoru eklendi
    fix-11 Importance decay     — decayedImportance(importance, createdAt), 180 günde %50 düşüş
                                   listMemories + buildContext'te etkin, eski anılar alta iniyor
    fix-12 Pagination           — listMemories({ limit, offset }) + REST ?limit=&offset=
    fix-13 brain_list_sessions  — session özetlerini chronological listele
    fix-14 Multi-tenant NS      — BRAIN_NAMESPACE env var, tüm Redis key'ler brain:{NS}:* formatında

[x] 16 MCP Tool (9 + 7 yeni):
    brain_remember, brain_recall, brain_get_context, brain_update_profile, brain_get_profile
    brain_register_project, brain_get_projects, brain_index_filesystem, brain_summarize_session
    brain_search_files, brain_update_memory, brain_forget, brain_analyze_habits,
    brain_what_do_you_know_about, brain_get_stats, brain_list_sessions

[x] REST: PATCH /brain/memories/:id, GET /brain/stats, GET /brain/memories?offset=
[x] routeTask() dönüş parse tutarlılaştırıldı (dead code kaldırıldı)
[x] countMemories() gereksiz export kaldırıldı
[ ] Test: remember → recall flow, profile CRUD, context assembly
```

---

## Sonraki Adım

**Tüm 11+1 plugin tamamlandı:**
llm-router ✅ · notion ✅ · github ✅ · database ✅ · shell ✅ · rag ✅ · github-pattern-analyzer ✅ · n8n ✅ · repo-intelligence ✅ · project-orchestrator ✅ · brain ✅

**Önerilen sıradaki adımlar:**
1. Integration test suite (plugin'ler arası flow testleri)
2. `brain_update_profile` ile kullanıcı profili doldur → `brain_get_context` ile doğrula
3. Tüm aktif projeleri `brain_register_project` ile kaydet
4. `brain_index_filesystem` ile workspace dizinleri index'le
5. Orta/zayıf plugin'leri sırayla geliştir (events, aws-s3, mssql, vb.)

---

*Son güncelleme: 2026-03-11*
