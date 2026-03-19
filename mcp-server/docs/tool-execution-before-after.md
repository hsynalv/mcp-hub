# Tool execution pipeline — önce / sonra

Bu doküman, merkezi tool execution pipeline refaktörünün **önceki** ve **sonraki** durumunu özetler. Kod tabanı: `mcp-server/`.

---

## Genel mimari

| Konu | Önce | Şimdi |
|------|------|--------|
| Tool çalıştırma | `callTool` içinde doğrusal kod: before-hook → handler → stderr audit → after-hook | `callTool` yalnızca lookup + `executeRegisteredTool(...)` delegasyonu; asıl sıra `src/core/tool-execution/execute-tool.js` içinde |
| Modülerlik | Tek dosyada toplanmış mantık | `with-timeout`, `validate-input`, `normalize-result`, `mask-sensitive-data`, `execute-tool` ayrı modüller |
| MCP HTTP / STDIO | İkisi de `gateway.js` → `callTool` | Aynı; `gateway` context’e `source: "mcp"`, `scopes` eklendi |

---

## `src/core/tool-registry.js`

| Önce | Şimdi |
|------|--------|
| `callTool` içinde handler, zarf, audit, hook çağrıları tek blokta | `callTool` varsa `executeRegisteredTool` çağırır |
| `tool_not_found` yanıtında `meta` yoktu | `meta.requestId` (varsa) ve `meta.durationMs: 0` |
| Kayıtlı araçta `timeoutMs` yoktu | `registerTool` ile gelen `timeoutMs` Map’te saklanır |
| Kullanılmayan importlar (`getPolicyEvaluator`, vb.) | Temizlendi; `getApprovalStore` `approveTool` için kaldı |
| `initializeToolHooks` boş no-op yorumu | Hâlâ boş gövde; metrikler pipeline içinde (`emitToolMetrics`) |
| `logToolExecution` yerel fonksiyon, ham `parameters`/`result` | Audit satırı `execute-tool` içinde `maskToolAuditPayload` ile |

---

## Yeni dizin: `src/core/tool-execution/`

| Dosya | Önce | Şimdi |
|-------|------|--------|
| `execute-tool.js` | Yok | Tüm aşamalar: before-hook → validate → timeout+handler → normalize → maskeli audit → `recordToolCall` (dynamic import) → `executeAfterHooks` |
| `validate-input.js` | Yok | `inputSchema` için runtime doğrulama (`required`, `properties`, temel tipler, `enum`); `$ref` yok |
| `normalize-result.js` | Yok | Handler çıktısı ve hook kısa devreleri için `{ ok, data?, error?, meta }`; `approval_required` → `require_approval` |
| `with-timeout.js` | Yok | `Promise.race`; `ms <= 0` ise limitsiz |
| `mask-sensitive-data.js` | Yok | `audit.js` `maskBody` ile uyumlu derin maskeleme; audit satırı için |

---

## `src/core/tool-hooks.js`

| Önce | Şimdi |
|------|--------|
| `executeAfterHooks` çağrılıyordu; çoğu senaryoda kayıtlı hook yoktu | Davranış aynı; testlerde ve eklentilerde `registerAfterExecutionHook` kullanımı doğrulandı |

---

## `src/mcp/gateway.js`

| Önce | Şimdi |
|------|--------|
| Context: `method`, `user`, `requestId`, workspace/project/env | Aynı alanlar + `source: "mcp"`, `scopes: authInfo.scopes ?? []` |

---

## `src/mcp/http-transport.js`

| Önce | Şimdi |
|------|--------|
| Workspace: yalnızca `req.workspaceId` / `req.projectId` (middleware şart) | Aynı + header fallback: `x-workspace-id`, `x-project-id` |
| `jsonrpc !== "2.0"` gövdeleri InMemory transport’a gidiyor, istemci asılı kalabiliyordu | Erken yanıt: HTTP 200 + JSON-RPC `-32600 Invalid Request` |
| — | Davranış: minimal Express uygulamaları ve testler header’dan context alır |

---

## `src/core/audit.js` — `maskBody`

| Önce | Şimdi |
|------|--------|
| İç içe **dizi** alanları `Object.entries` ile bozuluyordu (audit payload’da `errors` dizisi nesneye dönüşüyordu) | `Array.isArray` ile öğe bazlı özyineleme; nesne alanları eskisi gibi |

---

## Plugin bypass — doğrudan `handler` çağrısı

| Önce | Şimdi |
|------|--------|
| `prompt-registry` REST route’ları `tool.handler(...)` | `callTool("prompt_*", args, { ...toolCtx, source: "rest" })` |
| `project-orchestrator` 5 kısa yol `tools.find(...).handler(...)` | `useTool("project_*", body, { ..., source: "rest" })` |
| `local-sidecar` `drive_upload` için `uploadTool.handler(...)` | `callTool("drive_upload", {...}, { ..., source: "rest" })` |

Bu sayede bu yollar da before-hook, runtime validate, timeout, maskeli audit, metrik ve after-hook zincirinden geçer.

---

## Testler

| Önce | Şimdi |
|------|--------|
| Birçok `registerTool` örneği `inputSchema` olmadan (validateTool ile çelişkili) | Geçerli minimal şema: `{ type: "object", properties: {} }` veya gerçek şema |
| `ToolTags.READ` kullanımı (geçerli tag değil) | `ToolTags.READ_ONLY` |
| `contract` / `workspace-context` hook birikimi | `beforeEach` içinde `clearHooks()` |
| `tool-registry` after-hook örneği yok | `registerAfterExecutionHook` + `callTool` entegrasyon testi |
| `invalid_tool_input` senaryosu yok | Eksik `required` alanı testi |
| `integration` GET `/mcp` supertest ile asılıyordu | `http.get` + `res.destroy()` + `server.close()` |
| `integration` geçersiz JSON-RPC asılıyordu | `http-transport` erken jsonrpc kontrolü + gövde assert |
| `integration` bazı araçlarda şema yok | `inputSchema` eklendi |

---

## Ortam / yapılandırma

| Önce | Şimdi |
|------|--------|
| Tool timeout sabit değildi (sonsuz `await handler`) | Varsayılan **120000 ms**; `TOOL_EXECUTION_TIMEOUT_MS`; araç başına `timeoutMs` |

---

## Bilinçli olarak değiştirilmeyenler

- `approveTool`, policy plugin’in `registerBeforeExecutionHook` mantığı (sadece normalize edilen onay cevapları MCP ile uyumlu).
- `AuditManager` / `auditLog` ile stderr `tool_audit` hâlâ ayrı kanallar (bu PR’da birleştirilmedi).
- JSON Schema tam özellik seti (`$ref`, `oneOf`, …) — yok; yalnızca yaygın alt küme.

---

## Dosya listesi (özet)

**Eklenenler**

- `src/core/tool-execution/execute-tool.js`
- `src/core/tool-execution/validate-input.js`
- `src/core/tool-execution/normalize-result.js`
- `src/core/tool-execution/with-timeout.js`
- `src/core/tool-execution/mask-sensitive-data.js`

**Güncellenenler**

- `src/core/tool-registry.js`
- `src/core/audit.js`
- `src/mcp/gateway.js`
- `src/mcp/http-transport.js`
- `src/plugins/prompt-registry/index.js`
- `src/plugins/project-orchestrator/index.js`
- `src/plugins/local-sidecar/index.js`
- `tests/core/tool-registry.test.js`
- `tests/mcp/contract.test.js`
- `tests/mcp/integration.test.js`

**Dokümantasyon**

- `docs/tool-execution-before-after.md` (bu dosya)
