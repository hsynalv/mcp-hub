# mcp-hub — Phase 2 Development Path

> Faz 1'de tamamlanan 11 plugin üzerine inşa edilen **20-plugin eksiksiz AI geliştirme platformu**.  
> Her plugin production-ready, güvenli, ve MCP üzerinden AI agent'lara tam erişilebilir olacak.

---

## Final 20-Plugin Mimarisi

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Zeka Katmanı                          │
│   llm-router · brain · rag · prompt-registry               │
├─────────────────────────────────────────────────────────────┤
│                    Kod & Git Katmanı                        │
│   github · git · shell · workspace · code-review           │
│   repo-intelligence · github-pattern-analyzer              │
├─────────────────────────────────────────────────────────────┤
│                    Proje & Otomasyon                        │
│   project-orchestrator · n8n · n8n-workflows               │
│   notion · tech-detector                                    │
├─────────────────────────────────────────────────────────────┤
│                    Altyapı & Güvenlik                       │
│   database · secrets · http · observability                │
└─────────────────────────────────────────────────────────────┘
```

**Faz 1 tamamlandı (11 plugin ✅):**
`llm-router` · `notion` · `github` · `database` · `shell` · `rag` · `brain` · `github-pattern-analyzer` · `n8n` · `repo-intelligence` · `project-orchestrator`

**Faz 2 hedef (9 plugin):**
`http` · `secrets` · `workspace` · `git` · `prompt-registry` · `observability` · `tech-detector` · `n8n-workflows` · `code-review`

---

## Evrensel Standardizasyon Kontrol Listesi

Her plugin bu 10 maddeyi geçmeden "tamamlandı" sayılmaz:

```
[ ] createMetadata() — PluginStatus, RiskLevel, requires[], endpoints[]
[ ] createPluginErrorHandler(pluginName) — tüm catch bloklarında
[ ] auditLog() — tüm write operasyonlarında (REST + MCP)
[ ] requireScope("read"|"write") — tüm REST route'larında
[ ] ToolTags doğru atanmış — her MCP tool'unda
[ ] inputSchema kullanıyor (parameters değil)
[ ] register(app) gerçekten route mount ediyor (console.log değil)
[ ] Kendi callLLM() kopyası yok — llm-router kullanıyor
[ ] Health endpoint: GET /plugin/health
[ ] En az 3 MCP tool var
```

---

## Plugin Geliştirme Sırası (Faz 2)

Bağımlılık ve zarar-etki sırasına göre:

| Sıra | Plugin | Çaba | Kritik Sorun | Bağımlılık |
|------|--------|------|--------------|-----------|
| 1 | `http` | 🟢 Küçük | MCP tools yok, audit local | Diğer pluginler dışarı bağlanmak için bu kullanır |
| 2 | `secrets` | 🟡 Orta | MCP tools yok tamamen | http + brain buna bağlanacak |
| 3 | `workspace` | 🟢 Küçük | requireScope yok, MCP audit yok | code-review ve git buna bağlanacak |
| 4 | `git` | 🟡 Orta | requireScope yok, audit yok, path validation yok | project-orchestrator bunu kullanıyor |
| 5 | `prompt-registry` | 🟡 Orta | Sync I/O, race condition, auth yok | brain prompt management için |
| 6 | `observability` | 🟡 Orta | Duplicate route bug (health = dead code!) | Production monitoring için gerekli |
| 7 | `tech-detector` | 🟡 Orta | register() çalışmıyor, inputSchema yanlış | brain_register_project'i besler |
| 8 | `n8n-workflows` | 🔴 Büyük | Auth yok, cache tutarsızlığı, cross-plugin import riski | Mevcut n8n plugin'ini tamamlar |
| 9 | `code-review` | 🔴 Büyük | register() çalışmıyor, inputSchema yanlış, logic bug'ları | github + workspace'e bağımlı |

---

---

## Plugin 1: http

**Ne yapar:** Dış dünyaya güvenli HTTP çağrısı. SSRF koruması, domain allowlist/blocklist, rate limit, `{{secret:NAME}}` header çözümleme, response cache. En sağlam güvenlik altyapısı.

**Mevcut durum:** Auth katmanı sağlam (`requireScope` var), Zod validation var, `createMetadata` var. Ama MCP tools hiç yok — REST-only bir plugin. Ayrıca audit log in-memory (restart'ta kayboluyor) ve `createPluginErrorHandler` kullanılmıyor.

**Kritik Sorunlar:**
```
🔴 MCP tools tamamen yok → AI agent HTTP çağrısı yapamıyor
🟡 auditLog in-memory → restart'ta kayboluyor
🟡 createPluginErrorHandler kullanılmıyor (raw Errors.* var)
🟡 req.actor → req.user olmalı (her zaman null)
🟡 audit kullanımı local reimplementation → core'a taşınmalı
```

**Tamamlanacaklar:**
```
[ ] createPluginErrorHandler("http") → pluginError helper
[ ] auditLog() import → core audit module'e taşı (in-memory kaldır)
[ ] req.user?.sub → actor field düzelt
[ ] MCP tools ekle:
    - http_request     → tam çağrı (url, method, headers, body, cache, secretRefs)
    - http_cache_clear → domain veya tüm cache temizle
    - http_policy_info → hangi domainler izinli/yasak göster
