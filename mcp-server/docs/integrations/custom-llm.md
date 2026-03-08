# Custom LLM Integration

Herhangi bir LLM veya AI agent'dan mcp-hub'a bağlanın.

## HTTP Transport

mcp-hub HTTP endpoint'lerini doğrudan kullanın:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer YOUR_READ_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

## Tool Call

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer YOUR_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "github_analyze_repo",
      "arguments": {
        "repo": "owner/repo"
      }
    },
    "id": 2
  }'
```

## REST API

MCP dışında doğrudan REST API de kullanabilirsiniz:

```bash
# GitHub repo analizi
curl http://localhost:8787/github/analyze?repo=owner/repo \
  -H "Authorization: Bearer YOUR_READ_KEY"

# Notion proje oluşturma
curl -X POST http://localhost:8787/notion/setup-project \
  -H "Authorization: Bearer YOUR_WRITE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Yeni Proje",
    "tasks": [{"name": "Setup"}]
  }'
```

## Python Örneği

```python
import requests

class MCPHubClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
    
    def list_tools(self):
        resp = requests.post(
            f"{self.base_url}/mcp",
            headers=self.headers,
            json={
                "jsonrpc": "2.0",
                "method": "tools/list",
                "id": 1
            }
        )
        return resp.json()
    
    def call_tool(self, name, arguments):
        resp = requests.post(
            f"{self.base_url}/mcp",
            headers=self.headers,
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
                "id": 2
            }
        )
        return resp.json()

# Kullanım
client = MCPHubClient("http://localhost:8787", "YOUR_KEY")
tools = client.list_tools()
result = client.call_tool("github_analyze_repo", {"repo": "owner/repo"})
```

## Node.js Örneği

```javascript
import fetch from 'node-fetch';

class MCPHubClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  }
  
  async listTools() {
    const resp = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });
    return resp.json();
  }
  
  async callTool(name, args) {
    const resp = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: 2
      })
    });
    return resp.json();
  }
}

// Kullanım
const client = new MCPHubClient('http://localhost:8787', 'YOUR_KEY');
const tools = await client.listTools();
const result = await client.callTool('github_analyze_repo', { repo: 'owner/repo' });
```

## WebSocket/SSE

Real-time updates için:

```bash
curl http://localhost:8787/file-watcher/events \
  -H "Accept: text/event-stream"
```
