# mcp-hub — Sistem Olgunluk ve Plugin Analiz Raporu

> Phase 3 sonrası: **PLAN-V2’deki 20-plugin** ile Phase 3’te dokunulan 8 plugin karşılaştırması, tekrar analizi ve genel sistem seviyesi.

---

## 0. “20 Plugin” Tanımı (PLAN-V2)

**Kastettiğin 20 plugin**, PLAN-V2’deki **Final 20-Plugin Mimarisi**dir (Faz 1’de 11 + Faz 2’de 9 = 20):

| Katman | Plugin’ler |
|--------|------------|
| **AI Zeka** | `llm-router` · `brain` · `rag` · `prompt-registry` |
| **Kod & Git** | `github` · `git` · `shell` · `workspace` · `code-review` · `repo-intelligence` · `github-pattern-analyzer` |
| **Proje & Otomasyon** | `project-orchestrator` · `n8n` · `n8n-workflows` · `notion` · `tech-detector` |
| **Altyapı & Güvenlik** | `database` · `secrets` · `http` · `observability` |

Bu 20 plugin = “eksiksiz AI geliştirme platformu” hedefi. Repoda toplam **35** plugin var; **20’si** bu çekirdek set, **15’i** bu setin dışında (docker, slack, marketplace, file-watcher, email, vb.).

---

## 1. Sayılar ve Gruplar

| Grup | Adet | Açıklama |
|------|------|----------|
| **20-plugin (PLAN-V2 çekirdek)** | **20** | Yukarıdaki liste |
| **Phase 3’te dokunulan** | **8** | prompt-registry, shell, brain, repo-intelligence, project-orchestrator, git, workspace, code-review (hepsi 20’nin içinde) |
| **20’nin içinde, Phase 3’te dokunulmayan** | **12** | llm-router, rag, github, github-pattern-analyzer, n8n, n8n-workflows, notion, tech-detector, database, secrets, http, observability |
| **20’nin dışında kalan plugin’ler** | **15** | docker, slack, openapi, marketplace, n8n-credentials, projects, file-storage, file-watcher, email, image-gen, video-gen, notifications, policy, tests, local-sidecar |
| **Toplam plugin** | **35** | `mcp-server/src/plugins/*/index.js` |

---

## 2. Phase 3’te Dokunulan 8 Plugin — Durum

| Plugin | Yapılan | createMetadata | Explanation + audit | routeTask güvenli | Not |
|--------|---------|----------------|--------------------|-------------------|-----|
| **prompt-registry** | v2: sections, slots, render, async store, migration | ✅ | ✅ (create/update/delete/restore) | — | Çekirdek agent prompt altyapısı |
| **shell** | Session’lar, session_id, is_background, shell_session_* | ✅ | ✅ (zaten vardı) | — | Manus pattern |
| **brain** | brain_think, includeThoughts, llmResult fix | ✅ | — (think private) | ✅ content | Devin pattern |
| **repo-intelligence** | getSimilarCommits, repo_similar_commits, REST | ✅ | — | ✅ | Augment pattern |
| **project-orchestrator** | project_write_spec, project_plan_from_spec, spec store | ✅ | ✅ (write_spec) | ✅ | Kiro pattern |
| **git** | Tüm write tool’lara explanation, gitAudit reason | ✅ | ✅ (opsiyonel) | — | Faz 3D |
| **workspace** | Write tool’lara explanation, auditEntry reason | ✅ | ✅ (opsiyonel) | — | Faz 3D |
| **code-review** | llmReview / generateFix null-safe (result?.content) | ✅ | — | ✅ | Defansif |

Bu 8 plugin: **createMetadata** kullanıyor, **explanation/audit** (write’larda) ya eklendi ya zaten vardı, **LLM kullanıyorsa** `routeTask` dönüşü güvenli.

---

## 3. Dokunulmayan Plugin’ler — Özet Tablo

(12’si PLAN-V2’deki 20’nin içinde, 15’i 20’nin dışında.)

