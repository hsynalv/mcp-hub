# AI-Hub Platform Standartları — 10 PR Roadmap

Bu plan, AI-Hub’ı tek tip API contract + güvenlik/policy + gözlemlenebilirlik + test/CI + dokümantasyon standardına taşıyan 10 PR’ı, hızlı “pro” hissi verecek öncelik sırasıyla uygular.

## Mevcut Durum (Kısa Harita)

- **RequestId**: `src/core/audit.js` zaten `x-request-id` üretip `req.requestId` atıyor ve response header basıyor.
- **Project context**: `src/core/server.js` içinde `x-project-id` ve `x-env` okunup `req.projectId` / `req.projectEnv` set ediliyor (şu an block etmiyor).
- **Auth + scopes**: `src/core/auth.js` zaten `Authorization: Bearer ...` + scope hiyerarşisi (`read/write/danger`) destekliyor, ancak “secure-by-default” değil (key yoksa open mode).
- **Error handling**: `src/core/server.js` global error handler var; `AppError.serialize()` bugünkü formatı `{ ok:false, error, message, details?, requestId? }`.
- **Response contract**: Plugin’ler karışık formatlar dönüyor (bazıları `{ok:true, ...}`, bazıları `data` alanı yok), `/plugins` endpoint’i direkt array dönüyor.
- **Policy**: `plugins/policy` evaluate + approvals var, ancak write aksiyonlarda “core guardrail” olarak enforce edilmiyor.
- **Observability/Audit**: `auditMiddleware` var, ama metrikler/prometheus/audit JSON standardı ve policy decision metriği yok.

---

## PR-0 (Minimum başlangıç) — `docs/STANDARDS.md`

### Neden
- PR-2..PR-10 boyunca herkesin aynı dili konuşması için “tek kaynak” dokümanı gerekir.

### Ne çıkacak
- `docs/STANDARDS.md` içinde:
  - Response Envelope
  - Error Codes
  - Header contract (`x-request-id`, `x-project-id`, `x-env`)
  - Scopes (`read/write/admin`)
  - Tool tags (`READ/WRITE/BULK/DESTRUCTIVE`)
  - Policy defaults (default allow/block/approval)

### PR kapsamı
- **Sadece dokümantasyon**: `mcp-server/docs/STANDARDS.md` (ve gerekiyorsa README linki).

### `docs/STANDARDS.md` Taslak İçerik (Netleşmiş Spec)

#### Response Envelope
- **Success**
  ```json
  {"ok": true, "data": {}, "meta": {"requestId": "..."}}
  ```
- **Error**
  ```json
  {
    "ok": false,
    "error": {"code": "validation_error", "message": "...", "details": {}},
    "meta": {"requestId": "..."}
  }
  ```

#### Error Codes (minimum set)
- `validation_error`
- `invalid_request`
- `unauthorized`
- `forbidden`
- `not_found`
- `rate_limited`
- `policy_blocked`
- `approval_required`
- `dry_run_required`
- `upstream_error`
- `internal_error`

#### Headers
- `x-request-id`: client göndermezse server üretir. Her response’ta geri döner.
- `x-project-id`: **zorunlu** (write ve “project-scoped read” için). 
- `x-env`: **zorunlu** (`dev|staging|prod`). Varsayılan yok; eksikse block.

#### Scopes
- `read`: safe read endpoints
- `write`: state-changing endpoints
- `admin`: high-risk/dangerous ops

> Not: Kodda bugün `danger` var. PR-4’te `admin` isimlendirmesine align edilecek veya alias desteklenecek.

#### Tool tags
- `READ`: state değiştirmez
- `WRITE`: state değiştirir
- `BULK`: çoklu kayıt etkiler
- `DESTRUCTIVE`: silme/move/archive gibi geri dönüşü zor işlemler

#### Policy defaults (önerilen)
- Default:
  - `READ`: allow
  - `WRITE`: allow (dev/staging) / require_approval (prod)
  - `BULK` veya `DESTRUCTIVE`: require_approval (her env)
- Özel öneriler:
  - `n8n.workflow.apply`: `dry_run_first` + prod approval
  - `db write`: default block
  - `file delete/move`: approval
  - `github write`: approval

