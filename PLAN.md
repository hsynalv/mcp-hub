# MCP Server — Plugin Yol Haritası

**Amaç:** n8n içindeki AI agent'ın yüksek doğrulukla workflow üretebilmesi için
gerekli bilgi ve araçları HTTP endpoint olarak sunmak.

Her plugin `src/plugins/<isim>/` altında bağımsız yaşar.
Mevcut plugin sistemi değişmez, yeni plugin sadece `register(app)` export eder.

---

## Mevcut Durum

| Plugin | Konum | Durum |
|--------|-------|-------|
| n8n | `src/plugins/n8n/` | ✅ Hazır |
| n8n-credentials | `src/plugins/n8n-credentials/` | ✅ Hazır |
| n8n-workflows | `src/plugins/n8n-workflows/` | ✅ Hazır |

---

## Planlanan Pluginler

---

### P1 — `n8n-credentials` ✅

**Klasör:** `src/plugins/n8n-credentials/`
**Öncelik:** Kritik — **TAMAMLANDI**

**Sorun:** AI şu an credential isimlerini tahmin ediyor.
`"slackApi"` yazıyor ama n8n'de gerçek isim `"Slack - Şirket"` olabilir.
Yanlış credential = hiç çalışmayan workflow.

**Ne yapar:**
- n8n REST API'den mevcut credential listesini çeker
- AI her zaman gerçek, kurulu credential isimlerini kullanır

**Endpointler:**
```
GET  /credentials                → tüm credentialları listele
GET  /credentials/:type          → belirli tipteki credentiallar (örn: slackApi)
POST /credentials/refresh        → n8n'den yeniden çek, cache'e yaz
```

**Yanıt örneği:**
```json
[
  { "id": "1", "name": "Slack - Şirket", "type": "slackApi" },
  { "id": "2", "name": "Gmail - Kişisel", "type": "gmailOAuth2" }
]
```

**Env değişkenleri:** Mevcut `N8N_BASE_URL` + `N8N_API_KEY` yeterli.

**Dosyalar:**
```
src/plugins/n8n-credentials/
  index.js              → register(app), name, version
  credentials.client.js → n8n API isteği
  credentials.store.js  → disk cache
  README.md
```

**Kararlar:**
- [x] Cache TTL → `CREDENTIALS_TTL_MINUTES=60` (1 saat, env ile değiştirilebilir)
- [x] Credential value asla dönmez — sadece `id/name/type` ✅

---

### P2 — `openapi`

**Klasör:** `src/plugins/openapi/`
**Öncelik:** Yüksek

**Sorun:** AI HTTP Request node'u yaparken endpoint path'i, parametreleri,
auth tipini tahmin eder. OpenAPI spec varsa bunların hepsi garantili olur.

**Ne yapar:**
- Verilen URL'den OpenAPI/Swagger spec indirir ve parse eder
- AI endpoint listesini, parametrelerini, body şemasını sorgulayabilir

**Endpointler:**
```
POST /openapi/load               → spec URL ver, indir ve kaydet
GET  /openapi                    → yüklenmiş spec listesi
GET  /openapi/:name/endpoints    → endpoint listesi (opsiyonel ?q= ile ara)
GET  /openapi/:name/endpoint     → tek endpoint detayı (?method=POST&path=/v1/charges)
DELETE /openapi/:name            → spec'i sil
```

**Yanıt örneği:**
```json
{
  "method": "POST",
  "path": "/v1/charges",
  "summary": "Create a charge",
  "parameters": [],
  "requestBody": {
    "amount": { "type": "integer", "required": true },
    "currency": { "type": "string", "required": true }
  },
  "auth": "bearer"
}
```

**Dosyalar:**
```
src/plugins/openapi/
  index.js          → register(app)
  spec.loader.js    → URL'den fetch + parse (swagger-parser veya elle)
  spec.store.js     → diske yaz/oku
  spec.search.js    → endpoint arama
  README.md
```

