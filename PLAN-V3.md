# mcp-hub — Phase 3: Premium AI Agent Platform

> **İlham kaynağı:** [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) — Cursor, Devin, Manus, Augment, Kiro, Windsurf vb. premium AI coding tool'larının sızdırılmış system prompt ve tool tanımları.  
> **Hedef:** Bu pattern'ları mcp-hub'a taşıyarak open source alanda benzeri olmayan bir AI agent platformu inşa etmek.

---

## Özet

| Bileşen | Mevcut | Hedef |
|---------|--------|-------|
| **prompt-registry** | Düz text template store, sync I/O, race condition | Section-based composition engine, brain-aware, versioned, async |
| **shell** | Stateless, her çağrı bağımsız | Stateful sessions (Manus pattern), session id ile devam |
| **brain** | Memory, project, habits | + `brain_think` reasoning scratchpad (Devin pattern) |
| **repo-intelligence** | Mevcut kod analizi | + git-commit-retrieval (Augment pattern) |
| **project-orchestrator** | Plan → execute | Spec → Plan → Implement chain (Kiro pattern) |
| **Audit standard** | Bazı plugin'lerde explanation | Tüm write tool'larda `explanation` field (Cursor pattern) |

---

## Bölüm 1: Prompt-Registry — Tam Yeniden Tasarım

### 1.1 Mevcut Durumun Kısıtları

```
❌ content: string — monolitik blob, section'lara bölünemez
❌ Versiyonlama sadece full snapshot — section bazlı diff yok
❌ Brain entegrasyonu yok — user memory/preferences inject edilemiyor
❌ Tool-prompt coupling yok — hangi prompt hangi tool'larla çalışacak tanımlı değil
❌ Mode switching yok — agent/spec/review/debug ayrımı yok
❌ Sync readFileSync/writeFileSync — race condition, blocking
❌ Context slot'ları yok — {{project_name}}, {{user_prefs}} gibi runtime substitution yok
```

### 1.2 Hedef Mimari: Section-Based Composition Engine

Premium AI tool'larının (Cursor, Devin, Augment) prompt'ları **named section'lardan** oluşur. Her section ayrı ayrı override edilebilir, compose edilebilir, versiyonlanabilir.

#### 1.2.1 Prompt Schema (Yeni Veri Modeli)

```typescript
// Yeni prompt-registry veri modeli
interface PromptDocument {
  id: string;                    // prompt-xxxxxxxx
  name: string;                  // "cursor-agent-style"
  description: string;          // Kısa açıklama
  mode: "agent" | "spec" | "review" | "debug" | "chat";  // Kiro/Devin pattern
  version: number;               // Semantik versiyon (1, 2, 3...)
  createdAt: string;             // ISO 8601
  updatedAt: string;

  // Section-based content — her biri ayrı override edilebilir
  sections: {
    identity?: string;           // "Sen bir AI coding assistant..."
    capabilities?: string;       // Yapabildiği işler listesi
    flow?: string;               // Karar döngüsü: 1. Analiz 2. Planla 3. Execute
    tool_calling?: string;       // Tool kullanım kuralları (paralel, explanation zorunlu)
    response_style?: string;     // Markdown, backtick, kısa cümle
    code_style?: string;         // Guard clause, early return, comment policy
    context_understanding?: string;  // Arama stratejisi (semantic vs grep)
    memory_injection?: string;   // "{{brain.recent_memories}}" — brain slot
    preferences_injection?: string;  // "{{brain.user_preferences}}"
    completion_spec?: string;    // Görev bitişi kuralları
    non_compliance?: string;     // Self-correction mekanizması
    [key: string]: string | undefined;  // Genişletilebilir custom section'lar
  };

  // Runtime'da doldurulacak slot'lar — mustache/Handlebars benzeri
  contextSlots: string[];        // ["{{project_name}}", "{{user_prefs}}", "{{brain.recent_memories}}"]

  // Bu prompt hangi MCP tool'larla kullanılacak (opsiyonel filtre)
  toolsBundle?: string[];        // ["shell", "workspace", "git", "codebase_search"]

  tags: string[];
  isDefault?: boolean;           // Bu tag için varsayılan prompt
}
```

#### 1.2.2 Section Türleri (Standart Set)

