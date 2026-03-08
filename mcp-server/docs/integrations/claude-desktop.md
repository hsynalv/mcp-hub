# Claude Desktop Integration

mcp-hub'ı Claude Desktop ile entegre edin.

## Kurulum

### 1. mcp-hub'ı MCP Server Olarak Çalıştırın

```bash
cd mcp-hub/mcp-server
npm install
cp .env.example .env
# .env dosyasını düzenleyin
npm start
```

### 2. Claude Desktop Config

Claude Desktop config dosyasını düzenleyin:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-hub": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/mcp/stdio-bridge.js"],
      "env": {
        "MCP_SERVER_URL": "http://localhost:8787"
      }
    }
  }
}
```

### 3. Test

Claude'a şunları sorun:
- "GitHub'daki repolarımı listele"
- "Notion'daki projelerimi göster"
- "n8n node kataloğunu getir"

## Örnek Kullanım

```
Kullanıcı: GitHub'da yeni bir repo analiz et
Claude: github_analyze_repo kullanıyorum...

Kullanıcı: Notion'da proje oluştur
Claude: notion_setup_project kullanıyorum...
```

## Sorun Giderme

### Tool'lar görünmüyor
1. Claude Desktop'u tamamen kapatıp açın
2. Config JSON syntax'ını kontrol edin
3. Server'ın çalıştığını doğrulayın: `curl http://localhost:8787/health`

### "Connection refused"
mcp-hub server'ın çalıştığından emin olun.
