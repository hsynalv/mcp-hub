# V10 Felix Desktop — Deploy & Env Rehberi

> **Son güncelleme:** 2026-07-05  
> Hub (VPS/Coolify) + Mac/Windows sidecar için V9/V10 birleşik kurulum.

---

## Mimari

```text
Telegram / Chat / /ask
        ↓
Hub (asistan.huseyinalav.com) — LOCAL_FS_ON_SERVER=false
        ↓ HTTP + Bearer (opsiyonel HMAC)
Sidecar (Mac PM2 veya Windows Task Scheduler) — static IP:9477
```

---

## 1. Hub (Coolify / VPS) — zorunlu env

`mcp-server/.env` veya Coolify Environment:

```env
# Production
NODE_ENV=production
PORT=8787
CORS_ALLOWED_ORIGINS=https://asistan.huseyinalav.com

# Sidecar delegation — hub dosyaya dokunmaz, Mac'e yönlendirir
LOCAL_FS_ON_SERVER=false

# Chat/Telegram tenant (boşsa bazı akışlar default tenant'a düşmez)
HUB_TENANT_ID=default

# Auth (mevcut hub key'leriniz)
HUB_READ_KEY=...
HUB_WRITE_KEY=...
HUB_ADMIN_KEY=...

# Persistence (mevcut)
HUB_PERSISTENCE_ENABLED=true
HUB_MSSQL_URL=...
HUB_SETTINGS_MASTER_KEY=...
```

### Hub — önerilen / opsiyonel

```env
# Terminal: safe (varsayılan) | power
SIDECAR_TERMINAL_MODE=safe

# İmzalı sidecar istekleri (hub + Mac'te birlikte açın)
# SIDECAR_SIGNED_REQUESTS=true
# SIDECAR_SIGNED_REQUESTS_STRICT=true

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=...
# TELEGRAM_AUTO_APPROVE_TOOLS=fs_list,fs_read,desktop_screenshot,...
```

