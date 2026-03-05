# Multi-LLM Router Plugin

Intelligent routing of AI tasks to specialized LLM providers based on task type, cost, and performance requirements.

## Overview

The LLM Router automatically selects the best LLM for each task:
- **Backend/Coding** → Claude 3 Opus (best for complex code)
- **Frontend/UI** → GPT-4o (excellent for design tasks)
- **General/Chat** → GPT-4o Mini (cost-effective)
- **Multilingual** → Google Gemini (strong non-English support)
- **Private/Local** → Ollama (self-hosted models)

## Supported Providers

| Provider | Models | Best For | Cost |
|----------|--------|----------|------|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo | General purpose, UI/UX | $$ |
| **Anthropic** | claude-3-opus, claude-3-sonnet | Coding, reasoning, analysis | $$$ |
| **Google** | gemini-1.5-pro, gemini-1.5-flash | Multilingual, long context | $ |
| **Mistral** | mistral-large, mistral-small | European compliance, cost | $ |
| **Ollama** | llama3, codellama, mistral | Local/private deployment | Free |

## MCP Tools

### `llm_route`

Route a task to the best available LLM.

**Parameters:**
- `task` (string): Task description
- `type` (string): Task type (backend_api, frontend_ui, devops, analysis, creative, general)
- `prompt` (string): The actual prompt to send
- `options` (object): Temperature, maxTokens, etc.

**Example:**
```json
{
  "task": "Create REST API endpoint",
  "type": "backend_api",
  "prompt": "Write an Express.js route for user authentication...",
  "options": { "temperature": 0.2 }
}
```

### `llm_route_backend`

Optimized for backend development tasks.

**Example:**
```json
{
  "prompt": "Create a database schema for user management...",
  "language": "typescript"
}
```

### `llm_route_frontend`

Optimized for frontend/UI tasks.

**Example:**
```json
{
  "prompt": "Design a responsive navigation component...",
  "framework": "react"
}
```

### `llm_compare`

Get responses from multiple LLMs and compare.

**Parameters:**
- `prompt` (string): Prompt to send
- `providers` (array): Providers to compare (openai, anthropic, google, mistral)

**Example:**
```json
{
  "prompt": "Explain quantum computing",
  "providers": ["openai", "anthropic"]
}
```

### `llm_list_models`

List all available models and their status.

**Returns:**
```json
[
  {
    "provider": "anthropic",
    "name": "Anthropic Claude",
    "models": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"],
    "available": true
  }
]
```

### `llm_estimate_cost`

Estimate cost before making a call.

**Parameters:**
- `task` (string): Task type
- `promptTokens` (number): Estimated input tokens
- `responseTokens` (number): Estimated output tokens

**Example:**
```json
{
  "task": "backend_api",
  "promptTokens": 1000,
  "responseTokens": 2000
}
```

**Returns:**
```json
{
  "estimatedCost": 0.045,
  "provider": "anthropic",
  "model": "claude-3-opus-20240229",
  "currency": "USD"
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/llm/route` | Route task to best LLM |
| POST | `/llm/compare` | Compare multiple LLMs |
| GET | `/llm/models` | List available models |
| POST | `/llm/estimate` | Estimate cost |

## Usage Examples

### Route Backend Task
```bash
curl -X POST http://localhost:8787/llm/route \
  -H "Content-Type: application/json" \
  -d '{
    "type": "backend_api",
    "prompt": "Create a JWT authentication middleware..."
  }'
```

### Compare LLMs
```bash
curl -X POST http://localhost:8787/llm/compare \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a regex for email validation",
    "providers": ["openai", "anthropic"]
  }'
```

### Estimate Cost
```bash
curl -X POST http://localhost:8787/llm/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "task": "analysis",
    "promptTokens": 5000,
    "responseTokens": 1000
  }'
```

## Routing Rules

| Task Type | Primary | Fallback | Rationale |
|-----------|---------|----------|-----------|
| backend_api | Claude 3 Opus | GPT-4o | Best code generation |
| frontend_ui | GPT-4o | Claude Sonnet | UI/UX expertise |
| devops | Claude Sonnet | GPT-4o | Infra as code |
| analysis | Claude Opus | GPT-4o | Complex reasoning |
| creative | GPT-4o | Mistral | Creative writing |
| general | GPT-4o Mini | Mistral Small | Cost efficiency |

## Environment Variables

```env
# OpenAI (required for GPT models)
OPENAI_API_KEY=sk-...

# Anthropic (required for Claude models)
ANTHROPIC_API_KEY=sk-ant-...

# Google (optional, for Gemini models)
GOOGLE_API_KEY=AIza...

# Mistral (optional, for European compliance)
MISTRAL_API_KEY=

# Ollama (optional, for local models)
OLLAMA_BASE_URL=http://localhost:11434
```

## Cost Optimization

### Automatic Fallback
If primary provider fails or is rate-limited, automatically falls back to secondary.

### Smart Routing
Small tasks (< 500 tokens) → Cheaper models (GPT-4o Mini)
Complex tasks → Premium models (Claude 3 Opus)

### Caching
Identical prompts are cached to reduce API calls (configurable TTL).

## Resilience

The plugin includes:
- **Retry Logic**: Exponential backoff on failures
- **Circuit Breaker**: Prevents cascade failures
- **Timeout Handling**: Configurable request timeouts
- **Rate Limiting**: Respects provider rate limits