---

## PR-1 — Proje standartları (format, lint, type safety, precommit)

### Neden
- Plugin sayısı büyüdükçe stil farkları ve küçük hatalar hız keser; CI “quality gate” şart.

### Ne çıkacak
- ESLint + Prettier + EditorConfig
- Husky + lint-staged
- Node sürüm sabitleme (`.nvmrc` + `engines`)
- CI’de lint/format/test gate

### PR kapsamı
- Repo root:
  - `.editorconfig`
  - `.eslintrc.cjs`
  - `.prettierrc`
  - `.nvmrc`
  - `package.json` (scripts + engines)
  - `.github/workflows/ci.yml`
  - `.husky/` + `lint-staged` config

---

## PR-2 — Tek tip API sözleşmesi (Envelope + Error Model + RequestId)

### Neden
- Agent/CLI/UI fark etmeksizin response parse etmek kolaylaşır.
- Debug için requestId altın.

### Ne çıkacak
- Tüm endpoint’ler tek format:
  - Success: `{ ok:true, data, meta:{ requestId } }`
  - Error: `{ ok:false, error:{ code, message, details? }, meta:{ requestId } }`
- `x-request-id` middleware (zaten var): standarda align
- Global error handler: plugin içinde `throw` → envelope error
- “Legacy” response’ları core katmanda normalize etme (plugin koduna minimum dokunuş)

### PR kapsamı
- `src/core/server.js`
  - response envelope middleware (wrap `res.json`)
  - error handler: `AppError.serialize()` yeni modele uyum
  - `/health`, `/plugins` gibi core endpoint’leri de envelope’a sok
- `src/core/errors.js`
  - `serialize()` çıktısını `{ error:{code,message,details}, meta:{requestId}}` şekline çek
- `src/core/audit.js`
  - responseSummary extraction: yeni envelope’dan `error.code` okuyacak şekilde güncelle

Not: Bu PR’ın hedefi “plugin’lere dokunmadan” minimum uyumluluk. Bazı plugin’lerin döndürdüğü şekiller `data` altında wrap edilecek.

---

## PR-3 — Input validation standardı (Zod) + schema-first endpoints

### Neden
- AI agent’lar yanlış parametre ile gelir; en pahalı bug sınıfı.

### Ne çıkacak
- `src/core/validate.js`: `validateBody(schema)`, `validateQuery(schema)` middleware
- Kritik endpoint’lerde minimum schema coverage
- Validation error’ları PR-2 error model ile standardize

### PR kapsamı
- Core:
  - `src/core/validate.js`
- Plugin güncellemeleri (minimum hedef):
  - `http`: `/http/request`
  - `openapi`: spec load/parse endpoint’leri
  - `notion`: create/setup-project, row create
  - `github`: analyze, file fetch gibi kritik
  - `database`: query/execute gibi kritik
  - `file-storage`: upload/download/delete kritik

---

## PR-4 — Auth + Scopes + Project context standardı

### Neden
- Yanlış projeye yazma felaket. Multi-client (Cursor/Claude/n8n) dünyasında “secure default” şart.

### Ne çıkacak
- `Authorization: Bearer <token>` tek giriş noktası (x-hub-api-key fallback opsiyonel ama deprecated)
- Scope sistemi: `read/write/admin`
- `x-project-id` + `x-env` **yoksa block** (en az write için; tercihen tüm project-scoped endpoint’ler)
- `GET /whoami`: token var mı, scope nedir, project/env nedir

### PR kapsamı
- `src/core/auth.js`
  - `danger` → `admin` naming align (alias/compat)
  - actor identity shape: `req.actor = { scopes, keyId? }` (keyId hashed)
- `src/core/server.js`
  - project/env enforcement middleware
  - `GET /whoami`
- Dokümantasyon: STANDARDS link update

---

## PR-5 — Policy engine enforce + approval queue

### Neden
- “J4RV1S beyni” için kontrol mekanizması kritik. Write aksiyonlar guardrail’siz olmaz.