OpenAI / diğer entegrasyonlar → **Ayarlar → Entegrasyonlar** UI (env'de olmayabilir).

---

## 2. Mac sidecar — `~/.config/felix-desktop/env`

```env
# Eşleştirmeden gelen token (rotate sonrası güncelleyin)
SIDECAR_AUTH_TOKEN=<pairing veya rotate sonrası token>

# Uzaktan erişim (static IP + port forward)
SIDECAR_BIND=0.0.0.0
SIDECAR_PORT=9477
SIDECAR_PUBLIC_URL=http://88.248.21.106:9477

# Hub referansı (log / rehber)
FELIX_HUB_URL=https://asistan.huseyinalav.com

# Terminal güvenli mod (önerilen)
SIDECAR_TERMINAL_MODE=safe

# Opsiyonel: hub ile aynı imza modu
# SIDECAR_SIGNED_REQUESTS=true
```

### Mac — opsiyonel

```env
# İzin verilen uygulamalar (virgülle)
# DESKTOP_ALLOWED_APPS=Google Chrome,Safari,Finder,Cursor

# Hassas ekranda OCR ön kontrolü
# DESKTOP_OCR_REQUIRED=true
```

---

## 2b. Windows sidecar — `%USERPROFILE%\.config\felix-desktop\env`

```env
SIDECAR_AUTH_TOKEN=<pairing veya rotate sonrası token>
SIDECAR_BIND=0.0.0.0
SIDECAR_PORT=9477
SIDECAR_PUBLIC_URL=http://SABIT_IP:9477
FELIX_HUB_URL=https://asistan.huseyinalav.com
SIDECAR_TERMINAL_MODE=safe
```

### Windows — kurulum ve otomatik başlatma

```powershell
cd mcp-server
pnpm install
# env dosyasına SIDECAR_AUTH_TOKEN yazın
npm run sidecar:install:win
```

- Scheduled Task: `FelixDesktopSidecar`
- Tetikleyiciler: oturum açılışı + PC açılışı (2 dk gecikme)
- Çökme sonrası otomatik yeniden başlatma
- Log: `%USERPROFILE%\.config\felix-desktop\stdout.log` / `stderr.log`

```powershell
Start-ScheduledTask -TaskName FelixDesktopSidecar
Stop-ScheduledTask -TaskName FelixDesktopSidecar
Unregister-ScheduledTask -TaskName FelixDesktopSidecar -Confirm:$false
```

### Windows — firewall

Gelen kural: TCP **9477** (Private ağ). Modem port forward: dış 9477 → PC yerel IP → iç 9477.

### Windows — bağımlılıklar

```powershell
cd mcp-server
pnpm install   # @nut-tree-fork/nut-js dahil
npm install playwright
npx playwright install chromium
```

Masaüstü otomasyonu kullanıcı oturumu açıkken çalışır. Health: `sidecar_dependency_check`, `desktop_permission_check`.

---

## 3. Çalıştırma komutları

### Hub deploy (VPS)

```bash
cd mcp-server
git pull
pnpm install
pnpm install --dir frontend
npm run ui:build
npm run pm2:reload
# veya Coolify redeploy
```

### Mac sidecar (PM2)

```bash
cd mcp-server
git pull
pnpm install

# İlk kurulum veya env değişince
npm run sidecar:pm2:start

# Kod/env güncellemesi sonrası
npm run sidecar:pm2:restart

# Log
npm run sidecar:pm2:logs
```

### Mac bağımlılıkları (önerilen)

```bash
brew install cliclick tesseract

# Browser click/type + JS sayfaları için (opsiyonel)
cd mcp-server
npm install playwright
npx playwright install chromium
```

### macOS izinleri

Sistem Ayarları → Gizlilik ve Güvenlik:

1. **Ekran Kaydı** → `node` (PM2 sidecar)
2. **Erişilebilirlik** → `node`

Kontrol (chat veya API):

- `sidecar_dependency_check`
- `desktop_permission_check`

---

## 4. Eşleştirme (pairing)

1. Hub → **Felix Desktop** → kod oluştur
2. Sidecar çalışıyor olmalı (Mac: PM2; Windows: Scheduled Task)
3. `baseUrl` = `SIDECAR_PUBLIC_URL` (ör. `http://88.248.21.106:9477`)
4. Pair sırasında `/health` → `platform` (darwin/win32) + `hostname` hub'a kaydedilir
5. Dönen `authToken` → env → sidecar yeniden başlat

**Varsayılan capabilities:** `fs`, `terminal`, `desktop`, `notify`, `browser`

Eski cihazda sadece `["fs"]` varsa — yeniden eşleştirin veya:

```bash
curl -X PATCH https://asistan.huseyinalav.com/sidecar/devices/<DEVICE_ID>/capabilities \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"capabilities":["fs","terminal","desktop","notify","browser"]}'
```

---

## 5. Token rotate

```bash
curl -X POST https://asistan.huseyinalav.com/sidecar/devices/<DEVICE_ID>/rotate-token \
  -H "Authorization: Bearer $HUB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason":"scheduled"}'
```

Yanıttaki `authToken` → Mac `SIDECAR_AUTH_TOKEN` → `npm run sidecar:pm2:restart`

---

## 6. Sağlık kontrolleri

```bash
# Sidecar (Mac'ten veya LAN'dan)
curl -H "Authorization: Bearer $SIDECAR_AUTH_TOKEN" \
  http://127.0.0.1:9477/health

curl -H "Authorization: Bearer $SIDECAR_AUTH_TOKEN" \
  http://127.0.0.1:9477/health/dependencies

curl -H "Authorization: Bearer $SIDECAR_AUTH_TOKEN" \
  http://127.0.0.1:9477/desktop/permissions

# Hub aggregate
curl -H "Authorization: Bearer $HUB_READ_KEY" \
  https://asistan.huseyinalav.com/sidecar/status
```

---

## 7. Test (geliştirme)

```bash
cd mcp-server
npm test -- --run tests/core/sidecar-*.test.js tests/core/telegram-sidecar-commands.test.js tests/core/v10-sidecar-context.test.js tests/plugins/desktop-win32.test.js tests/plugins/local-sidecar.test.js
```

---

## 8. V10 faz özeti (tamamlandı)

| Faz | İçerik |
|-----|--------|
| A | Terminal safe/power, path policy, action preview |
| B | fs pro, region/window screenshot, Telegram delivery |
| C | hotkey/scroll/drag, clipboard, undo kayıtları |
| D | browser open/snapshot/click, hassas URL hard-stop |
| E | dependency/permission check, token rotate, signed request |
| F | Multi-sidecar (chat/Telegram tercih, ambiguous), Windows kurulum + desktop parity |

---

## 9. Bilinen sınırlar (bilinçli backlog)

- Token DB'de düz metin (hash at-rest sonraki faz)
- mTLS yok (HMAC signed request MVP var)
- `browser_click/type` Playwright gerektirir
- Fetch modu JS-render sayfaları tam göstermez

---

## 10. Hızlı smoke test (Telegram/chat)

1. `~/Documents listele`
2. `Ekran görüntüsü al`
3. `https://example.com aç, linkleri listele`
4. `Sidecar bağımlılıklarını kontrol et`