| Section Key | Açıklama | Örnek Kaynak |
|-------------|----------|---------------|
| `identity` | Kimlik, rol, yetenek özeti | Cursor, Devin, Kiro |
| `capabilities` | Yapabildiği işler (bullet list) | Manus, Kiro |
| `flow` | Karar döngüsü adımları | Cursor `<flow>`, Manus agent loop |
| `tool_calling` | Paralel çağrı, explanation zorunluluğu | Cursor `<tool_calling>` |
| `response_style` | Markdown, backtick, kısa cümle | Cursor `<markdown_spec>`, Kiro |
| `code_style` | Guard clause, comment policy | Cursor `<code_style>` |
| `context_understanding` | Semantic vs grep, arama stratejisi | Cursor `<context_understanding>` |
| `memory_injection` | Brain'den inject edilecek blok | Augment `# Memories` |
| `preferences_injection` | User tercihleri | Augment `# Preferences` |
| `completion_spec` | Görev bitişi, summary formatı | Cursor `<completion_spec>` |
| `non_compliance` | Self-correction kuralları | Cursor `<non_compliance>` |
| `todo_spec` | Todo list yönetimi | Cursor `<todo_spec>` |

#### 1.2.3 Context Slot Sistemi

Runtime'da prompt render edilirken `{{...}}` pattern'ları çözülür:

| Slot | Kaynak | Açıklama |
|------|--------|----------|
| `{{brain.recent_memories}}` | brain plugin | Son N memory (buildCompactContext benzeri) |
| `{{brain.user_preferences}}` | brain plugin | Profile.preferences + codingStyle |
| `{{brain.active_project}}` | brain plugin | Aktif proje bilgisi |
| `{{project_name}}` | Caller | Çağıran tarafından geçilen context |
| `{{user_prefs}}` | Caller | Kullanıcı tercihleri override |
| `{{current_date}}` | System | new Date().toISOString().split('T')[0] |
| `{{workspace_root}}` | Config | WORKSPACE_BASE veya WORKSPACE_ROOT |

**Çözümleme sırası:** System → brain (eğer plugin yüklüyse) → caller context.

#### 1.2.4 Render Algoritması

```
1. sections objesini key sırasına göre (identity → capabilities → ... → non_compliance) birleştir
2. Birleşik string içindeki her {{slot}} için:
   - brain.* slot'ları → brain plugin'den resolve et (buildCompactContext, getProfile)
   - System slot'ları → config/Date'ten al
   - Caller slot'ları → render(context) parametresinden al
3. Eksik slot varsa: boş string veya "[not available]" (configurable)
4. Final string döndür
```

#### 1.2.5 Storage

