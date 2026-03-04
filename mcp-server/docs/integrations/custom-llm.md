# Custom LLM Applications Integration Guide

AI-Hub'ı herhangi bir LLM uygulaması ile entegre edin.

## Quick Start

### 1. AI-Hub'ı Başlatın

```bash
cd ai-hub/mcp-server
npm install
cp .env.example .env
# API keys'leri düzenleyin
npm run dev
```

### 2. HTTP Client ile Entegrasyon

AI-Hub REST API endpoint'lerini kullanarak herhangi bir programming dili ile entegre olabilirsiniz.

## Python Örnekleri

### GitHub Repository Analizi

```python
import requests
import json

class AIHubClient:
    def __init__(self, base_url="http://localhost:8787"):
        self.base_url = base_url
    
    def analyze_repo(self, repo_name):
        """GitHub repository analiz et"""
        response = requests.post(
            f"{self.base_url}/github/analyze",
            json={"repo": repo_name}
        )
        return response.json()
    
    def list_containers(self, all_containers=False):
        """Docker container'larını listele"""
        params = {"all": "true"} if all_containers else {}
        response = requests.get(
            f"{self.base_url}/docker/containers",
            params=params
        )
        return response.json()
    
    def send_slack_message(self, channel, text):
        """Slack kanalına mesaj gönder"""
        response = requests.post(
            f"{self.base_url}/slack/message",
            json={"channel": channel, "text": text}
        )
        return response.json()
    
    def create_notion_project(self, name, tasks=None):
        """Notion'da proje oluştur"""
        payload = {"name": name}
        if tasks:
            payload["tasks"] = tasks
        
        response = requests.post(
            f"{self.base_url}/notion/setup-project",
            json=payload
        )
        return response.json()

# Kullanım örneği
ai_hub = AIHubClient()

# Repository analizi
repo_analysis = ai_hub.analyze_repo("facebook/react")
print(f"Repository: {repo_analysis['repo']['fullName']}")
print(f"Stars: {repo_analysis['repo']['stars']}")
print(f"Open issues: {repo_analysis['issues']['open']}")

# Container yönetimi
containers = ai_hub.list_containers(all_containers=True)
running_containers = [c for c in containers['containers'] if c['state'] == 'running']
print(f"Running containers: {len(running_containers)}")

# Slack bildirimi
ai_hub.send_slack_message("#general", "🚀 Deployment completed successfully!")

# Proje oluşturma
project = ai_hub.create_notion_project(
    name="AI Integration Project",
    tasks=[
        {"gorev": "Setup AI-Hub"},
        {"gorev": "Configure integrations"},
        {"gorev": "Test workflows"}
    ]
)
print(f"Project created: {project['project']['url']}")
```

### Advanced LLM Integration

```python
import openai
from ai_hub_client import AIHubClient

class AIAgent:
    def __init__(self, openai_key, ai_hub_url="http://localhost:8787"):
        self.openai_client = openai.OpenAI(api_key=openai_key)
        self.ai_hub = AIHubClient(ai_hub_url)
    
    def process_repository_request(self, repo_name):
        """Repository analizi ve öneriler"""
        # 1. Repository bilgisini al
        repo_data = self.ai_hub.analyze_repo(repo_name)
        
        # 2. LLM'e analiz et
        analysis_prompt = f"""
        Analyze this repository and provide insights:
        
        Repository: {repo_data['repo']['fullName']}
        Description: {repo_data['repo']['description']}
        Language: {repo_data['repo']['language']}
        Stars: {repo_data['repo']['stars']}
        Open Issues: {repo_data['issues']['open']}
        
        Recent commits:
        {chr(10).join([f"- {c['message']}" for c in repo_data['commits']['items'][:5]])}
        
        Provide:
        1. Project summary
        2. Technical stack analysis
        3. Potential improvements
        4. Security considerations
        """
        
        response = self.openai_client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": analysis_prompt}]
        )
        
        return {
            "repo_data": repo_data,
            "analysis": response.choices[0].message.content
        }
    
    def deploy_and_notify(self, project_name, repo_name):
        """Deployment workflow'u"""
        try:
            # 1. Container'ları kontrol et
            containers = self.ai_hub.list_containers()
            
            # 2. Deployment kararı
            deploy_prompt = f"""
            Based on these running containers, should I deploy {project_name}?
            Current containers: {[c['name'] for c in containers['containers']]}
            Repository: {repo_name}
            
            Consider:
            - Port conflicts
            - Resource usage
            - Best practices
            """
            
            decision = self.openai_client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": deploy_prompt}]
            )
            
            # 3. Slack bildirimi
            self.ai_hub.send_slack_message(
                "#deployments",
                f"🤔 AI Decision for {project_name}: {decision.choices[0].message.content}"
            )
            
            return {"status": "analyzed", "decision": decision.choices[0].message.content}
            
        except Exception as e:
            # Hata durumunda bildir
            self.ai_hub.send_slack_message(
                "#errors",
                f"❌ Deployment analysis failed: {str(e)}"
            )
            return {"status": "error", "message": str(e)}

# Kullanım
agent = AIAgent(openai_key="your-openai-key")
result = agent.process_repository_request("vercel/next.js")
print(result["analysis"])

deployment_result = agent.deploy_and_notify("my-app", "user/my-repo")
```

