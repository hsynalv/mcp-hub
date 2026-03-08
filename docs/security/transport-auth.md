# Transport & Authentication Security Model

Bu doküman MCP-Hub'un farklı transport katmanlarındaki güvenlik modelini açıklar.

## Transport Katmanları

### 1. Local Stdio (MCP Bridge)

**Kullanım:** Cursor, Claude Desktop gibi yerel MCP istemcileri

**Güvenlik Modeli:**
- **Trust Boundary:** Yerel makine (implicit trust)
- **Auth:** Token gerekmez (yerel process)
- **Scope:** Varsayılan `read+write` (kullanıcı kendi makinesinde)
- **Kısıtlamalar:** Policy motoru hâlâ devrede (shell, db için onay)

**Neden:** Kullanıcı kendi makinesinde çalışıyor, fiziksel erişim kontrolü var.

---

### 2. HTTP API

**Kullanım:** REST API, özel LLM entegrasyonları, n8n

**Güvenlik Modeli:**
- **Trust Boundary:** Ağ üzerinden erişim
- **Auth:** Bearer token zorunlu (HUB_READ_KEY / HUB_WRITE_KEY / HUB_ADMIN_KEY)
- **Scope:** Token tipine göre
  - READ_KEY: sadece okuma
  - WRITE_KEY: okuma + yazma
  - ADMIN_KEY: tam yetki
- **HTTPS:** Production'da zorunlu
- **CORS:** Config'den kontrol edilir

**Header Formatı:**
```
Authorization: Bearer YOUR_API_KEY
x-project-id: my-project
x-env: production
```

---

### 3. Internal vs Public Mode

| Mod | CORS | Token | Kullanım |
|-----|------|-------|----------|
| INTERNAL | Kapalı | Zorunlu | Internal microservices |
| PUBLIC | Açık | Opsiyonel (read) | Public API'ler |

---

## Plugin Scope Uygulaması

Her plugin endpoint'i `scope` tanımlar:

```javascript
export const endpoints = [
  { method: "GET", path: "/github/repos", scope: "read" },
  { method: "POST", path: "/github/pr", scope: "write" }
];
```

Scope hierarchy: `read` < `write` < `admin`

---

## Approval (Onay) Katmanı

**Ne zaman devreye girer:**
1. Shell komut çalıştırma
2. Database write operasyonu
3. File delete
4. HTTP yeni domain'e
5. Plugin meta'da `requiresApproval: true`

**Akış:**
```
Request → Auth → Policy Check → [Approval Queue] → Execution
```

---

## Güvenlik Matrisi

| Transport | Auth | Scope | Approval | Trust Level |
|-----------|------|-------|----------|-------------|
| Stdio | Yok | read+write | Policy'e göre | Yüksek (yerel) |
| HTTP Internal | Bearer | Token tipi | Policy'e göre | Orta |
| HTTP Public | Bearer (opsiyonel) | read | Policy'e göre | Düşük |

---

## Hata Kodları

| Kod | Durum | Açıklama |
|-----|-------|----------|
| 401 | AUTHENTICATION_ERROR | Token eksik/invalid |
| 403 | AUTHORIZATION_ERROR | Token yetkisi yetersiz |
| 429 | RATE_LIMITED | Çok fazla istek |
