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

## Dökümantasyon

- [Server Detayları](mcp-server/README.md)
- [Mimari](mcp-server/ARCHITECTURE.md)
- [Plugin Geliştirme](mcp-server/docs/plugin-development.md)

## Lisans

MIT