| Plugin | createMetadata | MCP tools | Write tool | Explanation/audit | routeTask | Not |
|--------|----------------|-----------|------------|--------------------|-----------|-----|
| observability | ✅ | ✅ | — | — | — | Metrik/trace |
| tests | ❌ legacy | ✅ | — | — | — | Test runner |
| notion | ✅ | ✅ | Var | Kısmen (bazı tool’larda) | — | Notion API |
| tech-detector | ✅ | ✅ | — | — | — | Stack tespit |
| email | ❌ legacy | ✅ | Var | ❌ | — | SMTP |
| image-gen | ❌ legacy | ✅ | Var | ❌ | — | AI image |
| secrets | ✅ | ✅ | Var | ❌ | — | Secret store |
| code-review | (Phase 3’te sayıldı) | ✅ | — | — | ✅ | — |
| http | ✅ | ✅ | Var | ❌ | — | HTTP client |
| file-watcher | ❌ legacy | ✅ | Var | ❌ | — | Watch FS |
| github-pattern-analyzer | ✅ | ✅ | — | — | ✅ | LLM pattern |
| notifications | ❌ legacy | ✅ | Var | ❌ | — | Bildirim |
| policy | ❌ legacy | ✅ | Var | ❌ | — | Policy engine |
| database | ✅ | ✅ | Var | ❌ | — | DB işlemleri |
| video-gen | ❌ legacy | ✅ | Var | ❌ | — | AI video |
| rag | ✅ | ✅ | Var | ❌ | — | Semantic search |
| n8n | ✅ | ✅ | Var | ❌ | — | n8n API |
| llm-router | ✅ | ✅ | Var | ✅ audit | — | LLM routing |
| n8n-workflows | ✅ | ✅ | Var | Bazı tool’larda | — | Workflow |
| github | ✅ | ✅ | Var | ❌ | — | GitHub API |
| local-sidecar | ❌ legacy | ✅ | Var | ❌ | — | Local FS |
| docker | ❌ legacy | ❌ | — | — | — | Sadece REST? |
| slack | ❌ legacy | ❌ | — | — | — | — |
| openapi | ❌ legacy | ❌ | — | — | — | — |
| marketplace | ❌ legacy | ❌ | — | — | — | — |
| n8n-credentials | ❌ legacy | ❌ | — | — | — | — |
| projects | ❌ legacy | ❌ | — | — | — | — |
| file-storage | ✅ | ❌ | — | — | — | REST, storage |

Not: “Var” = ilgili kategoride en az bir örnek var; “—” = yok veya ilgili değil.

---

## 4. Tekrar ve Tutarsızlık Analizi

### 4.1 Metadata

- **createMetadata kullanan:** prompt-registry, shell, brain, git, workspace, repo-intelligence, project-orchestrator, code-review, observability, notion, llm-router, n8n, n8n-workflows, github, github-pattern-analyzer, tech-detector, http, secrets, database, rag, file-storage, policy (bazıları farklı property set’i kullanıyor).
- **Legacy `export const name/version/description` kullanan:** marketplace, file-watcher, video-gen, docker, n8n-credentials, email, notifications, tests, image-gen, local-sidecar, openapi, projects, slack.
- **Tekrar:** Aynı plugin kümesi iki farklı “tanımlanma” biçimiyle yazılmış; loader muhtemelen ikisini de kabul ediyor. **Tutarsızlık:** Yeni eklenen veya güncellenen plugin’ler createMetadata’ya geçti, eskiler legacy kaldı.

### 4.2 Explanation + Audit

- **Write tool’larda explanation (opsiyonel veya zorunlu) + audit’te reason olan:**  
  prompt-registry, project-orchestrator, shell, **git, workspace** (Phase 3’te eklendi).
- **Write tool’u olup explanation/audit reason olmayan:**  
  notion, email, image-gen, secrets, http, file-watcher, notifications, policy, database, video-gen, rag, n8n, n8n-workflows, github, local-sidecar.
- **Tekrar:** “Neden bu tool kullanıldı?” bilgisi sadece 5 plugin’de (ve bazı tool’larda) standart; diğer write tool’lar aynı pattern’i kullanmıyor. **Tutarsızlık:** Faz 3D sadece PLAN’daki öncelikli plugin’lere (git, workspace, shell, prompt-registry, project-orchestrator) uygulandı.

### 4.3 routeTask (LLM) Kullanımı

- **`result?.content ?? ""` veya doğru obje kullanan:** brain, code-review, github-pattern-analyzer, repo-intelligence (repo.analyze), project-orchestrator.
- **Doğrudan `result.content` kullanan (undefined riski):** Başka plugin’de routeTask varsa benzer savunmacı kullanım yok; şu an bilinen riskler giderildi.

### 4.4 REST vs MCP

- **Sadece REST / yardımcı (MCP tools yok):** docker, slack, openapi, marketplace, n8n-credentials, projects, file-storage (≈7). Bunlar agent’a doğrudan “tool” sunmuyor; entegrasyon veya altyapı katmanı.

---

## 5. Sistem Ne Seviyede, Ne Durumda?

### 5.1 Olgunluk Seviyesi (Kabaca 1–5)