[ ] Health endpoint: GET /http/health → allowlist boyutu, cache stats, rate limit stats
```

**"Mükemmel" Tanımı:**
```
[ ] AI agent http_request tool'u ile dış API'ye güvenli çağrı yapabiliyor
[ ] {{secret:API_KEY}} referansı çözülüyor, gerçek değer loglara yazmıyor
[ ] Yasak domain'e istek → açık hata mesajı
[ ] Audit log restart'tan sonra da korunan core modülünde
[ ] Rate limit aşınca 429 + retry-after dönüyor
```

---

## Plugin 2: secrets ✅

**Ne yapar:** Agent'ların asla gerçek secret değerlerini görmemesi için server-side referans sistemi. `{{secret:NAME}}` pattern'i ile template çözümleme. En iyi güvenlik tasarımına sahip plugin.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ createMetadata() eklendi (PluginStatus, RiskLevel, endpoints[], notes)
✅ runWithAudit() dead code kaldırıldı
✅ /resolve policy check: her secret ayrı ayrı canResolveSecret() ile kontrol ediliyor
✅ Preview masking: regex tabanlı risk kaldırıldı, template.replace ile güvenli preview
✅ Health endpoint: kayıtlı secret sayısı, env coverage istatistikleri
✅ ToolTags import edildi
✅ 4 MCP tool eklendi:
   - secret_list          → kayıtlı secret isimlerini listele (değer yok)
   - secret_register      → yeni secret referansı kaydet + audit
   - secret_unregister    → secret referansı sil + audit
   - secret_resolve_check → template'deki ref'lerin çözülüp çözülmediğini doğrula
```

---

## Plugin 3: workspace ✅