## Node.js Örnekleri

### Express.js Integration

```javascript
const express = require('express');
const axios = require('axios');

class AIHubIntegration {
    constructor(baseUrl = 'http://localhost:8787') {
        this.baseUrl = baseUrl;
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 10000,
        });
    }

    async analyzeRepository(repoName) {
        try {
            const response = await this.client.post('/github/analyze', {
                repo: repoName
            });
            return response.data;
        } catch (error) {
            console.error('Repository analysis failed:', error.response?.data || error.message);
            throw error;
        }
    }

    async getDockerContainers(all = false) {
        try {
            const response = await this.client.get('/docker/containers', {
                params: { all: all.toString() }
            });
            return response.data;
        } catch (error) {
            console.error('Docker containers fetch failed:', error.response?.data || error.message);
            throw error;
        }
    }

    async sendSlackNotification(channel, message, blocks = null) {
        try {
            const payload = { channel, text: message };
            if (blocks) payload.blocks = blocks;
            
            const response = await this.client.post('/slack/message', payload);
            return response.data;
        } catch (error) {
            console.error('Slack notification failed:', error.response?.data || error.message);
            throw error;
        }
    }

    async createNotionProject(name, status = 'Yapılmadı', tasks = []) {
        try {
            const response = await this.client.post('/notion/setup-project', {
                name,
                status,
                tasks
            });
            return response.data;
        } catch (error) {
            console.error('Notion project creation failed:', error.response?.data || error.message);
            throw error;
        }
    }
}

// Express.js middleware
const aiHub = new AIHubIntegration();

const app = express();
app.use(express.json());

// Repository analysis endpoint
app.post('/api/analyze-repo', async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) {
            return res.status(400).json({ error: 'Repository name required' });
        }

        const analysis = await aiHub.analyzeRepository(repo);
        
        // AI ile zenginleştirme
        const enrichedAnalysis = await enrichWithAI(analysis);
        
        res.json({
            success: true,
            data: enrichedAnalysis
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Deployment automation
app.post('/api/deploy', async (req, res) => {
    try {
        const { projectName, repoName, notifyChannel } = req.body;
        
        // 1. Docker container'larını kontrol et
        const containers = await aiHub.getDockerContainers(true);
        
        // 2. Deployment logic
        const deploymentResult = await performDeployment(projectName, repoName, containers);
        
        // 3. Bildirim gönder
        if (notifyChannel && deploymentResult.success) {
            await aiHub.sendSlackNotification(
                notifyChannel,
                `🚀 ${projectName} deployed successfully!`,
                [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Deployment Details:*\n• Repository: ${repoName}\n• Status: ${deploymentResult.status}\n• URL: ${deploymentResult.url}`
                    }
                }]
            );
        }
        
        res.json({ success: true, data: deploymentResult });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

async function enrichWithAI(data) {
    // OpenAI/Anthropic/Claude API çağrısı yap
    // Analizi zenginleştir
    return data;
}

async function performDeployment(projectName, repoName, containers) {
    // Deployment logic'i
    return {
        success: true,
        status: 'deployed',
        url: `https://${projectName}.example.com`
    };
}

