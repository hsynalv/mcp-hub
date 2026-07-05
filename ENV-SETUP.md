# MCP Hub — Ortam Değişkenleri (ENV) Kurulum Rehberi

Bu rehber, hub’ı ilk kez ayağa kaldırırken **hangi değerlerin nerede olacağını**, **nereden alınacağını** ve **nasıl girileceğini** anlatır.

---

## Dosya nerede?

| Ortam | Dosya yolu |
|--------|------------|
| Geliştirme / production | `mcp-server/.env` |
| Şablon (kopyala-yapıştır) | `mcp-server/.env.example` |

```bash
cd mcp-server
cp .env.example .env
# .env dosyasını düzenle
npm run dev:all   # API :8787 + UI :5173
```

> **Önemli:** Ana repo kökünde (`mcp-hub/`) değil, **`mcp-server/`** altında `.env` kullanılır. Sunucu bu dosyayı `dotenv` ile yükler.

---

## İki katmanlı yapı

```text
┌─────────────────────────────────────────────────────────────┐
│ 1) BOOTSTRAP — mutlaka mcp-server/.env içinde (sunucu açılmadan) │
│    PORT, HUB_*_KEY, HUB_MSSQL_URL, HUB_SETTINGS_MASTER_KEY, seed │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2) ENTEGRASYONLAR — .env VEYA UI (/settings → Entegrasyonlar) │
│    OpenAI, GitHub, Notion, n8n, Telegram, …                  │
│    (MSSQL’e şifreli kaydedilir; restart gerektirmeyenler hot-reload) │
└─────────────────────────────────────────────────────────────┘
```

**Kural:** `HUB_READ_KEY`, `HUB_WRITE_KEY`, `HUB_ADMIN_KEY`, `HUB_MSSQL_URL`, `HUB_SETTINGS_MASTER_KEY` **yalnızca `.env`**’den okunur; Settings UI’a yazılamaz.

---

## 1. Bootstrap — zorunlu (.env)

### Sunucu

| Değişken | Örnek | Nasıl alınır / girilir |
|----------|--------|-------------------------|
| `PORT` | `8787` | API portu. Değiştirmezsen 8787 kullan. |
| `NODE_ENV` | `development` | Lokal: `development`, prod: `production`. |

### API anahtarları (hub’a kim erişir?)

Üç ayrı scope üret. **Rastgele, uzun string** olmalı (en az 32 karakter).

```bash
# macOS / Linux — örnek üretim
openssl rand -base64 32   # READ veya WRITE için
openssl rand -base64 48   # ADMIN için (daha güçlü)
```

| Değişken | Scope | Kim kullanır |
|----------|--------|----------------|
| `HUB_READ_KEY` | `read` | UI listeleme, chat read-only, GET istekleri |
| `HUB_WRITE_KEY` | `write` | Tool çalıştırma, workflow, runbook execute |
| `HUB_ADMIN_KEY` | `admin` | Force runbook, policy bypass, yönetim |

**.env’e gir:**

```env
HUB_READ_KEY=buraya-openssl-ciktisi
HUB_WRITE_KEY=buraya-baska-bir-openssl-ciktisi
HUB_ADMIN_KEY=buraya-admin-openssl-ciktisi
```

**Cursor / frontend:** Giriş yaptıktan sonra veya local dev’de Settings’te API key alanına genelde `HUB_WRITE_KEY` veya login sonrası session kullanılır.

### Persistence (chat, settings, kullanıcılar)

| Değişken | Örnek | Nasıl alınır |
|----------|--------|----------------|
| `HUB_PERSISTENCE_ENABLED` | `true` | MSSQL kullanacaksan `true`. Test için `false` (bellek modu). |
| `HUB_MSSQL_URL` | `Server=host;Database=...;User Id=...;Password=...;Encrypt=True;TrustServerCertificate=True` | SQL Server connection string. Azure / kendi sunucun / Docker MSSQL panelinden kopyala. |

**Settings şifreleme anahtarı** (entegrasyon secret’larını DB’de şifrelemek için):

```bash
openssl rand -base64 32
```

```env
HUB_SETTINGS_MASTER_KEY=buraya-32-byte-base64
```

> Bu anahtarı kaybedersen DB’deki şifreli ayarlar okunamaz. **Yedekle.**

### İlk kullanıcı (DB boşken bir kez)

| Değişken | Açıklama |
|----------|----------|
| `HUB_SEED_EMAIL` | İlk admin kullanıcı e-postası |
| `HUB_SEED_PASSWORD` | İlk giriş şifresi |
| `HUB_SEED_DISPLAY_NAME` | Görünen ad |

