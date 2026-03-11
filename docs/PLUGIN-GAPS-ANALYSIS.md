# Plugin Gaps Analysis (Phase 3 sonrası)

> Diğer plugin'lerde yapılmamış / eksik kalan işlerin özeti. Test öncesi checklist.

---

## 1. Explanation + Audit (Faz 3D — PLAN-V3 Bölüm 6)

**Hedef:** Write tool'larda opsiyonel `explanation`, audit log'da `reason`.

| Plugin | Tool'lar | Durum |
|--------|----------|--------|
| **prompt-registry** | create, update, delete, restore_version | ✅ Yapıldı — explanation optional, audit'te reason |
| **project-orchestrator** | project_write_spec | ✅ Yapıldı — explanation optional, audit'te reason |
| **shell** | shell_execute | ✅ Zaten var — explanation required, audit'te kullanılıyor |
| **git** | git_commit, git_push, git_branch_create, git_add, git_checkout, git_stash, git_pull | ❌ **Eksik** — inputSchema'da explanation yok, gitAudit'e reason geçilmiyor |
| **workspace** | workspace_write_file, workspace_delete_file, workspace_move_file, workspace_patch | ❌ **Eksik** — explanation yok; auditEntry reason parametresi var ama "neden bu tool kullanıldı" için kullanılmıyor |

**Öneri:** Git ve workspace write tool'larına optional `explanation` ekleyip, audit çağrılarına `reason: args.explanation` geçmek (breaking değil).

---

## 2. routeTask Dönüşü (LLM cevabı)

**Kural:** `routeTask` obje döndürür: `{ content, provider?, model? }`. String bekleyen yerler `llmResult?.content ?? ""` kullanmalı.

| Plugin | Kullanım | Durum |
|--------|----------|--------|
| **brain** | summarizeAndSaveSession, brain_analyze_habits, brain_what_do_you_know_about | ✅ Düzeltildi — `llmResult?.content ?? ""` |
| **code-review** | llmReview → `result.content`, generateFix → `result.content` | ⚠️ **Savunmacı** — `result` undefined olursa crash; `result?.content ?? ""` kullanılabilir |
| **github-pattern-analyzer** | `result?.content ?? ""` | ✅ Doğru kullanım |
| **repo-intelligence** | repo.analyze.js → llmResult.content (parse ediyor) | ✅ Doğru (object destructure) |
| **project-orchestrator** | parseJSON(result.content) | ✅ Doğru |

**Öneri:** code-review içinde `llmReview` ve `generateFix`'te `const raw = result?.content ?? ""` ile null-safe yapmak (opsiyonel, defensive).

---

## 3. createMetadata vs Legacy Export

Bazı plugin'ler hâlâ `export const name = "…"` kullanıyor; diğerleri `createMetadata` + `metadata.name` kullanıyor. Catalog/loader muhtemelen her iki şekli de kabul ediyor; tutarlılık için ileride hepsini metadata'ya taşımak isteyebilirsin.

**Legacy export kullananlar (metadata kullanmayan):**  
marketplace, file-watcher, video-gen, docker, n8n-credentials, email, notifications, llm-router, notion, file-storage, openapi, projects, tests, database, image-gen, policy, local-sidecar, github, rag, slack, shell.

**createMetadata kullananlar:**  
prompt-registry, brain, git, workspace, repo-intelligence, project-orchestrator, github-pattern-analyzer, n8n (vs).

Bu madde Phase 3 kapsamı dışında; refactor/consistency için not.

---

## 4. PLAN-V3 Dışı Genel Eksikler

- **code-review:** PLAN'da "explanation orta öncelik" deniyor; write/riskli aksiyon yok, sadece review döndürüyor. İstenirse tool açıklamasına "why you're running this review" eklenebilir.
- **Workspace audit:** `auditEntry` zaten `reason` alanına sahip (deny nedeni). "Tool kullanım nedeni" (explanation) ayrı bir alan olarak eklenebilir; mevcut `reason` deny/error için kalsın.
- **Git audit:** `gitAudit` şu an `operation, actor, repoPath, success, error` alıyor; `reason` (veya `explanation`) eklenebilir.

---

## 5. Özet Aksiyon Listesi

| Öncelik | İş | Plugin |
|---------|-----|--------|
| Yüksek | Write tool'lara optional `explanation` ekle, audit'e `reason` yaz | git |
| Yüksek | Write tool'lara optional `explanation` ekle, audit entry'ye reason/explanation geç | workspace |
| Orta | `result?.content ?? ""` ile null-safe yap | code-review (llmReview, generateFix) |
| Düşük | Tüm plugin'leri createMetadata pattern'ine geçir | Tümü (refactor) |

---

_Son güncelleme: 2026-03-11_