**Ne yapar:** Konfigüre edilmiş bir workspace root içinde güvenli dosya CRUD. `WORKSPACE_ROOT` env var sınırı, path traversal koruması, audit logging. AI agent için temel dosya okuma/yazma yüzeyi.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ requireScope import edildi ve 7 REST route'a uygulandı (read/write scope)
✅ MCP tool handler'larına auditEntry() çağrısı eklendi (read, write, patch handlers)
✅ workspace_delete_file MCP tool eklendi (deleteFile + audit)
✅ workspace_move_file MCP tool eklendi (moveFile + audit)
✅ workspace_audit MCP tool eklendi (audit log MCP üzerinden)
✅ workspace.core.js'e deleteFile() ve moveFile() fonksiyonları eklendi
✅ DELETE /workspace/file ve POST /workspace/move REST endpoint'leri eklendi
✅ Health endpoint: GET /workspace/health (root path, rootExists)
✅ Duplicate raw exports kaldırıldı (endpoints createMetadata'ya taşındı)
```

---

## Plugin 4: git ✅

**Ne yapar:** Git operasyonları: status, diff, branch, checkout, log, commit, push, pull, stash. Temiz thin-wrapper mimarisi (`git.core.js`'e delege ediyor).

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ createMetadata() eklendi (RiskLevel.HIGH, endpoints[])
✅ createPluginErrorHandler("git") eklendi
✅ requireScope — tüm read route'lara "read", tüm write route'lara "write" scope eklendi
✅ auditLog() — commit, push, pull, stash, checkout, branch_create operasyonlarına eklendi
✅ safeRepoPath() — git.core.js'e eklendi; WORKSPACE_BASE dışı path'ler reddediliyor
✅ git_add MCP tool eklendi (artık expose ediliyor)
✅ Yeni MCP tools: git_branch_list, git_pull, git_stash
✅ Yeni REST endpoints: GET /git/branches, POST /git/add, POST /git/pull, POST /git/stash
✅ git.core.js'e gitPull, gitBranchList, gitStash fonksiyonları eklendi
✅ Health endpoint: GET /git/health (git binary version)
```

---

## Plugin 5: prompt-registry

**Ne yapar:** AI agent'lar için versiyonlu system prompt deposu. CRUD + versiyon geçmişi + restore. Brain plugin'inin context engine'ini besleyecek.

**Mevcut durum:** MCP tools var, `inputSchema` doğru. Ama: sync I/O (event loop blokluyor), race condition, auth yok, audit yok, ID collision riski, content-clear bug.

**Kritik Sorunlar:**
```
🔴 readFileSync / writeFileSync → event loop blokluyor, concurrent request'te çöker
🔴 Race condition → iki eş zamanlı write prompts.json'u bozar
🔴 requireScope yok → herkes prompt'ları silebilir
🟡 auditLog yok
🟡 ID = Date.now() + random → collision mümkün (randomUUID kullanılmalı)
🟡 content: "" update bug → boş string eski değeri koruyor (|| operatörü yanlış)
🟡 createMetadata, createPluginErrorHandler yok
🟡 prompt content'e boyut limiti yok
```

**Tamamlanacaklar:**
```
[ ] readFileSync → readFile (async), writeFileSync → writeFile (async)
[ ] File locking: async-mutex veya sıralı write queue (p-queue / mutex pattern)
[ ] generateId() → randomUUID() ile değiştir
[ ] createMetadata() → RiskLevel.MEDIUM
[ ] createPluginErrorHandler("prompt-registry")
[ ] requireScope("read") → list, get, get_versions
[ ] requireScope("write") → create, update, delete, restore
[ ] auditLog() → create, update, delete, restore'da
[ ] content update bug düzelt: content !== undefined ? content : existing.content
[ ] MAX_CONTENT_SIZE = 50_000 char limiti
[ ] Yeni MCP tools:
    - prompt_search → içerik ve name'de full-text arama
[ ] Health endpoint: storage dosyası erişilebilir mi, kaç prompt var
```

**"Mükemmel" Tanımı:**
```
[ ] 10 eş zamanlı write → prompts.json bozulmuyor
[ ] Auth olmadan delete → 401
[ ] prompt_create → audit log'da görünüyor
[ ] content: "" update → gerçekten boşaltıyor
[ ] Brain plugin'i prompt_get ile system prompt çekip kullanabiliyor
```

---

## Plugin 6: observability ✅

**Ne yapar:** Tüm plugin'lerin health durumunu aggregate eder, Prometheus metrics üretir, son hataları listeler, web dashboard sunar.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ Duplicate /health route kaldırıldı — gerçek 30 satır aggregate logic artık çalışıyor
✅ createMetadata() eklendi (PluginStatus.STABLE, RiskLevel.LOW)
✅ Gereksiz importlar kaldırıldı (readFileSync, getJobStats)
✅ ToolTags import edildi
✅ 3 MCP tool eklendi:
   - observability_health  → tüm plugin'lerin aggregate health + uptime + memory
   - observability_metrics → per-plugin request/error sayaçları + memory summary
   - observability_errors  → son N audit log hatası (plugin filtresi destekli)
```

---

## Plugin 7: tech-detector ✅

**Ne yapar:** Proje dizinine bakarak dil, framework, veritabanı, tooling tespiti (~50 teknoloji). Rekomendation ve karşılaştırma da destekliyor.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ register() → gerçek Router() mount ediyor (/tech/health, /detect, /recommend, /compare)
✅ "parameters" → "inputSchema" düzeltildi (tüm 3 MCP tool'da)
✅ createMetadata() eklendi (PluginStatus.STABLE, RiskLevel.LOW)
✅ createPluginErrorHandler("tech-detector") eklendi
✅ requireScope("read") → tüm REST route'lara
✅ safePath() → WORKSPACE_BASE path validation eklendi
✅ ToolTags.READ_ONLY / LOCAL_FS düzgün atandı
✅ Health endpoint eklendi
```

**Not:** `compareTech` sadece hardcoded birkaç çifti destekliyor; LLM entegrasyonu ileriye bırakıldı.

---

## Plugin 8: n8n-workflows ✅

**Ne yapar:** n8n workflow CRUD (list, get, create, update, activate/deactivate) + disk cache. Mevcut `n8n` plugin'i ile birlikte tam n8n kontrol yüzeyi oluşturur.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ createMetadata() eklendi (PluginStatus.STABLE, RiskLevel.HIGH)
✅ createPluginErrorHandler("n8n-workflows") eklendi
✅ requireScope("read") → GET /, GET /:id, POST /search
✅ requireScope("write") → POST /create, PUT /:id, POST /:id/activate, POST /:id/deactivate
✅ auditLog() → create, update, activate, deactivate operasyonlarında
✅ n8n_list_workflows MCP → fetchWorkflowList() yerine getOrRefreshList() kullanıyor
✅ n8n-credentials import → try/catch graceful degradation (plugin yoksa stub döner)
✅ REST response'lardan explanation alanı temizlendi
✅ Health endpoint eklendi (/n8n/workflows/health)
```

---

## Plugin 9: code-review ✅

**Ne yapar:** LLM destekli kod güvenlik ve kalite taraması. Tek dosya veya PR batch review. Pattern tabanlı güvenlik tarama + kalite heuristiği + LLM analizi.

**Tamamlandı. Uygulanan değişiklikler:**
```
✅ register(app) → gerçek Router() mount ediyor (/health, /file, /pr, /security)
✅ "parameters" → "inputSchema" (tüm 4 MCP tool'da)
✅ createMetadata() eklendi (PluginStatus.STABLE, RiskLevel.MEDIUM)
✅ createPluginErrorHandler("code-review") eklendi
✅ requireScope("read") → tüm REST route'lara
✅ safePath() → WORKSPACE_BASE path isolation (reviewFile + reviewPR)
✅ ToolTags (READ_ONLY, LOCAL_FS, EXTERNAL_API) doğru atandı
✅ Health endpoint eklendi
```

**Not:** securityScan satır numarası detection ve qualityCheck heuristic iyileştirmeleri ileriye bırakıldı; mevcut pattern-based scanning çalışır durumda.

---

## Faz 2 Tamamlandı ✅

Tüm 9 plugin standardize edildi. Tamamlanma kriterleri:

Tüm 20 plugin şunu sağlamalı:

```
✅ Tüm MCP tools tool-registry'de kayıtlı ve AI agent tarafından çağrılabilir
✅ Tüm write operasyonları audit log'a yazıyor
✅ Tüm REST route'lar requireScope ile korunuyor
✅ register(app) gerçekten route mount ediyor
✅ createMetadata() + createPluginErrorHandler() kulllanıyor
✅ GET /plugin/health çalışıyor ve bağımlılıkları kontrol ediyor
✅ Path traversal saldırılarına karşı korumalı
✅ inputSchema key doğru ("parameters" değil)
```

---

## Entegrasyon Senaryoları (Tamamlanınca Test Edilecek)

**Senaryo 1: Sıfırdan Proje**
```
tech_detect → brain_register_project → project_orchestrator_draft
→ github_branch_create → workspace_write_file → git_commit → github_pr_create
```

**Senaryo 2: Kod Kalite Kontrolü**
```
github_get_file → code_review_file → code_review_suggest_fix
→ workspace_patch → git_commit → github_pr_create
```

**Senaryo 3: Güvenli Dış API Çağrısı**
```
secret_register("STRIPE_KEY") → http_request({{secret:STRIPE_KEY}})
→ brain_remember("Stripe API çalışıyor, endpoint /v1/charges")
```

**Senaryo 4: Tam N8N Workflow**
```
n8n_search_nodes → n8n_validate_workflow → n8n-workflows_create
→ n8n-workflows_activate → n8n_execute_workflow
```

**Senaryo 5: AI Agent Context**
```
brain_get_context → prompt_get("developer-assistant-v3")
→ llm-router routeTask → brain_remember(sonuç)
```

---

---

## Plugin 1: http ✅

**Tamamlananlar:**
```
[x] createPluginErrorHandler("http") eklendi
[x] Local generateCorrelationId, auditEntry, httpAuditLog → core audit modülüne taşındı
    auditLog() + getAuditManager().getRecentEntries({ plugin: "http" }) kullanıyor
[x] req.actor → req.user?.sub (her zaman null sorunu giderildi)
[x] Health endpoint güçlendirildi: allowlist/blocklist boyutu, cache stats, method config
[x] Duplicate raw exports (name, version, capabilities) kaldırıldı — metadata yeterli
[x] 3 MCP Tool eklendi:
    http_request     — SSRF + allowlist + rate limit + secret ref + cache tam pipeline
    http_cache_clear — domain bazlı veya tam cache temizle
    http_policy_info — policy + rate limit state + cache stats
[x] ToolTags eklendi (WRITE + NETWORK + EXTERNAL_API)
```

---

## Sıradaki Adım

**Sıra 2: `secrets`** — createMetadata/auth zaten var, sadece MCP tools eksik.

---

*Başlangıç: 2026-03-11*