| Kriter | Seviye | Açıklama |
|--------|--------|----------|
| **Agent çekirdeği (prompt, bellek, shell, planlama)** | **4/5** | Section-based prompt, brain think, shell session, spec→plan, repo similar commits; premium pattern’lar uygulandı. |
| **Write işlemlerinde izlenebilirlik (explanation/audit)** | **3/5** | Git, workspace, shell, prompt-registry, project-orchestrator’da var; diğer 20+ write tool’da yok. |
| **Plugin tanımlama tutarlılığı (metadata)** | **2,5/5** | createMetadata / legacy karışık; çalışıyor ama tek tip değil. |
| **Güvenlik ve sınırlar (path, policy, scope)** | **4/5** | Path validation, allowlist, requireScope birçok yerde; policy/shell/git/workspace sıkı. |
| **LLM kullanımı güvenliği** | **4/5** | Bilinen routeTask hataları düzeltildi; tek tük eksik kalmış yer olabilir. |
| **Geniş plugin yelpazesi** | **5/5** | PLAN-V2’deki 20 çekirdek + 15 ek plugin (35 toplam); kod, repo, proje, Notion, n8n, LLM, depolama, test vb. kapsanıyor. |

**Genel sistem seviyesi:** **Yaklaşık 3,5–4 / 5** — Agent çekirdeği ve güvenlik iyi; izlenebilirlik ve metadata tutarlılığı orta; plugin sayısı ve kapsam yüksek.

### 5.2 Durum Özeti

- **Güçlü:**  
  - Phase 3 bileşenleri (prompt v2, shell sessions, brain_think, repo similar commits, spec→plan, explanation/audit on critical write tools) production’a yakın.  
  - Path/policy/scope ile güvenli çalışma alanı.  
  - Çok sayıda plugin ve MCP tool ile tek platformda toplanmış AI agent ortamı.

- **Orta:**  
  - Explanation/audit sadece 5 plugin’de standart; diğer write tool’lar aynı standarda çekilmedi.  
  - createMetadata vs legacy dağılımı tekrara ve ileride refactor ihtiyacına işaret ediyor.

- **Zayıf / Risk:**  
  - 20’nin içinde dokunulmayan 12 plugin’de (ve 20 dışındakilerde) routeTask kullanan başka yer varsa `result?.content` benzeri hatalar kalabilir (şu an bilinen örnekler düzeltildi).  
  - “20 plugin” artık net: PLAN-V2 Final 20-Plugin listesi (Bölüm 0); docker, slack, marketplace vb. bu 20’de yok.

---

## 6. “20 Plugin” Tanımı (Özet)

**“20 plugin”** = PLAN-V2’deki **Final 20-Plugin Mimarisi** (Bölüm 0’daki tablo). Faz 1’de 11 + Faz 2’de 9; eksiksiz AI geliştirme platformu hedefi. Phase 3’te bu 20’den **8’ine** dokunuldu; **12’si** aynı standartlara (explanation/audit, routeTask güvenliği) henüz tam çekilmedi. Repodaki diğer **15** plugin bu çekirdek setin dışında.

---

## 7. Öneriler (Kısa)

1. **Explanation/audit:** Notion, n8n-workflows, github, database, rag vb. write tool’u olan plugin’lerde optional `explanation` + audit’te `reason` yaygınlaştırılsın (Faz 3D’nin devamı).
2. **Metadata:** Legacy export kullanan plugin’ler kademeli olarak createMetadata’ya geçirilsin; catalog/loader uyumluluğu korunarak.
3. **routeTask taraması:** Tüm plugin’lerde `routeTask(` ve `.content` kullanımı taranıp null-safe pattern’e çekilsin.
4. **Dokümantasyon:** Hangi plugin’lerin “agent çekirdeği” (Phase 3), hangilerinin “genişleme” sayıldığı README veya ARCHITECTURE’da net yazılsın; “20 plugin” tanımı burada sabitlensin.

---

## 8. 20 Plugin: Core Bağlantı, Tutarlılık ve Tekrarlar

Bu bölüm **sadece PLAN-V2'deki 20 plugin** için: core modüle bağlılık, aralarındaki tutarsızlıklar ve tekrar eden yapılar.

### 8.1 Core Modüle Bağlantı

Tüm 20 plugin **core'a bağlı**; farklı core bileşenleri kullanıyorlar:

