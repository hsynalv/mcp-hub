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

## Test

```bash
npm test        # Watch modu
npm run test:run # Tek seferlik
```