### Ne çıkacak
- `policy/presets.json` startup’ta yüklenebilir (preset load opsiyonu)
- Her request için core katmanda:
  1. `policy.evaluate(ctx, tool)`
  2. `allow | block | require_approval | dry_run_first`
- Approval queue standard endpoint’leri:
  - `POST /policy/approvals/request`
  - `POST /policy/approvals/:id/approve`
  - `GET /policy/approvals`

### PR kapsamı
- Core middleware: request → tool id mapping (`plugin + route + method`)
- Policy plugin:
  - presets startup load API + store integration
  - approval request endpoint (bugün approve/reject/list var; request yok)
- Default rules:
  - `n8n.workflow.apply` → dry-run + prod approval
  - destructive/bulk file ops → approval
  - db write → block

---

## PR-6 — Observability: metrics + audit + structured logs

### Neden
- Bir şey bozulduğunda “kim/ne/nerede”yi saniyeler içinde görmek gerekir.

### Ne çıkacak
- Prometheus metrics:
  - `requests_total{plugin,route,status}`
  - `request_duration_ms_bucket{plugin,route}`
  - `policy_decisions_total{decision}`
  - `cache_hit_total{plugin}`
- Audit JSON standardı:
  - `{ ts, requestId, actor, project, env, plugin, action, decision, durationMs, status }`
- `/observability/health`, `/observability/metrics`, `/observability/errors`

### PR kapsamı
- `src/core/audit.js`: audit schema + JSON log output
- New core metrics module (prom client)
- Observability plugin’ini core standarda bağlama

---

## PR-7 — Caching & rate limit standardı (tek library)

### Neden
- External API limit/bans durumunda sistemin kendini çökertmemesi gerekir.

### Ne çıkacak
- `src/core/cache/`: disk TTL + opsiyonel stale-while-revalidate
- `src/core/ratelimit/`: token bucket
- Plugin’ler bunu kullanır (Notion/GitHub/n8n: retry/backoff)

### PR kapsamı
- Core cache + ratelimit modülleri
- HTTP/Notion/GitHub/N8N plugin refactor (minimal)

---

## PR-8 — Plugin manifest strict + self-doc endpoint

### Neden
- Tool discovery (Cursor/Claude) ve future MCP adapter için “registry” gerekir.

### Ne çıkacak
- Plugin export standardı:
  - `manifest: { name, version, description, endpoints:[{method,path,scope,tags,requestSchema,responseSchema,examples}] }`
- `/plugins` bunu döner
- `/openapi.json` (hub’ın kendi OpenAPI’si) otomatik üretim

### PR kapsamı
- `src/core/plugins.js`: manifest validation + defaulting
- Plugin’lerde manifest’e geçiş (kademeli)
- OpenAPI generator (core)

---

## PR-9 — Tests: smoke + contract + golden tests

### Neden
- Plugin ekledikçe regresyon yememek için.

### Ne çıkacak
- Vitest (veya Jest) setup
- Smoke test: server boots + `/health`
- Contract tests: her plugin en az 1 endpoint
- Golden tests:
  - openapi parsing
  - policy decisions
  - secrets redaction

### PR kapsamı
- Test runner + CI entegrasyonu
- Test fixtures + minimal mocks

---

## PR-10 — Deployment: Docker + config hardening

### Neden
- Production’da güvenli default + healthcheck + config sanity check gerekir.

### Ne çıkacak
- Multi-stage Dockerfile
- `HEALTHCHECK`
- Startup env sanity check (missing env list)
- Secure defaults:
  - n8n plugin’leri default off
  - secrets resolve sadece allowlist tool’lar

### PR kapsamı
- `mcp-server/Dockerfile` (multi-stage)
- Startup config validation
- Docs updates

---

## Sıralama (Hızlı “pro” hissi)

1. PR-2 (contract + errors + requestId)
2. PR-3 (validation)
3. PR-4 (auth + scopes + project ctx)
4. PR-5 (policy enforce + approval)
5. PR-6 (observability)
6. PR-1 (lint/format/CI) — istersen PR-2 öncesi de alınabilir
7. PR-7 (cache/ratelimit)
8. PR-8 (manifest + openapi)
9. PR-9 (tests)
10. PR-10 (deploy hardening)
