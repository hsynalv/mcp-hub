# Mimari

## Genel Bakış

```
┌─────────────────────────────────────────┐
│         AI Agent / LLM Client           │
│   Cursor, Claude Desktop, n8n, vb.      │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────┐           ┌────▼────┐
│  MCP   │           │  REST   │
│Gateway │           │  API    │
└───┬────┘           └────┬────┘
    │                     │
    └──────────┬──────────┘
               │
       ┌───────▼────────┐
       │   Plugin Sistemi │
       └───────┬────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│GitHub │ │Notion │ │  n8n  │
│ Plugin│ │ Plugin│ │ Plugin│
└───────┘ └───────┘ └───────┘
```

## Core Bileşenleri

### 1. Plugin Loader (`src/core/plugins.js`)

- `src/plugins/*` dizinini otomatik tarar
- Her plugin'in `index.js` ve `register()` fonksiyonu olmalı
- Hatalı plugin'ler server'ı çökertmez, sadece loglanır

### 2. Tool Registry (`src/core/tool-registry.js`)

- MCP araçlarının merkezi kaydı
- Policy hooks entegrasyonu
- Tag-based kategorizasyon (READ, WRITE, NETWORK, vb.)

### 3. Job Sistemi (`src/core/jobs.js`)

- Async görev kuyruğu
- Redis veya in-memory depolama
- Job state: queued → running → completed/failed/cancelled

### 4. Auth Middleware (`src/core/auth.js`)

- Scope-based yetkilendirme: read, write, admin
- API key doğrulama
- `requireScope()` middleware

### 5. Policy Guard (`src/core/policy-guard.js`)

- Hook-based policy kontrolü
- Onay workflow'ları
- Rate limiting

### 6. Project Context (`src/core/server.js`)

- `x-project-id` ve `x-env` header'larını çözümler
- Geliştirme modu: eksik header'lar varsayılan değer alır
- Prod modu: header'lar zorunlu (REQUIRE_PROJECT_HEADERS=true)

## Plugin Yapısı

```
src/plugins/<name>/
├── index.js          # Ana export
├── README.md         # Dokümantasyon (opsiyonel)
└── *.js              # Yardımcı modüller (opsiyonel)
```

### index.js Export'ları

```javascript
export const name = "github";           // Plugin ID
export const version = "1.0.0";         // Semver
export const description = "...";       // Açıklama
export const endpoints = [...];         // API endpoint tanımları
export const tools = [...];             // MCP araçları
export function register(app) { ... }   // Express route'ları
```

## Veri Akışı

### REST API Request

```
Client → Express → projectContext → auth → audit → policy → route handler → response
```

### MCP Request

```
Client → /mcp endpoint → MCP Gateway → Tool Registry → tool handler → response
```

### Job Execution

```
POST /jobs → submitJob() → queue → job runner → state update → client poll/status
```

## Hook Sistemi

Plugin'ler core'a hook register edebilir:

```javascript
// plugins/policy/index.js
import { registerBeforeExecutionHook } from "../../core/tool-hooks.js";

registerBeforeExecutionHook("policy", policyCheck);
```

Bu pattern ile core → plugin bağımlılığı kırılır.

## Depolama

| Veri | Depolama | Açıklama |
|------|----------|----------|
| Jobs | Redis / Memory | Job state ve progress |
| Logs | Memory / File | Audit logları |
| Approvals | Memory | Policy onayları |
| Cache | Disk | n8n node kataloğu, API response'ları |