**Sorular / Kararlar:**
- [ ] Bağımlılık olarak `swagger-parser` veya `@apidevtools/swagger-parser` kullanılsın mı?
- [ ] Spec'ler nerede saklanacak? `CATALOG_CACHE_DIR/openapi/` yeterli mi?
- [ ] Hangi API'lerin spec'ini önce yüklemek istersin? (Stripe, Twilio, kendi API'n?)

---

### P3 — `n8n-workflows` ✅

**Klasör:** `src/plugins/n8n-workflows/`
**Öncelik:** Orta-Yüksek — **TAMAMLANDI**

**Sorun:** AI sıfırdan workflow üretiyor, ama senin n8n'inde benzer
workflow'lar zaten var. Onları template olarak kullanabilirse çok daha hızlı
ve doğru üretir.

**Ne yapar:**
- n8n'deki mevcut workflow'ları listeler ve içeriklerini sunar
- AI "buna benzer bir şey daha önce yapılmış mı?" diye bakabilir

**Endpointler:**
```
GET  /n8n/workflows              → tüm workflow listesi (id, name, active)
GET  /n8n/workflows/:id          → workflow JSON'ı (AI template olarak kullanır)
POST /n8n/workflows/search       → workflow içinde node tipi veya isim ara
```

**Dosyalar:**
```
src/plugins/n8n-workflows/
  index.js              → register(app)
  workflows.client.js   → n8n API /api/v1/workflows
  README.md
```

**Not:** Bu plugin `n8n-credentials` plugin'inden bağımsız çalışır ama
ikisi birlikte kullanılınca AI'ın context'i çok güçlenir.

**Kararlar:**
- [x] Cache uygulandı → liste (`list.json`) + tekil (`wf-<id>.json`), TTL: `WORKFLOWS_TTL_MINUTES=10`
- [x] Pagination destekleniyor → `nextCursor` ile tüm sayfalar çekilir

---

### P4 — `schema`

**Klasör:** `src/plugins/schema/`
**Öncelik:** Orta

**Sorun:** Set ve Code node'larında AI verinin o noktada nasıl göründüğünü bilemez.
"items[0].customer.email" mi, "data.user.mail" mi? Yanlış field adı = hata.

**Ne yapar:**
- JSON şemalarını isimle kaydet
- AI bir workflow oluştururken "bu noktada veri şöyle görünüyor" diye bakabilir

**Endpointler:**
```
GET  /schemas                    → kayıtlı şema listesi
GET  /schemas/:name              → şema detayı
POST /schemas/:name              → yeni şema kaydet veya güncelle
DELETE /schemas/:name            → şema sil
```

**Kullanım örneği:**
```bash
# Önce şemayı kaydet
POST /schemas/crm-contact
{ "fields": { "id": "string", "email": "string", "company": { "name": "string" } } }

# AI workflow üretirken çeker
GET /schemas/crm-contact
```

**Dosyalar:**
```
src/plugins/schema/
  index.js        → register(app)
  schema.store.js → JSON dosyaları olarak kaydet (data/ klasöründe)
  README.md
```

**Sorular / Kararlar:**
- [ ] Şemalar `data/schemas/` klasöründe düz JSON dosyaları olarak mı durmalı?
- [ ] Şema üzerinde validasyon gerekli mi? (gelen veri şemaya uyuyor mu?)

---

### P5 — `snippets`

**Klasör:** `src/plugins/snippets/`
**Öncelik:** Orta

**Sorun:** Her workflow'da aynı 3-4 node bloğu tekrar ediyor
(hata yönetimi, loglama, veri normalizasyonu gibi). AI bunları her seferinde sıfırdan üretiyor.

**Ne yapar:**
- Tekrar eden node gruplarını snippet olarak saklar
- AI snippet'i workflow'a hazır blok olarak yerleştirir

**Endpointler:**
```
GET  /snippets                   → snippet listesi
GET  /snippets/:name             → snippet detayı (nodes + connections)
POST /snippets/:name             → yeni snippet kaydet
DELETE /snippets/:name           → snippet sil
```

**Snippet örneği:**
```json
{
  "name": "error-handler",
  "description": "Hata durumunda Slack'e bildirim gönderir",
  "nodes": [ ... ],
  "connections": { ... },
  "placeholders": ["SLACK_CHANNEL", "ERROR_WEBHOOK_URL"]
}
```

**Dosyalar:**
```
src/plugins/snippets/
  index.js          → register(app)
  snippets.store.js → data/snippets/ klasörüne kaydet
  README.md
```

**Sorular / Kararlar:**
- [ ] Hangi snippet'ler önce yazılmalı? (hata yönetimi, webhook response, loglama?)
- [ ] Placeholder sistemi olsun mu? (snippet içinde değişken alanlar)

---

### P6 — `github`

**Klasör:** `src/plugins/github/`
**Öncelik:** Düşük-Orta

**Ne yapar (iki farklı kullanım):**

**A) Workflow versiyonlama:**
Üretilen workflow'ları otomatik olarak bir GitHub repo'suna commit eder.
"Geçen haftaki sürüme dön" mümkün olur.