app.listen(3000, () => {
    console.log('Custom LLM app with AI-Hub integration running on port 3000');
});
```

## Go Örnekleri

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type AIHubClient struct {
    BaseURL string
    Client  *http.Client
}

type Repository struct {
    FullName string `json:"fullName"`
    Language string `json:"language"`
    Stars    int    `json:"stars"`
}

func NewAIHubClient(baseURL string) *AIHubClient {
    return &AIHubClient{
        BaseURL: baseURL,
        Client:  &http.Client{},
    }
}

func (c *AIHubClient) AnalyzeRepository(repo string) (*Repository, error) {
    payload := map[string]string{"repo": repo}
    jsonData, _ := json.Marshal(payload)
    
    resp, err := c.Client.Post(
        c.BaseURL+"/github/analyze",
        "application/json",
        bytes.NewBuffer(jsonData),
    )
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result struct {
        OK    bool       `json:"ok"`
        Repo   Repository `json:"repo"`
        Error  string     `json:"error"`
    }
    
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }
    
    if !result.OK {
        return nil, fmt.Errorf("AI-Hub error: %s", result.Error)
    }
    
    return &result.Repo, nil
}

func main() {
    aiHub := NewAIHubClient("http://localhost:8787")
    
    repo, err := aiHub.AnalyzeRepository("golang/go")
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    
    fmt.Printf("Repository: %s\n", repo.FullName)
    fmt.Printf("Language: %s\n", repo.Language)
    fmt.Printf("Stars: %d\n", repo.Stars)
}
```

## Error Handling

### Standardized Error Response

```python
class AIHubError(Exception):
    def __init__(self, message, error_code=None, details=None):
        self.message = message
        self.error_code = error_code
        self.details = details
        super().__init__(message)

def handle_aihub_response(response):
    """AI-Hub API response'unu handle et"""
    if not response.get('ok', False):
        error = response.get('error', 'unknown_error')
        details = response.get('details', {})
        raise AIHubError(
            message=f"AI-Hub error: {error}",
            error_code=error,
            details=details
        )
    
    return response.get('data', response)

# Kullanım
try:
    result = handle_aihub_response(ai_hub.analyze_repo("user/repo"))
except AIHubError as e:
    print(f"Error: {e.message}")
    print(f"Code: {e.error_code}")
    if e.details:
        print(f"Details: {e.details}")
```

## Rate Limiting

### Rate Limit Handler

```python
import time
from functools import wraps

class RateLimiter:
    def __init__(self, max_requests=60, time_window=60):
        self.max_requests = max_requests
        self.time_window = time_window
        self.requests = []
    
    def wait_if_needed(self):
        now = time.time()
        # Remove old requests
        self.requests = [req_time for req_time in self.requests if now - req_time < self.time_window]
        
        if len(self.requests) >= self.max_requests:
            sleep_time = self.time_window - (now - self.requests[0])
            print(f"Rate limit reached. Waiting {sleep_time:.1f} seconds...")
            time.sleep(sleep_time)
        
        self.requests.append(now)

def rate_limit(max_requests=60, time_window=60):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            rate_limiter.wait_if_needed()
            return func(*args, **kwargs)
        return wrapper
    return decorator

# Kullanım
@rate_limit(max_requests=30, time_window=60)
def analyze_repository(repo_name):
    return ai_hub.analyze_repo(repo_name)
```

## Best Practices

### 1. Connection Management
```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10)
)
def make_aihub_request(endpoint, data):
    response = requests.post(f"{AI_HUB_URL}/{endpoint}", json=data)
    response.raise_for_status()
    return response.json()
```

### 2. Configuration Management
```python
# config.py
import os
from dataclasses import dataclass

@dataclass
class AIHubConfig:
    base_url: str = "http://localhost:8787"
    timeout: int = 30
    max_retries: int = 3
    debug: bool = False

def load_config():
    return AIHubConfig(
        base_url=os.getenv("AI_HUB_URL", "http://localhost:8787"),
        timeout=int(os.getenv("AI_HUB_TIMEOUT", "30")),
        debug=os.getenv("AI_HUB_DEBUG", "false").lower() == "true"
    )
```

### 3. Logging
```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger('ai-hub-client')

def log_aihub_request(method, endpoint, data):
    logger.info(f"AI-Hub Request: {method} {endpoint}")
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"Request data: {json.dumps(data, indent=2)}")
```

Bu örneklerle AI-Hub'ı herhangi bir LLM uygulamasına kolayca entegre edebilirsiniz!
