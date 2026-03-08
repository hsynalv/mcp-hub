# mcp-hub

AI ajanları için plugin-tabanlı HTTP servisi. REST API ve MCP (Model Context Protocol) desteği ile Cursor, Claude Desktop, n8n ve özel LLM uygulamalarına entegrasyon sağlar.

## Özellikler

- **Çift Arayüz**: REST API + MCP Araçları
- **Plugin Sistemi**: Otomatik keşif ve yükleme
- **Policy Motoru**: Onay workflow'ları ve rate limiting
- **Job Kuyruğu**: Async görev yürütme
- **Çoklu Entegrasyon**: GitHub, Notion, n8n, veritabanları, dosya depolama

## Hızlı Başlangıç

```bash
cd mcp-server
npm install
cp .env.example .env
# .env dosyasını düzenleyin
npm run dev
```

## Plugin Maturity Matrix

| Plugin | Owner | Status | Auth | Tests | Docs | Production Ready |
|--------|-------|--------|------|-------|------|------------------|
| github | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| notion | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| llm-router | @hsynalv | 🟢 stable | ❌ | unit | ✅ | Yes |
| policy | @hsynalv | 🟢 stable | ✅ | unit | ✅ | Yes |
| rag | @hsynalv | 🟡 beta | ❌ | unit | ✅ | No |
| database | @hsynalv | 🟡 beta | ✅ | unit | ✅ | No |
| shell | @hsynalv | 🔴 experimental | ✅ | none | ✅ | No |
| file-storage | @hsynalv | 🟡 beta | ✅ | unit | ✅ | No |
| workspace | @hsynalv | 🟡 beta | ❌ | unit | ✅ | No |

**Legend:** 🟢 Stable | 🟡 Beta | 🔴 Experimental

## Dökümantasyon

- [Server Detayları](mcp-server/README.md)
- [Mimari](mcp-server/ARCHITECTURE.md)
- [Plugin Geliştirme](mcp-server/docs/plugin-development.md)

## Lisans

MIT