**B) Kod okuma:**
AI bir repo'daki kodu okuyup ona uygun workflow üretir.
"Bu Python script'ini n8n workflow'una çevir" tarzı kullanım.

**Endpointler:**
```
GET  /github/file                → ?repo=&path= dosya içeriğini getir
GET  /github/workflows           → repo'daki kayıtlı workflow listesi
POST /github/commit              → workflow JSON'ı commit et
```

**Env değişkenleri:**
```
GITHUB_TOKEN=
GITHUB_REPO=kullanici/repo-adi
GITHUB_WORKFLOWS_PATH=workflows/
```

**Dosyalar:**
```
src/plugins/github/
  index.js          → register(app)
  github.client.js  → GitHub REST API (token auth)
  README.md
```

**Sorular / Kararlar:**
- [ ] Versiyonlama mı, kod okuma mı, yoksa ikisi birden mi öncelikli?
- [ ] Hangi repo kullanılacak? Workflows için ayrı repo mu açılacak?

---

### P7 — `jira` / `linear`

**Klasör:** `src/plugins/jira/` veya `src/plugins/linear/`
**Öncelik:** Düşük

**Sorun:** AI workflow'u ne için yapacağını bilmiyor, sen tarif ediyorsun.
Ama ticket zaten sistemde varsa AI direkt oradan okuyabilir.

**Ne yapar:**
- Jira ticket veya Linear issue içeriğini çeker
- AI "bu ticket'ı çözen workflow üret" yapabilir

**Endpointler:**
```
GET  /jira/issue/:key            → issue detayı (title, description, labels)
GET  /linear/issue/:id           → issue detayı
```

**Sorular / Kararlar:**
- [ ] Jira mı Linear mı kullanıyorsun?
- [ ] Bu gerçekten ihtiyaç var mı yoksa önce P1-P3 tamamlansın mı?

---

## Genel Kararlar (Tüm Pluginler İçin)

- [x] Cache dosyaları → `cache/<plugin>/` altında (örn: `cache/n8n-credentials/`, `cache/n8n-workflows/`)
- [x] Plugin'ler arası bağımlılık yok → her plugin bağımsız, `config.js` üzerinden env paylaşımı
- [x] Her plugin'in kendi TTL env'i var (`CREDENTIALS_TTL_MINUTES`, `WORKFLOWS_TTL_MINUTES`)

---

## Tamamlananlar

| Sıra | Plugin | Durum |
|------|--------|-------|
| ✅ | n8n (catalog, nodes, examples, validate, write) | Tamamlandı |
| ✅ | n8n-credentials | Tamamlandı |
| ✅ | n8n-workflows | Tamamlandı |

## Sıradaki Adım (n8n dışı pluginler)

```
P2 → openapi      → HTTP Request node doğruluğu için
P4 → schema       → Set/Code node veri şeması için
P5 → snippets     → tekrarlayan node blokları için
P6 → github       → workflow versiyonlama / kod okuma
P7 → jira/linear  → ticket'tan workflow üretme
```
