# Cursor Setup

## Hızlı Kurulum

1. **mcp-hub'ı başlat**:
   ```bash
   cd mcp-hub/mcp-server
   npm install
   npm start
   ```

2. **Cursor Tools ayarları**:
   
   Cursor → Settings → Tools → Add New Tool

   | Alan | Değer |
   |------|-------|
   | Name | mcp-hub |
   | Command | `node /path/to/mcp-server/src/mcp/stdio-bridge.js` |
   | Env | `MCP_SERVER_URL=http://localhost:8787` |

3. **Test et**:
   
   Composer'da `@mcp-hub` mention ederek veya doğrudan istek yaz:
   - "GitHub'daki repolarımı listele"
   - "Notion'da yeni proje oluştur"

## Özellikler

- Tool autocomplete
- Inline tool suggestions
- Composer integration
- Chat + Edit mod desteği

## Sorun Giderme

### Tool'lar görünmüyor
- `.cursor/mcp.json` dosyasını kontrol et
- Server'ın çalıştığını doğrula: `curl http://localhost:8787/health`

### "Connection refused"
- mcp-hub server'ın çalıştığından emin ol
- Port 8787'in kullanılabilir olduğunu kontrol et

### Auth hataları
- `.env` dosyasında `HUB_READ_KEY` ve `HUB_WRITE_KEY` tanımlı olduğundan emin ol
- Key'lerin doğru scope'a sahip olduğunu kontrol et
