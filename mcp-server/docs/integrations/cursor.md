# Cursor Integration Guide

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

```json
{
  "name": "ai-hub-github-analyze",
  "endpoint": "http://localhost:8787/github/analyze",
  "method": "POST",
  "description": "Analyze GitHub repository structure and commits",
  "parameters": {
    "repo": {
      "type": "string",
      "description": "Repository name (owner/repo)",
      "required": true
    }
  }
}
```

### 3. Örnek Tool Configürasyonları

#### GitHub Repository Analizi
```json
{
  "name": "github-repo-analyze",
  "endpoint": "http://localhost:8787/github/analyze",
  "method": "POST",
  "description": "Deep analyze GitHub repository",
  "parameters": {
    "repo": {
      "type": "string",
      "required": true,
      "description": "owner/repo format"
    }
  }
}
```

#### Docker Container Yönetimi
```json
{
  "name": "docker-containers",
  "endpoint": "http://localhost:8787/docker/containers",
  "method": "GET",
  "description": "List all Docker containers",
  "parameters": {
    "all": {
      "type": "boolean",
      "default": false,
      "description": "Include stopped containers"
    }
  }
}
```

#### Slack Mesaj Gönderme
```json
{
  "name": "slack-message",
  "endpoint": "http://localhost:8787/slack/message",
  "method": "POST",
  "description": "Send message to Slack channel",
  "parameters": {
    "channel": {
      "type": "string",
      "required": true,
      "description": "Channel ID (C123...)"
    },
    "text": {
      "type": "string",
      "required": true,
      "description": "Message text"
    }
  }
}
```

#### Notion Proje Oluşturma
```json
{
  "name": "notion-project",
  "endpoint": "http://localhost:8787/notion/setup-project",
  "method": "POST",
  "description": "Create project with tasks in Notion",
  "parameters": {
    "name": {
      "type": "string",
      "required": true,
      "description": "Project name"
    },
    "status": {
      "type": "string",
      "default": "Yapılmadı",
      "description": "Project status"
    },
    "tasks": {
      "type": "array",
      "description": "Array of tasks with gorev field"
    }
  }
}
```

## Kullanım Örnekleri

### Repository Analizi
```
User: "Analyze the react-admin repository"
Cursor: github-repo-analyze(repo="facebook/react")
```

### Container Yönetimi
```
User: "Show running containers"
Cursor: docker-containers(all=false)

User: "Stop the nginx container"
Cursor: docker-stop-container(id="nginx-container-id")
```

### Slack Entegrasyonu
```
User: "Notify team that deployment is complete"
Cursor: slack-message(channel="#general", text="🚀 Deployment completed successfully!")
```

### Proje Yönetimi
```
User: "Create a new project for AI-Hub development"
Cursor: notion-project(
  name="AI-Hub v2 Development",
  status="Yapılıyor",
  tasks=[
    {gorev: "Docker plugin geliştir"},
    {gorev: "Slack entegrasyonu"},
    {gorev: "Documentation güncelleme"}
  ]
)
```

## İleri Seviye Kullanım

### Custom Tool Chain'ler
Cursor'da tool'ları zincirleme:

```javascript
// Repository analiz → proje oluşturma → bildirim
const repo = await github-repo-analyze(repo="user/project");
const project = await notion-project(name=repo.repo.name, tasks=repo.open_issues);
await slack-message(channel="#dev", text=`Project created: ${project.id}`);
```

### Error Handling
```javascript
try {
  const containers = await docker-containers();
  return containers.filter(c => c.state === 'running');
} catch (error) {
  return { error: "Docker connection failed", details: error };
}
```

## Best Practices

### 1. Security
- AI-Hub'ı sadece local network'te çalıştırın
- API keys'i .env dosyasında saklayın
- Production'da authentication enable edin

### 2. Performance
- Cache mekanizmasını kullanın
- Büyük veri işlemleri için pagination kullanın
- Rate limit'lere dikkat edin

### 3. Error Handling
- Tool response'larını validate edin
- Fallback mekanizmaları kurun
- User-friendly error mesajları gösterin

## Troubleshooting

### Connection Issues
```bash
# AI-Hub çalışıyor mu?
curl http://localhost:8787/health

# Plugin'ler yüklendi mi?
curl http://localhost:8787/plugins
```

### Authentication Errors
- Environment variable'leri kontrol edin
- API keys'in geçerliliğini doğrulayın
- Rate limit durumunu kontrol edin

### Plugin-specific Issues
- Docker: `DOCKER_HOST` environment variable'ini kontrol edin
- Slack: Bot token ve permissions'ı doğrulayın
- GitHub: Token scopes'ı kontrol edin

## Örnek Workspace Config

```json
{
  "tools": [
    {
      "name": "github-analyze",
      "endpoint": "http://localhost:8787/github/analyze",
      "method": "POST"
    },
    {
      "name": "docker-containers",
      "endpoint": "http://localhost:8787/docker/containers",
      "method": "GET"
    },
    {
      "name": "slack-message",
      "endpoint": "http://localhost:8787/slack/message",
      "method": "POST"
    },
    {
      "name": "notion-project",
      "endpoint": "http://localhost:8787/notion/setup-project",
      "method": "POST"
    }
  ]
}
```

Bu konfigürasyon ile Cursor'ınıza tam teşekküllü bir development ortamı kazandırın!
