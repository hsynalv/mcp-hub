# mcp-hub Server

AI ajanları için plugin-tabanlı HTTP servisi.

## Kurulum

```bash
npm install
cp .env.example .env
# .env dosyasını yapılandırın
```

## Çalıştırma

```bash
npm run dev     # Geliştirme (auto-reload)
npm start       # Production
```

## API Endpoints

### Core

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/health` | GET | Sağlık kontrolü |
| `/plugins` | GET | Yüklenen plugin'leri listele |
| `/whoami` | GET | Auth bilgisi |
| `/ui` | GET | Web panel (dashboard) |
| `/ui/token` | POST | Kısa ömürlü UI kodu üret (yalnızca localhost) |

### Jobs

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/jobs` | POST | Yeni job oluştur |
| `/jobs` | GET | Job'ları listele |
| `/jobs/:id` | GET | Job detayı |
| `/jobs/stats` | GET | İstatistikler |

### Approvals

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/approvals/pending` | GET | Bekleyen onaylar |
| `/approve` | POST | Onay ver |

### MCP Gateway

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/mcp` | ALL | MCP protokol endpoint |

## Plugin Sistemi

Plugin'ler `src/plugins/<name>/index.js` konumunda olmalıdır. Her plugin export etmeli:

```javascript
export const name = "my-plugin";
export const version = "1.0.0";
export const register = (app) => { ... };
```

## Çevre Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `PORT` | 8787 | HTTP port |
| `HUB_READ_KEY` | - | Read scope API key |
| `HUB_WRITE_KEY` | - | Write scope API key |
| `HUB_ADMIN_KEY` | - | Admin scope API key |
| `REQUIRE_PROJECT_HEADERS` | false | Proje context header zorunluluğu |
| `DEFAULT_PROJECT_ID` | default-project | Varsayılan proje ID |
| `DEFAULT_ENV` | default-env | Varsayılan ortam |
| `UI_TOKEN_TTL_MS` | 300000 | UI kod geçerlilik süresi (ms) |

## Web Panel (/ui)

Sunucu çalışırken şu adresten web paneli açabilirsiniz:

`http://localhost:8787/ui`

### UI Auth (Kısa ömürlü kod)

Auth etkinse (HUB_* key'leri set ise) panelin API çağrıları `read` scope gerektirir. Panel için uzun ömürlü HUB key'lerini tarayıcıya koymak yerine kısa ömürlü bir UI kodu kullanabilirsiniz:

1. `/ui` sayfasını açın.
2. Panel otomatik olarak `POST /ui/token` çağırıp 6 haneli UI kodu üretir (yalnızca localhost).
3. Üretilen kodu üstteki alana kaydedin (Save). Panel bundan sonra API çağrılarında `Authorization: Bearer <kod>` kullanır.

Notlar:

- UI kodları sadece `read` scope verir.
- Kodlar TTL sonunda geçersiz olur. Süreyi `UI_TOKEN_TTL_MS` ile değiştirebilirsiniz.

## Test

```bash
npm test        # Watch modu
npm run test:run # Tek seferlik
```
