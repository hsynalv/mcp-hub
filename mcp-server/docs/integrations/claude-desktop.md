# Claude Desktop Integration Guide

mcp-hub'ı Claude Desktop ile MCP (Model Context Protocol) üzerinden entegre edin.

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

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ai-hub": {
      "command": "node",
      "args": ["/path/to/ai-hub/mcp-server/src/index.js"],
      "env": {
        "ENABLE_N8N_PLUGIN": "false",
        "SLACK_BOT_TOKEN": "xoxb-your-slack-bot-token",
        "GITHUB_TOKEN": "ghp_your_github_token",
        "NOTION_API_KEY": "secret_your_notion_token"
      }
    }
  }
}
```

### 3. Claude Desktop'ı Restart Edin

Claude Desktop'ı tamamen kapatıp tekrar açın. AI-Hub otomatik olarak yüklenecektir.

## Kullanılabilir Araçlar

### GitHub Araçları
- `github_analyze_repository` - Repository analizi
- `github_list_repositories` - Repo listesi
- `github_get_file_content` - Dosya içeriği

### Docker Araçları
- `docker_list_containers` - Container listesi
- `docker_start_container` - Container başlatma
- `docker_stop_container` - Container durdurma
- `docker_get_logs` - Container log'ları

### Slack Araçları
- `slack_send_message` - Mesaj gönderme
- `slack_list_channels` - Kanal listesi
- `slack_upload_file` - Dosya yükleme

### Notion Araçları
- `notion_create_project` - Proje oluşturma
- `notion_add_task` - Task ekleme
- `notion_search_pages` - Sayfa arama

## Kullanım Örnekleri

### Repository Analizi
```
User: "Can you analyze the AI-Hub repository and tell me about its structure?"

Claude: I'll analyze the AI-Hub repository for you.
[Uses github_analyze_repository tool]

Based on my analysis of the AI-Hub repository:
- It's a Node.js project with Express.js
- Has 13+ plugins for different services
- Main plugins include GitHub, Notion, Docker, Slack integration
- Uses plugin-based architecture for extensibility
```

### Container Yönetimi
```
User: "Show me all running Docker containers and their resource usage"

Claude: Let me check your running containers.
[Uses docker_list_containers]

Here are your running containers:
1. **ai-hub-server** (abc123) - Status: running, Ports: 8787→8787
2. **postgres-db** (def456) - Status: running, Ports: 5432→5432
3. **redis-cache** (ghi789) - Status: running, Ports: 6379→6379

Would you like me to check logs for any of these containers?
```

### Proje Yönetimi
```
User: "Create a new project in Notion for the website redesign with these tasks: design mockups, implement frontend, setup deployment"

Claude: I'll create the project with those tasks in Notion.
[Uses notion_create_project]

Project created successfully! 📋
- **Project Name:** Website Redesign
- **Status:** Yapılmadı
- **Tasks Created:** 3 tasks
  1. Design mockups
  2. Implement frontend  
  3. Setup deployment

Project URL: https://notion.so/project-xyz
```

### Team Bildirimi
```
User: "Notify the #dev team that the deployment is complete"

Claude: I'll send a notification to your dev team.
[Uses slack_send_message]

✅ Message sent to #dev team:
"🚀 Deployment completed successfully! All systems are operational."
```

## İleri Seviye Kullanım

### Multi-Tool Workflows
Claude birden fazla aracı birleştirebilir:

```
User: "Analyze this repository, create a project for it, and notify the team"

Claude: I'll help you with that workflow:
1. First, let me analyze the repository...
[Uses github_analyze_repository]

2. Now I'll create a project based on the analysis...
[Uses notion_create_project]

3. Finally, I'll notify the team...
[Uses slack_send_message]

Complete! Repository analyzed, project created, and team notified.
```

### Error Handling
```
User: "Stop the container named 'broken-app'"

Claude: Let me stop that container for you.
[Uses docker_stop_container - returns error]

❌ I couldn't stop the container. Here's what happened:
- Container 'broken-app' not found
- Available containers: ai-hub, postgres, redis

Would you like me to:
1. Show all containers (including stopped ones)?
2. Stop a different container?
3. Check container logs for errors?
```

## Environment Variable'ler

Claude Desktop config'ında kullanabileceğiniz environment variable'ler:

```json
{
  "mcpServers": {
    "ai-hub": {
      "command": "node",
      "args": ["/absolute/path/to/ai-hub/mcp-server/src/index.js"],
      "env": {
        // n8n plugin'lerini disable et
        "ENABLE_N8N_PLUGIN": "false",
        "ENABLE_N8N_CREDENTIALS": "false",
        "ENABLE_N8N_WORKFLOWS": "false",
        
        // GitHub entegrasyonu
        "GITHUB_TOKEN": "ghp_your_token",
        
        // Slack entegrasyonu
        "SLACK_BOT_TOKEN": "xoxb_your_bot_token",
        
        // Notion entegrasyonu
        "NOTION_API_KEY": "secret_your_token",
        "NOTION_ROOT_PAGE_ID": "your_page_id",
        "NOTION_PROJECTS_DB_ID": "your_projects_db",
        "NOTION_TASKS_DB_ID": "your_tasks_db",
        
        // Docker entegrasyonu
        "DOCKER_HOST": "/var/run/docker.sock",
        
        // Authentication (production için)
        "HUB_READ_KEY": "your_read_key",
        "HUB_WRITE_KEY": "your_write_key"
      }
    }
  }
}
```

## Troubleshooting

### MCP Server Bağlantı Sorunları

1. **AI-Hub çalışmıyor:**
```bash
# AI-Hub'ı manuel olarak test et
curl http://localhost:8787/health
```

2. **Path issues:**
- Node.js executable'ının path'ini kontrol edin
- AI-Hub source path'ini doğrulayın
- Absolute path kullanın

3. **Permission issues:**
```bash
# Docker socket erişimi
sudo usermod -aG docker $USER

# File permissions
chmod +x /path/to/ai-hub/mcp-server/src/index.js
```

### Claude Desktop Sorunları

1. **Config yüklenmiyor:**
- JSON syntax'ını kontrol edin
- File path'ini doğrulayın
- Claude Desktop'ı restart edin

2. **Tools görünmüyor:**
- MCP server log'larını kontrol edin
- Environment variable'leri doğrulayın
- Claude Desktop'ı tamamen restart edin

### Debug Mode

Debug mode için Claude Desktop config'ına ekleyin:

```json
{
  "mcpServers": {
    "ai-hub": {
      "command": "node",
      "args": [
        "/path/to/ai-hub/mcp-server/src/index.js",
        "--debug"
      ],
      "env": {
        "DEBUG": "ai-hub:*"
      }
    }
  }
}
```

## Best Practices

### 1. Security
- Production'da authentication enable edin
- API keys'i environment variable'lerde saklayın
- Minimum required permissions verin

### 2. Performance
- Cache mekanizmasından faydalanın
- Büyük veri için pagination kullanın
- Rate limit'lere dikkat edin

### 3. Reliability
- Error handling implement edin
- Fallback mekanizmaları kurun
- Log'ları düzenli olarak kontrol edin

Bu kurulumla Claude Desktop'ınıza tam teşekküllü bir AI asistanı kazandırın!