Sunucu ilk açılışta `hub_users` tablosu boşsa bu kullanıcıyı oluşturur. Sonra `/auth/login` ile giriş yaparsın.

---

## 2. Entegrasyonlar — .env veya Settings UI

Aşağıdakileri **ya** `mcp-server/.env` **ya da** `http://localhost:5173/settings` → **Entegrasyonlar** ekranından girebilirsin. UI’dan girilenler MSSQL’e şifreli yazılır (bootstrap key’ler hariç).

### LLM (Chat / Asistan)

| Değişken | Nereden alınır | Nasıl girilir |
|----------|----------------|---------------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) → Create new secret key | `sk-proj-...` yapıştır |
| `CHAT_LLM_PROVIDER` | — | `openai` (varsayılan) veya `ollama` |
| `CHAT_LLM_MODEL` | — | Örn. `gpt-4o-mini` |
| `OLLAMA_BASE_URL` | Yerel Ollama | `http://127.0.0.1:11434` |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Opsiyonel alternatif provider |

### GitHub

| Değişken | Nereden alınır | Nasıl girilir |
|----------|----------------|---------------|
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → **Personal access tokens** → Fine-grained veya classic | `repo`, `read:org` vb. scope’lar ihtiyacına göre. `ghp_...` |

Kullanım: `github_*` araçları, release manager, hygiene (stale PR).

### Notion

