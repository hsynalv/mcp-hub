# Cursor Integration

mcp-hub'ı Cursor ile entegre ederek AI agent'larınıza güçlü yetenekler kazandırın.

## Kurulum

### 1. mcp-hub'ı Başlatın

```bash
cd mcp-hub/mcp-server
npm install
cp .env.example .env
# .env dosyasını düzenleyin (API keys)
npm run dev
```

### 2. Cursor Tools Ayarları

Cursor'da Settings → Tools → Add New Tool yolunu izleyin:

| Alan | Değer |
|------|-------|
| Name | `mcp-hub` |
| Command | `node /path/to/mcp-server/src/mcp/stdio-bridge.js` |
| Environment Variables | `MCP_SERVER_URL=http://localhost:8787` |

### 3. Doğrulama

Cursor'u yeniden başlatın ve Composer'da test edin:
- "GitHub repolarımı listele"
- "Notion'da proje oluştur"

## Örnek Prompt'lar

```
GitHub'daki son PR'larımı incele ve özetle
```

```
Notion'da yeni bir proje kur: "Web API", backend Node.js, frontend React
```

```
n8n'de webhook ile başlayan bir workflow öner
```

## İpuçları

- Tool'lar otomatik önerilir
- `@mcp-hub` mention ederek spesifik tool çağırabilirsiniz
- Composer Chat ve Edit modlarında çalışır

## Sorun Giderme

### Tool'lar görünmüyor
- `.cursor/mcp.json` config dosyasını kontrol edin
- Server'ın çalıştığını doğrulayın: `curl http://localhost:8787/health`

### "Permission denied"
- API key'lerin tanımlı olduğundan emin olun
- Scope'ların (read/write) uygun olduğunu kontrol edin
