# Claude Desktop Setup

## Hızlı Kurulum

1. **mcp-hub'ı başlat**:
   ```bash
   cd mcp-hub/mcp-server
   npm install
   npm start
   ```

2. **Claude Desktop config**:
   
   macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   
   Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

3. **Claude Desktop'u yeniden başlat**

4. **Test et**:
   - Claude'a "github repolarımı listele" deyin
   - veya "notion projelerimi göster"

## Sorun Giderme

### "Server not found"
- mcp-hub server'ın çalıştığını kontrol et: `curl http://localhost:8787/health`
- Path'in doğru olduğunu kontrol et

### "Permission denied"
- API key'lerin `.env`'de tanımlı olduğundan emin ol
- Key'lerin read/write scope'una sahip olduğunu kontrol et

### Tools görünmüyor
- Claude Desktop'u tamamen kapatıp aç
- Config JSON syntax'ını kontrol et