| Değişken | Nereden alınır | Nasıl girilir |
|----------|----------------|---------------|
| `NOTION_API_KEY` | [notion.so/my-integrations](https://www.notion.so/my-integrations) → Internal integration → **Secret** | `secret_...` |
| `NOTION_ROOT_PAGE_ID` | Notion sayfa URL’sindeki 32 karakter ID | Sayfayı integration’a **Connect** et |
| `NOTION_PROJECTS_DB_ID` | Database URL’sindeki ID | Opsiyonel; proje listesi için |
| `NOTION_TASKS_DB_ID` | Database URL’sindeki ID | Opsiyonel; görevler için |

### n8n

| Değişken | Nereden alınır | Nasıl girilir |
|----------|----------------|---------------|
| `N8N_BASE_URL` | Kendi n8n instance | `http://localhost:5678` veya cloud URL |
| `N8N_API_KEY` | n8n → Settings → API → Create API Key | JWT benzeri key |
| `ALLOW_N8N_WRITE` | — | Workflow yazma için `true` |

### Telegram (opsiyonel)

| Değişken | Nereden alınır |
|----------|----------------|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TELEGRAM_CHAT_ID` | [@userinfobot](https://t.me/userinfobot) veya grup ID |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Virgülle ayrılmış izinli chat ID’ler |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 16` — webhook doğrulama |

### V7 — günlük brifing (mail + haber)

RSS feed’ler **env’de değil** — `POST /personal/briefing/feeds` ile registry’ye eklenir (JSON store).  
IMAP şifresi **asla store’a yazılmaz** — hesap API ile tanımlanır, şifre env’de kalır.

| Değişken | Amaç | Nasıl girilir |
|----------|------|----------------|
| `BRIEFING_IMAP_PASS` | IMAP hesap şifresi / Gmail app password | [Google App Passwords](https://myaccount.google.com/apppasswords) veya sağlayıcı IMAP şifresi |
| `BRIEFING_SKIP_IMAP` | IMAP poll’u kapat (test/dev) | `true` |
| `BRIEFING_IMAP_TLS_INSECURE` | Self-signed TLS (sadece dev) | `true` |
| `BRIEFING_SOURCE_STORE_PATH` | Feed + IMAP + Gmail registry | Opsiyonel; varsayılan `cache/briefing-sources.json` |
| `BRIEFING_SCHEDULE_PATH` | Sabah brifing cron ayarları | Opsiyonel; varsayılan `cache/briefing-schedule.json` |
| `GMAIL_OAUTH_CLIENT_ID` | Gmail OAuth client ID | [Google Cloud Console](https://console.cloud.google.com/) |
| `GMAIL_OAUTH_CLIENT_SECRET` | Gmail OAuth secret | Aynı proje |
| `GMAIL_OAUTH_REDIRECT_URI` | OAuth callback | Varsayılan `http://localhost:8787/personal/briefing/gmail/oauth/callback` |
| `BRIEFING_SCHEDULER_ENABLED` | Arka plan scheduler | `false` ile kapat |
| `PERSONAL_BRIEFING_PATH` | Üretilmiş brifing geçmişi | Opsiyonel |
| `BRIEFING_FEEDBACK_PATH` | Brifing 👍/👎 feedback | Opsiyonel |
| `TELEGRAM_OUTBOUND_LOG_PATH` | Telegram giden mesaj logu | Opsiyonel |

**IMAP hesabı ekleme (şifre env’de):**

```bash
# .env → BRIEFING_IMAP_PASS=xxxx

curl -X POST http://localhost:8787/personal/briefing/imap \
  -H "Authorization: Bearer $HUB_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host":"imap.gmail.com","user":"you@gmail.com","passwordEnvKey":"BRIEFING_IMAP_PASS","label":"Gmail"}'
```

**RSS feed ekleme:**

```bash
curl -X POST http://localhost:8787/personal/briefing/feeds \
  -H "Authorization: Bearer $HUB_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://feeds.bbci.co.uk/news/rss.xml","label":"BBC"}'
```

> **UI:** Ayarlar → Kişisel OS — RSS, IMAP, Gmail OAuth, sabah zamanlaması ve Telegram log.

**Sabah brifing zamanlaması:**

```bash
curl -X PUT http://localhost:8787/personal/briefing/schedule \
  -H "Authorization: Bearer $HUB_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"hour":9,"minute":0,"timezone":"Europe/Istanbul","pushTelegram":true}'
```

**Gmail OAuth:** Ayarlar → Kişisel OS → Gmail bağla (veya `GET /personal/briefing/gmail/oauth/url`).

### Redis / ek veritabanları (opsiyonel)

| Değişken | Örnek |
|----------|--------|
| `REDIS_URL` | `redis://localhost:6379` |
| `MONGODB_URI` | `mongodb://...` |
| `PG_CONNECTION_STRING` | PostgreSQL connection string |

---

## 3. V5 Ops — observability, SLA, desktop (opsiyonel)

### Incident / Observability webhook

Harici sistemler hub’a hata sinyali gönderir; incident triage önce bunları okur.

| Değişken | Amaç | Nasıl girilir |
|----------|------|----------------|
| `SENTRY_WEBHOOK_SECRET` | `POST /integrations/observability/sentry` doğrulama | `openssl rand -hex 24` — Sentry outbound webhook header’ında aynı değer |
| `DATADOG_WEBHOOK_SECRET` | `POST /integrations/observability/datadog` | Datadog monitor webhook custom header |
| `SENTRY_DSN` | Sentry SDK (sunucu tarafı hata raporu) | Sentry proje → Client Keys (DSN) |

**Sentry webhook URL (hub’ına):**

```text
https://senin-domain.com/integrations/observability/sentry
Header: x-webhook-secret: <SENTRY_WEBHOOK_SECRET>
```

**Manuel test (write key ile):**

```bash
curl -X POST http://localhost:8787/integrations/observability/generic \
  -H "Authorization: Bearer $HUB_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Test spike","source":"manual","spike":true}'
```

### SLA & incident

| Değişken | Açıklama |
|----------|----------|
| `SLA_ESCALATION_REPO` | SLA ihlalinde GitHub issue açılacak repo: `owner/name` |
| `SLA_RUNNER_ENABLED` | Arka plan SLA tick; test’te `false`, prod’da varsayılan açık |
| `INCIDENT_DEFAULT_OWNER` | Triage postmortem owner: `on-call` veya e-posta |

### Desktop / sidecar (macOS & Windows)

| Değişken | Örnek | Açıklama |
|----------|--------|----------|
| `DESKTOP_OCR_REQUIRED` | `true` | Click/type öncesi screenshot + OCR sensitive kontrol |
| `DESKTOP_ALLOWED_APPS` | `Cursor,Google Chrome,Terminal,explorer` | Virgülle ayrılmış izinli uygulamalar |
| `DESKTOP_BLOCKED_APPS` | `Keychain Access,1Password` | Varsayılan blok listesi |
| `DESKTOP_ALLOWLIST_DISABLED` | `true` | Sadece dev/test; prod’da kullanma |
| `SIDECAR_PORT` | `9477` | Yerel sidecar daemon portu |
| `SIDECAR_AUTH_TOKEN` | `openssl rand -hex 32` | Sidecar ↔ hub auth |

Sidecar kurulum:

```bash
# macOS (launchd)
npm run sidecar:install

# Windows (Scheduled Task)
npm run sidecar:install:win

# Manuel
npm run sidecar:daemon
```

Windows görevi `FelixDesktopSidecar`: PC açılışı + oturum açılışında otomatik başlar; log `%USERPROFILE%\.config\felix-desktop\`. Firewall: TCP 9477.

Çoklu cihaz: Web panel → Felix Desktop veya chat/Telegram'da cihaz seçimi; varsayılanlar `sidecar_preferences` tablosunda saklanır. Telegram'da `/desktop devices` + inline butonlar.

### Obsidian (brain sync, opsiyonel)

| Değişken | Açıklama |
|----------|----------|
| `OBSIDIAN_VAULT_PATH` | Vault klasörünün tam yolu: `/Users/you/Documents/Obsidian/MyVault` |
| `OBSIDIAN_EXPORT_ENABLED` | `true` ise brain → vault export |

---

## 4. Örnek minimal `.env` (ilk gün)

```env
PORT=8787
NODE_ENV=development

HUB_READ_KEY=<openssl rand -base64 32>
HUB_WRITE_KEY=<openssl rand -base64 32>
HUB_ADMIN_KEY=<openssl rand -base64 48>

HUB_PERSISTENCE_ENABLED=false
# HUB_MSSQL_URL=...        # persistence açınca ekle
# HUB_SETTINGS_MASTER_KEY=... # persistence + settings UI için

HUB_SEED_EMAIL=sen@email.com
HUB_SEED_PASSWORD=guclu-sifre
HUB_SEED_DISPLAY_NAME=Adın

# Entegrasyonlar (veya Settings UI'dan)
# OPENAI_API_KEY=sk-...
# GITHUB_TOKEN=ghp_...
# NOTION_API_KEY=secret_...
```

Persistence açmak için:

```env
HUB_PERSISTENCE_ENABLED=true
HUB_MSSQL_URL=Server=...;Database=...;User Id=...;Password=...;Encrypt=True;TrustServerCertificate=True
HUB_SETTINGS_MASTER_KEY=<openssl rand -base64 32>
```

---

## 5. Doğrulama

```bash
cd mcp-server
npm run dev

# Sağlık
curl http://localhost:8787/health

# Auth (read key)
curl -H "Authorization: Bearer $HUB_READ_KEY" http://localhost:8787/whoami

# Plugin listesi
curl -H "Authorization: Bearer $HUB_READ_KEY" http://localhost:8787/plugins
```

UI: `npm run dev:all` → `http://localhost:5173` → login veya API key.

---

## 5b. Production güvenlik (NODE_ENV=production)

Sunucu bu değerler eksik veya hatalıysa **başlamaz** (fail-closed):

| Değişken | Zorunlu değer | Açıklama |
|----------|---------------|----------|
| `CORS_ALLOWED_ORIGINS` | UI origin(leri) | Virgülle ayrılmış tam URL |
| `WORKSPACE_STRICT_BOUNDARIES` | `true` | Çapraz workspace erişimi kapalı |
| `WORKSPACE_REQUIRE_ID` | `true` | Workspace ID zorunlu |
| `CHAT_LLM_PROVIDER` | `openai`, `anthropic`, … | `auto` production'da yasak |
| `CHAT_LLM_MODEL` | model adı | Örn. `gpt-4o-mini` |
| `SHELL_MODE` | `safe` (önerilen) veya `power` | Varsayılan production: `safe` |
| Policy plugin | yüklü | `POLICY_*_ALLOW_MISSING_EVALUATOR=true` yasak |

Ek öneriler:

- `BRAIN_DB_SOURCE_OF_TRUTH=true` — brain memories MSSQL SoT, Redis cache
- `BRAIN_FAIL_CLOSED_ON_DB=true` — brain writes fail when MSSQL is down (no Redis-only fallback)
- `GLOBAL_WORKSPACE_READ_ONLY=true` — global workspace write tools blocked (default in production)
- `SHELL_MODE=power` — **admin-only** full shell; requires `HUB_ADMIN_KEY` + policy approval per command
- `/ui/token` production'da kapalı; query-string token desteklenmez
- `HUB_ALLOW_OPEN_HUB` production'da yasak

```env
CORS_ALLOWED_ORIGINS=https://asistan.huseyinalav.com
WORKSPACE_STRICT_BOUNDARIES=true
WORKSPACE_REQUIRE_ID=true
CHAT_LLM_PROVIDER=openai
CHAT_LLM_MODEL=gpt-4o-mini
SHELL_MODE=safe
BRAIN_DB_SOURCE_OF_TRUTH=true
```

---

## 6. Güvenlik notları

- `.env` dosyasını **asla git’e commit etme** (`.gitignore`’da olmalı).
- Production’da `HUB_SEED_*` ile seed yaptıktan sonra şifreyi değiştir.
- `HUB_ADMIN_KEY`’i yalnızca güvendiğin otomasyonlarda kullan.
- Entegrasyon anahtarlarını mümkünse **Settings UI** üzerinden gir; `.env`’de sadece bootstrap kalsın.

---

## İlgili dosyalar

- Şablon: [`mcp-server/.env.example`](./mcp-server/.env.example)
- Workspace güvenliği: [`mcp-server/docs/workspace-security-model.md`](./mcp-server/docs/workspace-security-model.md)