- **Dosya:** `CATALOG_CACHE_DIR/prompts-v2.json` (v1'den ayrı, migration gerekir)
- **Format:** JSON, `{ prompts: PromptDocument[], versions: Record<id, Record<version, PromptDocument>> }`
- **Async:** `fs/promises` (readFile, writeFile) — sync kaldırılacak
- **Lock:** Basit file lock veya single-writer queue (race condition önleme)

#### 1.2.6 Versiyonlama Detayı

- Her `prompt_update` yeni version numarası oluşturur (N+1)
- `versions[id][v]` = o version'ın tam snapshot'ı
- Section bazlı diff: opsiyonel, ileride `prompt_diff` tool ile
- Restore: `versions[id][v]` → `prompts` array'ine geri yaz

#### 1.2.7 Brain Entegrasyonu

```javascript
// prompt-registry render sırasında
if (slot === "brain.recent_memories" && brainPluginAvailable) {
  const ctx = await buildCompactContext({ namespace, projectId, limit: 5 });
  return ctx?.memoriesBlock || "";
}
if (slot === "brain.user_preferences" && brainPluginAvailable) {
  const profile = await getProfile(namespace);
  return formatProfile(profile) || "";
}
```

- **Bağımlılık:** prompt-registry, brain plugin'i optional import ile yükler (graceful degradation)
- **Namespace:** `context.namespace` veya `BRAIN_NAMESPACE` env

#### 1.2.8 Yeni REST Endpoints

| Method | Path | Açıklama |
|--------|------|----------|
| GET | /prompts/health | Plugin health |
| GET | /prompts | List (tag, mode filter) |
| GET | /prompts/:id | Get by id |
| GET | /prompts/:id/render | **YENİ** — context ile render et, slot'ları çöz |
| POST | /prompts | Create (sections ile) |
| PUT | /prompts/:id | Update (section bazlı partial update) |
| GET | /prompts/:id/versions | Version listesi |
| POST | /prompts/:id/versions/:v/restore | Restore |
| DELETE | /prompts/:id | Delete |

#### 1.2.9 Yeni MCP Tools

| Tool | Açıklama |
|------|----------|
| prompt_list | Mevcut (tag, mode filter ekle) |
| prompt_get | Mevcut (version parametresi) |
| **prompt_render** | **YENİ** — id + context ile render, slot'ları çöz, final string döndür |
| prompt_create | Güncelle — sections objesi kabul et |
| prompt_update | Güncelle — sections partial update |
| prompt_delete | Mevcut |
| **prompt_sections** | **YENİ** — Standart section key'lerini listele (identity, flow, ...) |

#### 1.2.10 Migration (v1 → v2)

- Mevcut `prompts.json` okunur
- `content` string → `sections: { identity: content }` (tek section'a taşınır)
- `contextSlots: []`, `toolsBundle: []`, `mode: "agent"` default
- Yeni `prompts-v2.json` yazılır
- Env: `PROMPT_REGISTRY_USE_V2=true` ile v2 aktif
- v1 formatı 1 release deprecation sonra kaldırılır

---

## Bölüm 2: Shell Plugin — Stateful Sessions

### 2.1 Mevcut Durum

- Her `shell_execute` çağrısı bağımsız process spawn ediyor
- Önceki komutun cwd'si, env'i, state'i korunmuyor
- Uzun görevler (npm install, test suite) için agent her seferinde `cd` + komut tekrarlamak zorunda

### 2.2 Hedef: Manus Pattern

Manus'ta `shell_exec`, `shell_view`, `shell_wait`, `shell_write_to_process`, `shell_kill_process` var. Ortak nokta: **session id**.

#### 2.2.1 Session Modeli

```javascript
// In-memory session store (restart'ta kaybolur — ileride Redis)
const sessions = new Map(); // sessionId -> { cwd, env, pid?, history[] }

// Session oluşturma: ilk exec'te id verilmezse otomatik oluşturulur
// Session devam: aynı id ile exec → aynı shell'de çalışır
```

#### 2.2.2 Yeni/Güncellenen Tool'lar

| Tool | Değişiklik |
|------|------------|
| shell_execute | **session_id** (optional) parametresi. Verilmezse yeni session, verilirse mevcut session'da exec. **is_background** (optional) — true ise hemen dön, output bekleme. |
| **shell_session_create** | **YENİ** — Boş session oluştur, cwd ve env ile. session_id döndür. |
| **shell_session_list** | **YENİ** — Aktif session'ları listele (id, cwd, pid, lastCommand) |
| **shell_session_close** | **YENİ** — Session'ı kapat, process varsa kill |
| **shell_session_output** | **YENİ** — Session'ın son N satır output'unu getir (Manus shell_view) |

#### 2.2.3 Session Lifecycle

1. `shell_session_create` veya `shell_execute` (session_id yok) → yeni session
2. `shell_execute` (session_id var) → mevcut session'da `cd cwd && command`
3. `is_background: true` → spawn, hemen dön, output `shell_session_output` ile alınır
4. `shell_session_close` → process kill, session Map'ten sil

#### 2.2.4 Güvenlik

- Session'lar da allowlist + DANGEROUS_PATTERNS'e tabi
- Session cwd WORKSPACE_BASE içinde olmalı (path validation)
- Max session sayısı: `SHELL_MAX_SESSIONS=10` (env)
- Session TTL: 30 dakika idle → otomatik close (opsiyonel)

---

## Bölüm 3: Brain Plugin — Reasoning Scratchpad

### 3.1 Devin Pattern: `<think>` Tool

Devin'de kritik kararlardan önce `<think>...</think>` kullanılıyor. Execution yok, sadece reasoning log. Model "düşünüyor", kullanıcı görmüyor, sonra aksiyona geçiyor.

### 3.2 brain_think Tool

```javascript
{
  name: "brain_think",
  description: "Private reasoning scratchpad. Record your thoughts, weigh options, reason about next steps before taking action. User does NOT see this. Use before critical decisions: git operations, multi-file edits, completion claims.",
  tags: [ToolTags.READ_ONLY],  // Write to brain, but no external effect
  inputSchema: {
    type: "object",
    properties: {
      thought: { type: "string", description: "Your reasoning, observations, conclusions" },
      context: { type: "string", description: "What triggered this thought (optional)" }
    },
    required: ["thought"]
  },
  handler: async ({ thought, context }) => {
    // Redis'e veya session-scoped in-memory buffer'a yaz
    // Kullanıcıya dönen response'ta GÖSTERME — sadece "ok" veya minimal ack
    // İleride: buildContext'ta "recent thoughts" olarak LLM'e inject edilebilir
    return { ok: true, data: { acknowledged: true } };
  }
}
```

#### 3.2.1 Storage

- **Seçenek A:** Redis `brain:session:{sessionId}:thoughts` list — son 10 thought, TTL 1 saat
- **Seçenek B:** In-memory, sadece current request scope — buildContext'a geçirilir, kalıcı değil
- **Seçenek C:** Episodic memory olarak kaydet — `type: "thought"`, `content: thought` — ama bu memory'yi kirletir

**Öneri:** Seçenek A — session-scoped, kalıcı değil, buildContext'ta "Recent reasoning" olarak inject edilebilir.

#### 3.2.2 buildContext Entegrasyonu

`buildCompactContext` ve `buildContext`'a opsiyonel `includeThoughts: true` parametresi. Varsa son 5 thought'u "## Recent Reasoning" başlığıyla ekle.

---

## Bölüm 4: Repo-Intelligence — Git Commit Retrieval

### 4.1 Augment Pattern

Augment'ın `git-commit-retrieval` tool'u: "How were similar changes made in the past?" — commit mesajları ve diff'lere bakarak benzer değişiklik pattern'larını buluyor.

### 4.2 Yeni Fonksiyon: getSimilarCommits

```javascript
// repo.core.js veya repo.analyze.js
export async function getSimilarCommits(repoPath, query, options = {}) {
  // 1. git log --oneline -50 (veya limit)
  // 2. Her commit için: git show --stat veya git show --name-only
  // 3. Query ile semantic match (basit: commit message + file list keyword match)
  // 4. İleride: embedding ile semantic similarity (RAG benzeri)
  // 5. Döndür: [{ hash, message, files[], date }]
}
```

#### 4.2.1 Yeni MCP Tool: repo_similar_commits

```javascript
{
  name: "repo_similar_commits",
  description: "Find past commits that are similar to the current task. Use to understand how similar changes were made before.",
  inputSchema: {
    properties: {
      path: { type: "string" },
      query: { type: "string", description: "What kind of change (e.g. 'add authentication', 'fix memory leak')" },
      limit: { type: "number", default: 5 }
    },
    required: ["query"]
  },
  handler: async ({ path, query, limit }) => { ... }
}
```

#### 4.2.2 REST Endpoint

`GET /repo-intelligence/commits/similar?path=&query=&limit=5`

---

## Bölüm 5: Project-Orchestrator — Spec → Plan → Implement

### 5.1 Kiro Pattern

Kiro'da: `Mode_Classifier` → `Spec_Prompt` → `Vibe_Prompt`. Önce ne yapılacağı spec olarak yazılıyor, sonra implementation.

### 5.2 Mevcut project-orchestrator

- Plan oluşturma, task breakdown, Notion/GitHub entegrasyonu var
- Ama "spec first" aşaması yok

### 5.3 Hedef Akış

```
1. User: "Add auth to the API"
2. [Spec Mode] Agent: Spec dokümanı yaz — endpoint'ler, flow, güvenlik gereksinimleri
3. [Plan Mode] Agent: Spec'e göre task listesi çıkar — todo_write benzeri
4. [Implement Mode] Agent: Task'ları sırayla execute et
```

#### 5.3.1 Yeni Tool: project_write_spec

```javascript
{
  name: "project_write_spec",
  description: "Write a detailed specification document before implementation. Use when the task is complex or ambiguous.",
  inputSchema: {
    properties: {
      task: { type: "string" },
      context: { type: "object" },
      outputFormat: { type: "string", enum: ["markdown", "structured"] }
    },
    required: ["task"]
  },
  handler: async ({ task, context }) => {
    // LLM'e "Write a spec for: {task}" prompt'u gönder
    // Spec'i Notion'a veya geçici store'a kaydet
    return { ok: true, data: { spec, specId } };
  }
}
```

#### 5.3.2 project_plan_from_spec

- Mevcut `project_plan` veya benzeri — `specId` parametresi ekle
- Spec dokümanını context'e al, ona göre plan çıkar

---

## Bölüm 6: Explanation Field Standardı (Cursor Pattern)

### 6.1 Kural

Cursor'da neredeyse her tool'da `explanation` field'ı var: "One sentence explanation as to why this tool is being used."

### 6.2 mcp-hub Uygulaması

- **Yeni write tool'lar:** `explanation` required veya strongly recommended
- **Mevcut tool'lar:** Yavaş yavaş ekle (breaking değil, optional bırakılabilir)
- **Audit:** explanation varsa audit log'a `reason` olarak yaz

### 6.3 Hangi Tool'lar Öncelikli

| Plugin | Tool | Öncelik |
|--------|------|---------|
| git | git_commit, git_push, git_branch_create | Yüksek |
| workspace | workspace_write_file, workspace_delete_file | Yüksek |
| n8n-workflows | n8n_create_workflow, n8n_activate_workflow | Zaten var |
| shell | shell_execute | Yüksek |
| code-review | - | Orta |

---

## Bölüm 7: Uygulama Sırası

### Faz 3A: Prompt-Registry (Kritik)

| Adım | İş | Tahmini |
|------|-----|---------|
| 1 | Yeni schema, sections, contextSlots tanımla | 1 gün |
| 2 | Async storage (fs/promises), lock/queue | 0.5 gün |
| 3 | Slot resolution (brain, system, caller) | 1 gün |
| 4 | prompt_render tool + GET /prompts/:id/render | 0.5 gün |
| 5 | prompt_create/update sections desteği | 0.5 gün |
| 6 | Migration v1→v2 | 0.5 gün |
| 7 | createMetadata, requireScope, auditLog | 0.5 gün |

### Faz 3B: Shell Sessions

| Adım | İş | Tahmini |
|------|-----|---------|
| 1 | Session Map, create/list/close | 0.5 gün |
| 2 | shell_execute session_id, is_background | 1 gün |
| 3 | shell_session_* tools | 0.5 gün |
| 4 | Path validation, max sessions | 0.5 gün |

### Faz 3C: Brain + Repo + Orchestrator

| Adım | İş | Tahmini |
|------|-----|---------|
| 1 | brain_think tool | 0.5 gün |
| 2 | repo_similar_commits | 1 gün |
| 3 | project_write_spec, plan_from_spec | 1 gün |

### Faz 3D: Explanation Standard

| Adım | İş | Tahmini |
|------|-----|---------|
| 1 | inputSchema'lara explanation ekle (optional) | 0.5 gün |
| 2 | Audit log reason field | 0.5 gün |

---

## Bölüm 8: Bağımlılık Grafiği

```
prompt-registry (v2)
    ├── brain (memory_injection, preferences) — optional
    ├── llm-router (render sırasında değil, sadece caller kullanır)
    └── fs/promises, path, crypto

shell (sessions)
    └── Mevcut policy, audit, allowlist

brain (think)
    └── Redis veya in-memory

repo-intelligence (similar commits)
    └── git commands, safeResolvePath

project-orchestrator (spec)
    └── llm-router, notion (opsiyonel)
```

---

## Bölüm 9: Kabul Kriterleri

### Prompt-Registry

- [ ] `prompt_create` sections objesi ile çalışıyor
- [ ] `prompt_render` {{brain.recent_memories}} slot'unu çözüyor (brain yüklüyse)
- [ ] `prompt_render` {{current_date}} çözüyor
- [ ] Async storage, sync I/O yok
- [ ] v1 migration çalışıyor

### Shell Sessions

- [ ] `shell_execute` session_id ile aynı cwd'de devam ediyor
- [ ] `shell_session_list` aktif session'ları gösteriyor
- [ ] is_background: true ile uzun komut arka planda çalışıyor

### Brain Think

- [ ] `brain_think` audit log'a yazmıyor (private)
- [ ] buildContext includeThoughts ile son thought'lar inject ediliyor

### Repo Similar Commits

- [ ] `repo_similar_commits` query ile ilgili commit'leri döndürüyor

---

## Bölüm 10: Referans Dosyalar (system-prompts Repo)

| Dosya | Kullanım |
|-------|----------|
| `Cursor Prompts/Agent Tools v1.0.json` | Tool schema pattern'ları, explanation field |
| `Cursor Prompts/Agent Prompt 2025-09-03.txt` | Section yapısı (flow, tool_calling, code_style) |
| `Devin AI/Prompt.txt` | <think> pattern, planning/standard mode |
| `Manus Agent Tools & Prompt/tools.json` | shell_session pattern, browser, deploy |
| `Manus Agent Tools & Prompt/Agent loop.txt` | Agent loop adımları |
| `Augment Code/claude-4-sonnet-agent-prompts.txt` | # Memories, # Preferences, git-commit-retrieval |
| `Kiro/Spec_Prompt.txt` | Spec-first workflow |

---

## Bölüm 11: İleride (Phase 4)

- **Deploy plugin:** Manus'taki `deploy_expose_port`, `deploy_apply_deployment` benzeri
- **Browser automation:** Manus browser_* tool'ları — ayrı plugin veya http + puppeteer
- **Prompt diff:** Section bazlı versiyon karşılaştırma
- **Prompt template marketplace:** Community prompt'ları import/export

---

_Son güncelleme: 2026-03-11_
