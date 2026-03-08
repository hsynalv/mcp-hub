# MCP Hub Profesyonelleştirme Planı

Mevcut REST Hub yapısını koruyarak üzerine MCP (Model Context Protocol) Gateway eklemek, plugin sistemi için Tool Registry oluşturmak ve projeyi üretim seviyesine taşımak.

## 1. Mevcut Durum Analizi

- ✅ Plugin loader: `name/version/register/manifest` yapısı
- ✅ Auth: Scope-based (`read/write/admin`)
- ✅ Response envelope: Tek tip `{ok, data/error, meta}`
- ✅ Policy guardrail: `block/approval/dry-run/rate-limit`
- ✅ Project context: `x-project-id`, `x-env` header'ları
- ✅ Observability: Audit middleware + logs/stats
- ✅ Test coverage: 244 test, tüm plugin'ler için unit test'ler

## 2. Mimari: REST Hub + MCP Gateway

### 2.1 Tool Registry (Yeni)

Her plugin hem REST endpoint hem de MCP tool olarak çalışabilir:

```javascript
// src/core/tool-registry.js
export const toolRegistry = {
  tools: new Map(),
  
  register(tool) {
    // { name, description, inputSchema, handler, plugin }
    this.tools.set(tool.name, tool);
  },
  
  list() { return Array.from(this.tools.values()); },
  get(name) { return this.tools.get(name); },
  
  async call(name, args, context) {
    // Policy check önce
    const policy = evaluate(context.method, `/tools/${name}`, args, context.user);
    if (!policy.allowed) return policy;
    
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    
    return tool.handler(args, context);
  }
};
```

### 2.2 Plugin Contract Güncellemesi

Mevcut plugin manifest'e `tools[]` ekle:

```javascript
// src/plugins/github/index.js
export const tools = [
  {
    name: "github_list_repos",
    description: "List user repositories",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["created", "updated", "pushed"] },
        limit: { type: "number", default: 30 }
      }
    },
    handler: async (args, ctx) => { /* ... */ }
  },
  {
    name: "github_analyze_repo",
    description: "Full repo analysis",
    inputSchema: { /* ... */ },
    handler: async (args, ctx) => { /* ... */ }
  }
];
```

### 2.3 MCP Gateway (Yeni)

Resmi `@modelcontextprotocol/server` SDK ile:

```javascript
// src/mcp/gateway.js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export function createMcpServer() {
  const server = new Server(
    { name: "mcp-hub", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );
  
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.list().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))
  }));
  
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await toolRegistry.call(req.params.name, req.params.arguments, {
      user: req.context?.user,
      method: "MCP"
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  
  return server;
}
```

### 2.4 Transport Adaptörleri

- **REST**: Mevcut Express route'ları
- **MCP HTTP**: `GET/POST /mcp` (Streamable HTTP)
- **MCP STDIO**: `bin/mcp-hub-stdio` (local client'lar için)

```javascript
// src/mcp/transports/http.js
// Express middleware olarak /mcp endpoint'i

// src/mcp/transports/stdio.js
// CLI entrypoint: node bin/mcp-hub-stdio
```

## 3. Implementasyon Sırası

### Phase 1: Tool Registry (1-2 gün)
- [ ] `src/core/tool-registry.js` oluştur
- [ ] Plugin loader'a `tools[]` parse ekle
- [ ] Policy integration: `toolRegistry.call()` öncesi check
- [ ] GitHub plugin'i tool formatına dönüştür (örnek)

### Phase 2: MCP Server (1-2 gün)
- [ ] `@modelcontextprotocol/sdk` ekle
- [ ] `src/mcp/gateway.js` oluştur
- [ ] Tool Registry ↔ MCP Server bağla
- [ ] `/mcp` HTTP endpoint'i

### Phase 3: STDIO Transport (1 gün)
- [ ] `bin/mcp-hub-stdio` entrypoint
- [ ] CLI argüman parsing (--key, --scope)
- [ ] Local client test'leri (Claude Desktop, Cursor)

### Phase 4: Plugin Güncellemeleri (2-3 gün)
- [ ] Notion: tool stub'ları
- [ ] Slack: tool stub'ları
- [ ] n8n: tool registry'den workflow trigger
- [ ] Secrets: MCP tool olarak secret resolve

### Phase 5: Profesyonel Sertleştirme (2 gün)
- [ ] OpenAPI spec → tool stub üretimi
- [ ] Request/response schema validation (Zod → JSON Schema)
- [ ] Structured logging (Pino)
- [ ] GitHub Actions CI/CD

## 4. Güvenlik Kontrol Listesi

- [ ] Streamable HTTP: Origin doğrulama (DNS rebinding)
- [ ] MCP tool call: Aynı auth + scope check
- [ ] Policy guardrail: Tool call'lar için de aktif
- [ ] Rate limiting: Per-tool limit'ler

## 5. Önerilen Gelecek Plugin'ler

| Plugin | Açıklama | Priority |
|--------|----------|----------|
| filesystem | Sandboxed dosya okuma/yazma | High |
| shell | Policy + approval zorunlu exec | High |
| git | Branch/commit/PR işlemleri | Medium |
| docs | PDF/DOCX parse, özet | Medium |
| rag-core | Embedding + vector search | Medium |
| scheduler | Cron + job queue | Low |

## 6. Teknik Notlar

- **Zod → JSON Schema**: `@zod-to-json-schema` paketi
- **Policy → Tool**: Pattern matching `/tools/{toolName}` şeklinde
- **Context**: MCP call'larında `x-project-id` metadata'dan oku
- **Error handling**: MCP error formatına dönüştür

## 7. Başarı Kriterleri

- [ ] `npx mcp-hub-stdio` çalışır
- [ ] `GET /mcp` Streamable HTTP yanıt verir
- [ ] `tools/list` tüm plugin tool'larını döner
- [ ] Policy: Tool call öncesi approval çalışır
- [ ] GitHub plugin: Hem REST hem MCP üzerinden kullanılabilir
