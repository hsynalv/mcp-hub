# MCP Hub Enhancement Roadmap

J4RV1S entegrasyonu için MCP Hub'ı profesyonel agent platformuna dönüştürme planı.

---

## 1) MCP Transport (stdio + Streamable HTTP)

### Amaç
mcp-hub'ı "REST hub" olmaktan çıkarıp **gerçek MCP server** yapmak.

### Entegrasyon
- **Mevcut REST API aynen kalsın** (debug/UI için)
- Üstüne ayrı katman:
  - `stdio` entrypoint (lokal agent'lar için)
  - `/mcp` Streamable HTTP endpoint (remote/hosted)
- TS SDK ile transportları bağla
- OAuth 2.1 ve güvenlik kılavuzlarına uygun auth

### Testler
- **Contract**: MCP `listTools` → registry'deki tool sayısı birebir eşleşiyor mu?
- **Integration**: `callTool` → aynı handler REST üzerinden çağrıldığında aynı sonucu veriyor mu?
- **Security**: Yetkisiz token ile MCP'den tool çağrısı 401/403 dönüyor mu?
- **E2E**: MCP client ile `listTools` → `callTool(http.request)` akışı

---

## 2) Tool Registry Standardı

### Amaç
Pluginleri "endpoint klasörü" değil, **tool kataloğu** yapmak.

### Entegrasyon
Her plugin şu 3 şeyi export edecek:
- `manifest` (name, version, endpoints…)
- `tools[]` (toolName, description, inputSchema, outputSchema, **tags**)
- `handlers` (toolName → function)

**Tags standardı**: `READ`, `WRITE`, `BULK`, `DESTRUCTIVE`, `NETWORK`, `LOCAL_FS`, `GIT`, `EXTERNAL_API`

### Testler
- **Unit**: Schema validate (valid input passes, invalid input fails)
- **Contract**: Tool describe çıktısı stable mi? (snapshot test)
- **Compatibility**: REST route ile MCP tool aynı handler'ı kullanıyor mu?

---

## 3) Jobs/Queue

### Amaç
Uzun işleri bloklamadan çalıştırmak: reindex, test, büyük sync vs.

### Entegrasyon
- `jobs.submit(type, payload, project/env)`
- `jobs.status(id)`
- `jobs.logs(id)`
- `jobs.cancel(id)`
- Runner registry: pluginler `registerJob(type, handler)` diyebilsin

**Policy**: `WRITE/BULK/DESTRUCTIVE` job tipleri approval isteyebilir.

### Testler
- **Unit**: Queue state machine (queued→running→done/failed/cancelled)
- **Integration**: Runner crash olunca job failed oluyor mu?
- **E2E**: `jobs.submit(reindex)` → `jobs.status` ilerliyor mu → loglar geliyor mu?

---

## 4) Workspace

### Amaç
J4RV1S'in "dosya okuyup yazma" hayalinin gerçek başlangıcı.

### Tool'lar
- `workspace.readFile`
- `workspace.writeFile`
- `workspace.list`
- `workspace.search`
- (opsiyonel) `workspace.patch` (diff uygulama)

**Güvenlik**:
- Allowlist root: ör. `~/Projects` altı
- Path traversal koruması
- `write/delete` → policy approval

### Testler
- **Security**: `../../etc/passwd` denemesi blocklanıyor mu?
- **Unit**: read/write roundtrip
- **Integration**: allowlist dışı erişim reddediliyor mu?
- **E2E**: "read → patch → write" akışı

---

## 5) Git + Tests

### Amaç
Doğru geliştirme akışı: branch → değişiklik → test → commit.

### Tool'lar
- `git.status`, `git.diff`
- `git.branch.create`, `git.checkout`
- `git.commit`, `git.log`
- `tests.run` (unit/integration), `lint.run`

**Policy**: `git.commit` ve `git.push` approval'lı olsun.

### Testler
- **Unit**: Git wrapper komutları doğru formatlıyor mu?
- **Integration**: sandbox repo üzerinde branch→commit çalışıyor mu?
- **E2E**: "feature ekle → tests.run → commit" senaryosu

---

## 6) GitHub PR Flow

### Amaç
**Fikir → PR** dönüşümü.

### Tool'lar
- `github.pr.create`
- `github.pr.comment`
- `github.branch.create`
- `github.files.get/search`

**PR template**: Summary, Changes, How tested, Risk/rollback

**Policy**: `github.* WRITE` → approval

### Testler
- **Mocked integration**: GitHub API wrapper (nock ile)
- **Contract**: PR body template snapshot
- **E2E**: test repo üzerinde gerçek PR aç

---

## 7) Notion Plan/Execute Templates

### Amaç
Task açma, acceptance criteria yazma, plan dökümü, PR link bağlama, release note ekleme.

### Tool'lar
- `notion.templates.apply("feature_delivery", inputs)`
- `notion.tasks.create/update`
- `notion.attach(prUrl, artifactUrl)`

### Testler
- **Contract**: Template output (page properties) snapshot
- **Integration**: "create task → update status → attach link" akışı
- **Resilience**: 429 backoff testleri

---

## 8) RAG (Project Memory)

### Amaç
"Benim repo pattern'im gibi geliştir" kalitesi.

### Entegrasyon
- `rag.index(project)` job olarak
- `rag.search(query, project, filters)` tool olarak

**Kaynaklar**:
- repo docs (`README`, `/docs`)
- belirli code dosyaları (allowlist)
- Notion "spec/architecture" sayfaları

**Policy**: Private dokümanlar/secret sızıntısı → kaynak bazlı ACL

### Testler
- **Unit**: chunker + metadata tagging
- **Integration**: index → search returns expected chunks
- **Security**: secret pattern içeren chunk'lar indexlenmiyor mu?

---

## 9) Semantic Kernel "Brain Service"

### Amaç
Ayrı servis olarak planning + reasoning + multi-step execution.

### Mimarisi
- **mcp-hub = MCP Server** (tools + policy + observability)
- **brain-service = MCP Client + Planner + Memory + Multi-step**

### Entegrasyon
SK içinde:
- "Planner/Agent" (task → plan)
- "Memory" (RAG araması)
- "Tool execution" (MCP client üzerinden mcp-hub tool çağrıları)

### Testler
- **Planner tests**: "Given goal" → üretilen plan beklenen tool sırasına uyuyor mu?
- **Tool-call integration**: MCP client `listTools` ve `callTool` çalışıyor mu?
- **Memory quality**: Aynı query → aynı top chunks
- **E2E**: "Create Notion task → change code → run tests → PR open → attach links"

---

# Implementation Phases

## Phase 1: MCP Foundation (Hafta 1-2)
- [ ] Tool registry tags standardı
- [ ] MCP stdio transport tamamlama
- [ ] MCP Streamable HTTP endpoint
- [ ] OAuth 2.1 auth entegrasyonu
- [ ] Contract + integration tests

## Phase 2: Core Tools (Hafta 3-4)
- [ ] Jobs/Queue sistemi
- [ ] Workspace file operations
- [ ] Git tools (status, branch, commit)
- [ ] Tests runner entegrasyonu

## Phase 3: Integration Tools (Hafta 5-6)
- [ ] GitHub PR flow
- [ ] Notion templates
- [ ] Policy approval loop tam entegrasyon

## Phase 4: Intelligence (Hafta 7-8)
- [ ] RAG index/search
- [ ] Semantic Kernel brain service
- [ ] E2E scenario tests

---

# Tek Doğru Prensip

**mcp-hub = güvenli, deterministic tool server**
**brain-service (SK) = reasoning + planning + multi-step**

Bu ayrım hem hızlı büyütür hem de kırılmaz yapar.