| Core bileşen | Kullanım | 20'de kullanan plugin'ler |
|--------------|---------|----------------------------|
| **auth** (`requireScope`) | REST route koruma | database, n8n-workflows, observability, tech-detector, code-review, shell, brain, rag, github-pattern-analyzer, secrets, http, prompt-registry, git, workspace |
| **audit/index.js** (`auditLog`, `getAuditManager`, `generateCorrelationId`) | İşlem audit'i | git, shell, llm-router, prompt-registry, project-orchestrator, brain, repo-intelligence, n8n, n8n-workflows, github-pattern-analyzer, http, rag, notion, github, **workspace** (yerel audit kaldırıldı; core kullanıyor) |
| **audit.js** (request log) | `getLogs`, `getStats` (sadece observability) | observability |
| **plugins/index.js** (`createMetadata`, `PluginStatus`, `RiskLevel`) | Metadata | 20'nin tamamı createMetadata kullanıyor |
| **error-standard.js** (`createPluginErrorHandler`, `Errors`) | Hata standardizasyonu | Çoğu (database, http, code-review, tech-detector, shell, brain, git, workspace, prompt-registry, n8n-workflows, github, notion, llm-router, rag, secrets, github-pattern-analyzer, repo-intelligence, project-orchestrator) |
| **tool-registry.js** (`ToolTags`, `registerTool` via loader) | MCP tool tanımı | 20'nin hepsi (tools export edenler) |
| **policy** (`canExecute`, `canAccessDatabase`, `canResolveSecret` vb.) | İzin kontrolü | shell, database, secrets |
| **redis.js** | Bellek/state | brain, project-orchestrator, github-pattern-analyzer |
| **jobs.js** | Arka plan işi | project-orchestrator |
| **validate.js** | Body/query validasyonu | database, github, notion, http |
| **config.js** | Konfig | http, n8n-workflows, n8n, notion |
| **resilience.js** | withResilience | llm-router, notion |
| **health/index.js** | HealthStatus, getHealthService | observability |

**Özet:** 20 plugin core'a bağlı; hepsi en az bir core modülü (auth, audit, plugins, error-standard, tool-registry) kullanıyor. **Workspace** artık core audit kullanıyor: yerel in-memory audit kaldırıldı, `auditLog` / `getAuditManager` / `generateCorrelationId` core'dan alınıyor; audit kayıtları merkezi sink’lere gidiyor.

### 8.2 Tutarsızlıklar (20 Plugin İçinde)

| Konu | Durum | Açıklama |
|------|--------|----------|
| **Audit import path** | Düzeltildi | **github** `auditLog`'u `../../core/audit.js`'ten alıyordu; `audit.js` sadece request log (getLogs, getStats) export ediyor, `auditLog` yok. **Düzeltme:** `../../core/audit/index.js` kullanılacak şekilde güncellendi. |
| **Workspace audit** | Düzeltildi | Workspace artık **core audit** kullanıyor; yerel `auditEntry`/`getAuditLogEntries` kaldırıldı, `auditLog` + `getAuditManager().getRecentEntries({ plugin: "workspace" })` kullanılıyor. |
| **Observability import path** | Tutarlı | `getLogs`/`getStats` için `../../core/audit.js` doğru (request log). Metadata için `../../core/plugins/index.js`; `getPlugins` için `../../core/plugins.js` (loader) — iki farklı "plugins" modülü bilinçli. |
| **createMetadata + name** | Kabul edilebilir | Birçok plugin hem `metadata` hem `export const name` veriyor. Loader `plugin.name \|\| plugin.metadata?.name \|\| dir` kullandığı için ikisi de destekleniyor. |
| **Explanation/audit reason** | Kısmi | Sadece git, workspace, shell, prompt-registry, project-orchestrator write tool'larında var. notion, n8n, n8n-workflows, github, database, rag write'larında yok. |

### 8.3 Tekrarlar (20 Plugin İçinde)

| Tekrar | Nerede | Öneri |
|--------|--------|--------|
| **routeTask (LLM)** | brain, code-review, github-pattern-analyzer, project-orchestrator, repo-intelligence → `../llm-router/index.js` | Plugin-to-plugin; core'da değil. Hepsi llm-router'dan import ediyor; `result?.content` null-safety Phase 3'te eklendi. |
| **Audit helper** | git: `gitAudit()`, github: `githubAudit()`, http: wrapper'lar | Her plugin ince wrapper; ortak core helper isteğe bağlı. |
| **name + metadata.name** | Birçok plugin | Loader uyumluluğu için; tekrar işlevsel. |

### 8.4 Sonuç (20 Plugin Özelinde)

- **Core bağlantı:** 20 plugin core'a bağlı; workspace dosya audit'i de core üzerinden (core audit'e geçiş yapıldı).
- **Tutarsızlık:** (1) Github audit import düzeltildi. (2) Workspace core audit'e taşındı. (3) Explanation/audit reason 20'nin tamamında write'larda yok.
- **Tekrar:** routeTask tek kaynaktan; audit wrapper ve name+metadata tekrarları kabul edilebilir.

---

_Son güncelleme: 2026-03-11_
